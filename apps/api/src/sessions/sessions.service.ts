import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { BookingStatus, PaymentMethod, PaymentType, SessionStatus, TableSession, Prisma } from '@prisma/client';
import { maskPromptpay, promptpayQr } from '../common/promptpay';
import { local } from '../common/time';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeBill, campaignApplies, DiscountCandidate } from '../pricing/pricing';
import { RealtimeGateway } from '../realtime/realtime.gateway';

type Tx = Prisma.TransactionClient;

/** How long a shown bill (and its QR) can still be closed at its original amount. */
const BILL_HOLD_MS = 15 * 60000;

export function playedMs(s: Pick<TableSession, 'startedAt' | 'pausedAt' | 'pausedMs' | 'endedAt'>, now = new Date()): number {
  const end = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, end.getTime() - s.startedAt.getTime() - s.pausedMs);
}

/** Booking statuses that hold a table slot. */
export const HOLDING: BookingStatus[] = [
  BookingStatus.PENDING_DEPOSIT,
  BookingStatus.DEPOSIT_SUBMITTED,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN, // until its slot ends, even while playing
];

@Injectable()
export class SessionsService implements OnModuleInit {
  private readonly log = new Logger('Sessions');
  private lastSent = new Map<string, string>();

  constructor(private prisma: PrismaService, private mqtt: MqttService, private realtime: RealtimeGateway) {}

  onModuleInit() {
    this.mqtt.onDeviceConnected = async (deviceId) => {
      const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
      if (!dev?.tableId) return;
      this.lastSent.delete(deviceId);
      await this.syncDevice(dev.tableId, true);
      const score = dev.scoreJson ? JSON.parse(dev.scoreJson) : { p1: 0, p2: 0, f1: 0, f2: 0, active: 1, brk: 0 };
      this.mqtt.send(deviceId, { type: 'score', ...score });
    };
  }

  /** Live floor: every table with its session, next booking, device and score. */
  async board(shopId: string) {
    const now = new Date();
    const dayEnd = local(now).add(1, 'day').startOf('day').add(6, 'hour').toDate(); // through late-night closing
    const tables = await this.prisma.snookerTable.findMany({
      where: { shopId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        device: true,
        sessions: { where: { status: { not: SessionStatus.CLOSED } }, include: { customer: true, booking: true } },
        bookings: {
          // Checked-in bookings that already started a game aren't "upcoming" any more.
          where: { status: { in: HOLDING }, endAt: { gt: now }, startAt: { lt: dayEnd }, session: { is: null } },
          orderBy: { startAt: 'asc' },
          take: 3,
        },
      },
    });
    return tables.map((t) => {
      const s = t.sessions[0] ?? null;
      return {
        id: t.id,
        name: t.name,
        label: t.label,
        pricePerHour: t.pricePerHour,
        bookable: t.bookable,
        session: s && {
          id: s.id,
          status: s.status,
          startedAt: s.startedAt,
          playedMs: playedMs(s, now),
          customerName: s.customer?.name ?? s.customerName,
          bookingCode: s.booking?.code ?? null,
        },
        upcoming: t.bookings.map((b) => ({ id: b.id, code: b.code, name: b.name, startAt: b.startAt, endAt: b.endAt, status: b.status })),
        device: t.device && { id: t.device.id, online: t.device.online, lastSeenAt: t.device.lastSeenAt },
        score: t.device?.scoreJson ? JSON.parse(t.device.scoreJson) : null,
      };
    });
  }

  private async candidates(tx: Tx, shopId: string, tableId: string, customerId: string | null, at: Date): Promise<DiscountCandidate[]> {
    const out: DiscountCandidate[] = [];
    let isMember = false;
    if (customerId) {
      const m = await tx.membership.findFirst({
        where: { shopId, customerId, startsAt: { lte: at }, endsAt: { gte: at } },
        include: { plan: true },
        orderBy: { plan: { discountPercent: 'desc' } },
      });
      if (m) {
        isMember = true;
        out.push({ kind: 'MEMBER', label: `สมาชิก ${m.plan.name} (${m.plan.discountPercent}%)`, type: 'PERCENT', value: m.plan.discountPercent });
      }
    }
    const l = local(at);
    const campaigns = await tx.campaign.findMany({ where: { shopId, active: true, startDate: { lte: at }, endDate: { gte: at } } });
    for (const c of campaigns) {
      if (campaignApplies(c, at, l.day(), l.hour() * 60 + l.minute(), tableId, isMember)) {
        out.push({ kind: 'CAMPAIGN', label: c.name, type: c.type, value: c.value });
      }
    }
    return out;
  }

  async open(
    shopId: string,
    tableId: string,
    opts: { customerId?: string | null; customerName?: string | null; bookingId?: string | null; userId?: string | null },
    txIn?: Tx,
  ) {
    const run = async (tx: Tx) => {
      const table = await tx.snookerTable.findFirst({ where: { id: tableId, shopId, active: true } });
      if (!table) throw new NotFoundException('ไม่พบโต๊ะ');
      const busy = await tx.tableSession.findFirst({ where: { tableId, status: { not: SessionStatus.CLOSED } } });
      if (busy) throw new ConflictException(`${table.name} กำลังใช้งานอยู่`);
      if (opts.customerId) {
        const c = await tx.customer.findFirst({ where: { id: opts.customerId, shopId } });
        if (!c) throw new BadRequestException('ไม่พบลูกค้า');
      }
      const now = new Date();
      const cands = await this.candidates(tx, shopId, tableId, opts.customerId ?? null, now);
      return tx.tableSession.create({
        data: {
          shopId,
          tableId,
          customerId: opts.customerId ?? null,
          customerName: opts.customerName?.trim() || null,
          bookingId: opts.bookingId ?? null,
          startedAt: now,
          pricePerHour: table.pricePerHour,
          discountsJson: JSON.stringify(cands),
          openedById: opts.userId ?? null,
        },
      });
    };
    const session = txIn ? await run(txIn) : await this.prisma.$transaction(run);
    if (!txIn) this.afterChange(shopId, tableId);
    return session;
  }

  afterChange(shopId: string, tableId: string) {
    this.realtime.changed(shopId, 'tables');
    this.syncDevice(tableId).catch((e) => this.log.warn(e.message));
  }

  private async active(shopId: string, sessionId: string) {
    const s = await this.prisma.tableSession.findFirst({ where: { id: sessionId, shopId }, include: { booking: true, table: true } });
    if (!s) throw new NotFoundException('ไม่พบรายการเปิดโต๊ะ');
    if (s.status === SessionStatus.CLOSED) throw new BadRequestException('ปิดโต๊ะไปแล้ว');
    return s;
  }

  async pause(shopId: string, sessionId: string) {
    const s = await this.active(shopId, sessionId);
    if (s.status === SessionStatus.PAUSED) return s;
    const r = await this.prisma.tableSession.update({ where: { id: s.id }, data: { status: SessionStatus.PAUSED, pausedAt: new Date() } });
    this.afterChange(shopId, s.tableId);
    return r;
  }

  async resume(shopId: string, sessionId: string) {
    const s = await this.active(shopId, sessionId);
    if (s.status !== SessionStatus.PAUSED || !s.pausedAt) return s;
    const r = await this.prisma.tableSession.update({
      where: { id: s.id },
      data: { status: SessionStatus.RUNNING, pausedAt: null, pausedMs: s.pausedMs + (Date.now() - s.pausedAt.getTime()) },
    });
    this.afterChange(shopId, s.tableId);
    return r;
  }

  private async billFor(shopId: string, s: Awaited<ReturnType<SessionsService['active']>>, at: Date) {
    const shop = await this.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const deposit = s.booking && !s.booking.depositForfeited && s.booking.confirmedAt ? s.booking.depositAmount : 0;
    return computeBill({
      playedMs: playedMs({ ...s, endedAt: at }),
      pricePerHour: s.pricePerHour,
      rules: { roundingMin: shop.roundingMin, minimumMin: shop.minimumMin },
      candidates: JSON.parse(s.discountsJson) as DiscountCandidate[],
      deposit,
    });
  }

  /**
   * Where the bill stops: a paused session at its pause, otherwise at `at` — the moment the bill was shown —
   * so the amount on a PromptPay QR doesn't grow while the customer is paying.
   */
  private billEnd(s: { pausedAt: Date | null; startedAt: Date }, at?: string) {
    if (s.pausedAt) return s.pausedAt;
    if (!at) return new Date();
    const t = new Date(at);
    const now = Date.now();
    if (Number.isNaN(t.getTime()) || t.getTime() < s.startedAt.getTime() || t.getTime() > now) throw new BadRequestException('เวลาบิลไม่ถูกต้อง');
    if (now - t.getTime() > BILL_HOLD_MS) throw new BadRequestException('บิลเปิดค้างไว้นานเกิน 15 นาที กรุณาเปิดบิลใหม่');
    return t;
  }

  async preview(shopId: string, sessionId: string) {
    const s = await this.active(shopId, sessionId);
    const at = s.pausedAt ?? new Date();
    const shop = await this.prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { promptpayId: true } });
    return {
      session: { id: s.id, table: s.table.name, startedAt: s.startedAt, pricePerHour: s.pricePerHour },
      at,
      promptpayReady: !!shop.promptpayId,
      bill: await this.billFor(shopId, s, at),
    };
  }

  /** QR for the bill as it stood at `at`; the counter shows it and confirms the money arrived before closing. */
  async promptpay(shopId: string, sessionId: string, at?: string) {
    const s = await this.active(shopId, sessionId);
    const shop = await this.prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { promptpayId: true } });
    if (!shop.promptpayId) throw new BadRequestException('ร้านยังไม่ได้ตั้งเลขพร้อมเพย์ ตั้งได้ที่หน้าตั้งค่า');
    const bill = await this.billFor(shopId, s, this.billEnd(s, at));
    if (bill.net <= 0) throw new BadRequestException('บิลนี้ไม่มียอดต้องเก็บ');
    return { amount: bill.net, promptpayId: maskPromptpay(shop.promptpayId), qr: await promptpayQr(shop.promptpayId, bill.net) };
  }

  async close(shopId: string, sessionId: string, method: PaymentMethod, userId: string, at?: string) {
    const s = await this.active(shopId, sessionId);
    const endedAt = this.billEnd(s, at);
    const bill = await this.billFor(shopId, s, endedAt);
    const closed = await this.prisma.$transaction(async (tx) => {
      const r = await tx.tableSession.updateMany({
        where: { id: s.id, status: { not: SessionStatus.CLOSED } },
        data: {
          status: SessionStatus.CLOSED,
          endedAt,
          pausedAt: null,
          pausedMs: s.pausedAt ? s.pausedMs : s.pausedMs,
          billedMinutes: bill.billedMinutes,
          grossAmount: bill.gross,
          discountAmount: bill.discount,
          discountLabel: bill.discountLabel,
          depositApplied: bill.depositApplied,
          netAmount: bill.net,
          paymentMethod: method,
          closedById: userId,
        },
      });
      if (r.count === 0) throw new ConflictException('รายการนี้ถูกปิดไปแล้ว');
      if (bill.net > 0) {
        await tx.payment.create({
          data: { shopId, type: PaymentType.TABLE, method, amount: bill.net, sessionId: s.id, createdById: userId },
        });
      }
      // Deposit bigger than the bill: the customer showed up, so the difference goes back in cash.
      if (bill.depositChange > 0) {
        await tx.payment.create({
          data: { shopId, type: PaymentType.REFUND, method: PaymentMethod.CASH, amount: -bill.depositChange, sessionId: s.id, bookingId: s.bookingId, createdById: userId, note: `ทอนมัดจำส่วนเกิน ${s.booking?.code ?? ''}`.trim() },
        });
      }
      return tx.tableSession.findUniqueOrThrow({ where: { id: s.id } });
    });
    this.afterChange(shopId, s.tableId);
    return { session: closed, bill };
  }

  /** Push the table state to its device (retained `session` cmd). */
  async syncDevice(tableId: string, force = false) {
    const table = await this.prisma.snookerTable.findUnique({
      where: { id: tableId },
      include: {
        device: true,
        sessions: { where: { status: { not: SessionStatus.CLOSED } } },
        bookings: { where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] }, session: { is: null } }, orderBy: { startAt: 'asc' }, take: 1 },
      },
    });
    if (!table?.device) return;
    const shop = await this.prisma.shop.findUniqueOrThrow({ where: { id: table.shopId } });
    const now = new Date();
    const s = table.sessions[0];
    const b = table.bookings[0];
    let cmd: Record<string, unknown>;
    if (s) {
      cmd = {
        type: 'session',
        state: s.status === SessionStatus.PAUSED ? 'paused' : 'running',
        table: table.label,
        startedAt: s.startedAt.getTime(),
        elapsedMs: playedMs(s, now),
        serverTime: now.getTime(),
        light: true,
      };
    } else if (b && b.startAt.getTime() - now.getTime() <= shop.earlyCheckinMin * 60000) {
      cmd = { type: 'session', state: 'reserved', table: table.label, reservedAt: b.startAt.getTime(), reservedLocal: local(b.startAt).format('HH:mm'), serverTime: now.getTime(), light: false };
    } else {
      cmd = { type: 'session', state: 'idle', table: table.label, serverTime: now.getTime(), light: false };
    }
    // Avoid re-sending the same state every minute; elapsed/serverTime don't matter for the key.
    const key = `${cmd.state}|${cmd.startedAt ?? ''}|${cmd.reservedAt ?? ''}|${s?.pausedMs ?? ''}`;
    if (!force && this.lastSent.get(table.device.id) === key) return;
    this.lastSent.set(table.device.id, key);
    this.mqtt.send(table.device.id, cmd);
  }

  async syncAllDevices() {
    const devices = await this.prisma.device.findMany({ where: { tableId: { not: null } }, select: { tableId: true } });
    for (const d of devices) await this.syncDevice(d.tableId!);
  }

  async resetScore(shopId: string, tableId: string) {
    const dev = await this.prisma.device.findFirst({ where: { shopId, tableId } });
    if (!dev) throw new NotFoundException('โต๊ะนี้ยังไม่มีบอร์ด');
    const zero = { p1: 0, p2: 0, f1: 0, f2: 0, active: 1, brk: 0 };
    await this.prisma.device.update({ where: { id: dev.id }, data: { scoreJson: JSON.stringify(zero) } });
    this.mqtt.send(dev.id, { type: 'score', ...zero });
    this.realtime.changed(shopId, 'score', { tableId, score: zero });
  }

  async history(shopId: string, limit = 50) {
    return this.prisma.tableSession.findMany({
      where: { shopId, status: SessionStatus.CLOSED },
      orderBy: { endedAt: 'desc' },
      take: Math.min(200, limit),
      include: { table: { select: { name: true } }, customer: { select: { name: true } }, booking: { select: { code: true } } },
    });
  }
}
