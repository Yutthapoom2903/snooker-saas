import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingStatus, PaymentMethod, PaymentType, Prisma, Shop } from '@prisma/client';
import { toDataURL, toBuffer } from 'qrcode';
import { maskPromptpay, promptpayQr } from '../common/promptpay';
import { addDays, businessToday, businessWindow, fromLocal, hm, isClosedDay, local } from '../common/time';
import { randomToken, shortCode } from '../common/util';
import { isLineLive, LineService } from '../line/line.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { HOLDING, SessionsService } from '../sessions/sessions.service';
import { signBookingQr, verifyBookingQr } from './qr-token';
import { join } from 'path';
import { UPLOAD_ROOT, removeUpload } from '../common/upload';
import { readSlipQr } from '../slips/slip-qr';
import { verifyWithProvider } from '../slips/slip-providers';
import { checkSlip } from '../slips/slip-rules';

export interface SlipCheck {
  verdict: 'pass' | 'fail' | 'manual';
  provider: string | null;
  reasons: string[];
  amount: number | null;
}

/** Staff get re-notified about a slip nobody has checked after this long. */
const SLIP_REMIND_MIN = 10;

export interface CreateBookingInput {
  date: string; // YYYY-MM-DD local
  time: string; // HH:mm local
  hours: number; // 1..4
  partySize: number;
  tableId?: string | null; // null/empty = any free table
  name: string;
  phone: string;
  note?: string;
}

/** Drafts hold their slot briefly so two people can't grab the same table mid-flow. */
const DRAFT_HOLD_MIN = 15;
/** A linked booking must get its slip within this time or it expires. */
const DEPOSIT_WINDOW_MIN = 30;

@Injectable()
export class BookingsService {
  private readonly log = new Logger('Bookings');

  constructor(
    private prisma: PrismaService,
    private line: LineService,
    private sessions: SessionsService,
    private realtime: RealtimeGateway,
  ) {}

  private holdingWhere(now = new Date()): Prisma.BookingWhereInput {
    return {
      OR: [
        { status: { in: HOLDING } },
        { status: BookingStatus.DRAFT, createdAt: { gt: new Date(now.getTime() - DRAFT_HOLD_MIN * 60000) } },
      ],
    };
  }

  /** Busy intervals per bookable table for a local date (for the booking form). */
  async availability(shop: Shop, date: string) {
    const dayStart = fromLocal(date, '00:00');
    const dayEnd = new Date(dayStart.getTime() + 30 * 3600000); // covers past-midnight closing
    const tables = await this.prisma.snookerTable.findMany({
      where: { shopId: shop.id, active: true, bookable: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        bookings: {
          where: { AND: [this.holdingWhere(), { startAt: { lt: dayEnd } }, { endAt: { gt: dayStart } }] },
          select: { startAt: true, endAt: true },
        },
      },
    });
    return tables.map((t) => ({
      id: t.id,
      name: t.name,
      pricePerHour: t.pricePerHour,
      busy: t.bookings.map((b) => ({ start: local(b.startAt).format('HH:mm'), end: local(b.endAt).format('HH:mm'), startAt: b.startAt, endAt: b.endAt })),
    }));
  }

  private validateSlot(shop: Shop, input: CreateBookingInput) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) throw new BadRequestException('วันหรือเวลาไม่ถูกต้อง');
    const hours = Number(input.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 4) throw new BadRequestException('จองได้ 1–4 ชั่วโมง');
    const startAt = fromLocal(input.date, input.time);
    const endAt = new Date(startAt.getTime() + hours * 3600000);
    if (startAt.getTime() < Date.now() + 15 * 60000) throw new BadRequestException('ต้องจองล่วงหน้าอย่างน้อย 15 นาที');

    // Opening hours; a time before opening that falls inside a past-midnight close
    // belongs to the previous business day (01:00 on the 3rd = the night of the 2nd).
    const { open, close } = businessWindow(shop);
    let s = hm(input.time);
    let bizDate = input.date;
    if (s < open && s + 24 * 60 < close) {
      s += 24 * 60;
      bizDate = addDays(input.date, -1);
    }
    const e = s + hours * 60;
    // A 24-hour shop has no closing time, so a game may run past midnight.
    if (!shop.open24h && (s < open || e > close)) throw new BadRequestException(`ร้านเปิด ${shop.openTime}–${shop.closeTime} น.`);
    if (isClosedDay(shop, bizDate)) throw new BadRequestException('ร้านปิดวันนั้น');
    if (bizDate > addDays(businessToday(shop), shop.bookingHorizonDays)) {
      throw new BadRequestException(`จองล่วงหน้าได้ไม่เกิน ${shop.bookingHorizonDays} วัน`);
    }
    return { startAt, endAt };
  }

  /**
   * Day-by-day status for the booking calendar: closed, full (no table has a
   * free hour), few (≤ a quarter of tables still have one), or open.
   */
  async calendar(shop: Shop) {
    const today = businessToday(shop);
    const days = Math.min(60, Math.max(0, shop.bookingHorizonDays)) + 1;
    const { open, close } = businessWindow(shop);
    const rangeStart = fromLocal(today, '00:00');
    const rangeEnd = new Date(fromLocal(addDays(today, days), '00:00').getTime() + close * 60000);
    const tables = await this.prisma.snookerTable.findMany({
      where: { shopId: shop.id, active: true, bookable: true },
      select: { id: true, bookings: { where: { AND: [this.holdingWhere(), { startAt: { lt: rangeEnd } }, { endAt: { gt: rangeStart } }] }, select: { startAt: true, endAt: true } } },
    });
    const earliest = Date.now() + 15 * 60000;
    const out: { date: string; status: 'open' | 'few' | 'full' | 'closed' }[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(today, i);
      if (isClosedDay(shop, date)) {
        out.push({ date, status: 'closed' });
        continue;
      }
      const dayStart = fromLocal(date, '00:00').getTime();
      const from = Math.max(dayStart + open * 60000, earliest);
      const to = dayStart + close * 60000;
      let free = 0;
      for (const t of tables) {
        const busy = t.bookings
          .map((b) => [b.startAt.getTime(), b.endAt.getTime()] as const)
          .filter(([a, b]) => a < to && b > from)
          .sort((x, y) => x[0] - y[0]);
        const ok = from < to && gapExists(busy, from, to);
        if (ok) free++;
      }
      const status = free === 0 ? 'full' : free <= Math.max(1, Math.ceil(tables.length / 4)) ? 'few' : 'open';
      out.push({ date, status });
    }
    return { today, horizonDays: shop.bookingHorizonDays, days: out };
  }

  async createDraft(shop: Shop, input: CreateBookingInput) {
    const name = input.name?.trim();
    const phone = input.phone?.replace(/[^\d]/g, '');
    if (!name || name.length > 80) throw new BadRequestException('กรอกชื่อผู้จอง');
    if (!phone || phone.length < 9 || phone.length > 10) throw new BadRequestException('เบอร์โทรไม่ถูกต้อง');
    const partySize = Math.max(1, Math.min(12, Number(input.partySize) || 2));
    const { startAt, endAt } = this.validateSlot(shop, input);

    const booking = await this.prisma.$transaction(async (tx) => {
      // Take the shop's write lock before reading, so two customers submitting the same slot run one
      // after the other: the second one then sees the first booking instead of both passing the check.
      // (SQLite: grabs the write lock up front. PostgreSQL: row lock on the shop.)
      await tx.$executeRaw`UPDATE "Shop" SET "id" = "id" WHERE "id" = ${shop.id}`;
      const bookable = await tx.snookerTable.findMany({
        where: { shopId: shop.id, active: true, bookable: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      const tables = input.tableId ? bookable.filter((t) => t.id === input.tableId) : bookable;
      if (!tables.length) throw new BadRequestException('ไม่พบโต๊ะที่เปิดให้จอง');
      const chosen = await this.firstFree(tx, tables, startAt, endAt);
      if (!chosen) {
        const asked = tables.length === 1 && input.tableId ? tables[0].name : null;
        throw new ConflictException({
          statusCode: 409,
          message: asked ? `${asked} ช่วงเวลานั้นเพิ่งมีคนจองไป` : 'ช่วงเวลานั้นโต๊ะเต็มแล้ว',
          alternatives: await this.alternatives(tx, shop, input, bookable, startAt, endAt),
        });
      }
      return tx.booking.create({
        data: {
          shopId: shop.id,
          code: shortCode(6),
          publicToken: randomToken(),
          tableId: chosen.id,
          name,
          phone,
          partySize,
          note: input.note?.trim().slice(0, 300) || null,
          startAt,
          endAt,
          depositAmount: shop.depositAmount,
        },
        include: { table: true },
      });
    });

    this.realtime.changed(shop.id, 'bookings');
    // Live LINE: go through LIFF (login gives us the userId). Mock: our own page fakes it.
    const lineUrl = isLineLive(shop) && shop.lineLiffId
      ? `https://liff.line.me/${shop.lineLiffId}?b=${booking.publicToken}`
      : `/s/${shop.slug}/liff?b=${booking.publicToken}&mock=1`;
    return { publicToken: booking.publicToken, code: booking.code, table: booking.table.name, lineUrl };
  }

  private async firstFree<T extends { id: string }>(tx: Prisma.TransactionClient, tables: T[], startAt: Date, endAt: Date) {
    for (const t of tables) {
      const clash = await tx.booking.findFirst({
        where: { AND: [{ tableId: t.id }, this.holdingWhere(), { startAt: { lt: endAt } }, { endAt: { gt: startAt } }] },
      });
      if (!clash) return t;
    }
    return null;
  }

  /**
   * What a customer who lost a slot can take instead, in one tap: another table at the same time,
   * then the same table (or any table) up to 3 hours later in 30-minute steps.
   */
  private async alternatives(
    tx: Prisma.TransactionClient,
    shop: Shop,
    input: CreateBookingInput,
    bookable: { id: string; name: string }[],
    startAt: Date,
    endAt: Date,
  ) {
    const out: { tableId: string | null; table: string; date: string; time: string }[] = [];
    if (input.tableId) {
      const other = await this.firstFree(tx, bookable.filter((t) => t.id !== input.tableId), startAt, endAt);
      if (other) out.push({ tableId: other.id, table: other.name, date: input.date, time: input.time });
    }
    const want = input.tableId ? bookable.filter((t) => t.id === input.tableId) : bookable;
    for (let step = 1; step <= 6; step++) {
      const at = local(startAt.getTime() + step * 30 * 60000);
      const later = { ...input, date: at.format('YYYY-MM-DD'), time: at.format('HH:mm') };
      let slot: { startAt: Date; endAt: Date };
      try {
        slot = this.validateSlot(shop, later);
      } catch {
        break; // past closing time or the booking horizon
      }
      const t = await this.firstFree(tx, want, slot.startAt, slot.endAt);
      if (t) {
        out.push({ tableId: input.tableId ? t.id : null, table: t.name, date: later.date, time: later.time });
        break;
      }
    }
    return out;
  }

  private async byToken(publicToken: string) {
    const b = await this.prisma.booking.findUnique({ where: { publicToken }, include: { table: true, shop: true } });
    if (!b) throw new NotFoundException('ไม่พบการจอง');
    return b;
  }

  /** What the customer's LIFF / ticket page shows. */
  async customerView(publicToken: string) {
    const b = await this.byToken(publicToken);
    const shop = b.shop;
    const promptpay = shop.promptpayId && [BookingStatus.DRAFT, BookingStatus.PENDING_DEPOSIT].includes(b.status as never)
      ? await promptpayQr(shop.promptpayId, b.depositAmount)
      : null;
    const qr = b.status === BookingStatus.CONFIRMED ? await toDataURL(signBookingQr(b.id), { margin: 1, width: 360 }) : null;
    return {
      code: b.code,
      status: b.status,
      name: b.name,
      partySize: b.partySize,
      table: b.table.name,
      startAt: b.startAt,
      endAt: b.endAt,
      depositAmount: b.depositAmount,
      hasSlip: !!b.slipUrl,
      slipCheck: b.slipCheck ? (JSON.parse(b.slipCheck) as SlipCheck) : null,
      lineLinked: !!b.lineUserId,
      checkinFrom: new Date(b.startAt.getTime() - shop.earlyCheckinMin * 60000),
      expiresAt: new Date(b.startAt.getTime() + shop.lateGraceMin * 60000),
      rejectReason: b.rejectReason,
      promptpayQr: promptpay,
      promptpayId: shop.promptpayId ? maskPromptpay(shop.promptpayId) : null,
      bookingQr: qr,
      shop: { name: shop.name, slug: shop.slug, logoUrl: shop.logoUrl, phone: shop.phone, lateGraceMin: shop.lateGraceMin, lineOaBasicId: shop.lineOaBasicId, liffId: shop.lineLiffId, live: isLineLive(shop) },
    };
  }

  async qrPng(publicToken: string) {
    const b = await this.byToken(publicToken);
    if (b.status !== BookingStatus.CONFIRMED) throw new NotFoundException();
    return toBuffer(signBookingQr(b.id), { margin: 2, width: 480 });
  }

  /** Step 2: bind the booking to a LINE user (LIFF id token, or mock in mock mode). */
  async linkLine(publicToken: string, body: { idToken?: string; mock?: boolean }) {
    const b = await this.byToken(publicToken);
    const shop = b.shop;
    // Already linked: don't touch the row (a write would bump updatedAt and extend the hold).
    if (b.status !== BookingStatus.DRAFT) return this.customerView(publicToken);
    if (b.status === BookingStatus.DRAFT && Date.now() - b.createdAt.getTime() > DRAFT_HOLD_MIN * 60000) {
      throw new BadRequestException('การจองนี้หมดเวลาแล้ว กรุณาจองใหม่');
    }

    let user: { userId: string; name: string };
    if (isLineLive(shop)) {
      if (!body.idToken) throw new BadRequestException('ต้องเปิดผ่าน LINE');
      user = await this.line.verifyIdToken(shop, body.idToken).catch(() => {
        throw new ForbiddenException('ยืนยันตัวตน LINE ไม่สำเร็จ');
      });
    } else {
      user = { userId: `mock-${b.phone}`, name: b.name };
    }

    const customer = await this.prisma.customer.upsert({
      where: { shopId_lineUserId: { shopId: shop.id, lineUserId: user.userId } },
      create: { shopId: shop.id, name: b.name, phone: b.phone, lineUserId: user.userId, lineName: user.name },
      update: { lineName: user.name, phone: b.phone },
    });
    const updated = await this.prisma.booking.update({
      where: { id: b.id },
      data: { lineUserId: user.userId, customerId: customer.id, status: BookingStatus.PENDING_DEPOSIT },
      include: { table: true },
    });
    if (b.status === BookingStatus.DRAFT) await this.line.depositRequest(shop, updated);
    this.realtime.changed(shop.id, 'bookings');
    return this.customerView(publicToken);
  }

  /**
   * Step 3: slip uploaded. Read its QR (reject a slip already used for another
   * booking), verify with the bank through the shop's provider if it has one, and
   * auto-confirm when everything checks out. Anything else goes to staff with reasons.
   */
  async attachSlip(publicToken: string, slipUrl: string) {
    const b = await this.byToken(publicToken);
    if (b.status !== BookingStatus.PENDING_DEPOSIT && b.status !== BookingStatus.DEPOSIT_SUBMITTED) {
      throw new BadRequestException('สถานะการจองนี้แนบสลิปไม่ได้');
    }
    const shop = b.shop;
    const qr = readSlipQr(join(UPLOAD_ROOT, 'slips', slipUrl.split('/').pop()!));
    const check: SlipCheck = { verdict: 'manual', provider: null, reasons: [], amount: null };
    let slipRef = qr?.transRef ?? null;
    if (!qr) check.reasons.push('ไม่พบ QR บนสลิป ตรวจยอดและบัญชีผู้รับด้วยตาให้ละเอียด');

    if (qr) {
      const verified = await verifyWithProvider(shop, qr.payload);
      if (verified) {
        check.provider = shop.slipProvider;
        if (verified.kind === 'ok') {
          slipRef = verified.slip.transRef || slipRef;
          check.amount = verified.slip.amount;
          check.reasons = checkSlip(verified.slip, {
            depositAmount: b.depositAmount,
            bookingCreatedAt: b.createdAt,
            shopAccounts: [shop.promptpayId ?? '', ...shop.slipReceiverAccounts.split(',')],
          });
          check.verdict = check.reasons.length ? 'fail' : 'pass';
        } else {
          check.verdict = verified.kind === 'rejected' ? 'fail' : 'manual';
          check.reasons.push(verified.reason);
        }
      }
    }

    if (slipRef) {
      const used = await this.prisma.booking.findFirst({ where: { slipRef, id: { not: b.id } }, select: { code: true } });
      if (used) throw new BadRequestException('สลิปนี้เคยใช้กับการจองอื่นแล้ว กรุณาแนบสลิปของการโอนครั้งนี้');
    }

    try {
      const r = await this.prisma.booking.updateMany({
        where: { id: b.id, status: { in: [BookingStatus.PENDING_DEPOSIT, BookingStatus.DEPOSIT_SUBMITTED] } },
        data: { slipUrl, slipRef, slipCheck: JSON.stringify(check), submittedAt: new Date(), remindedAt: null, status: BookingStatus.DEPOSIT_SUBMITTED },
      });
      if (r.count === 0) throw new ConflictException('การจองถูกดำเนินการไปแล้ว');
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BadRequestException('สลิปนี้เคยใช้กับการจองอื่นแล้ว');
      throw e;
    }
    if (b.slipUrl && b.slipUrl !== slipUrl) removeUpload(b.slipUrl);

    if (check.verdict === 'pass') {
      await this.confirm(b.shopId, b.id, 'slip:auto');
      await this.line.adminNotice(shop, `✅ ${b.code} ยืนยันอัตโนมัติ ตรวจสลิปกับธนาคารแล้ว ยอด ${check.amount} บาท (${b.name}, ${b.table.name})`, b.id);
    } else {
      const updated = await this.prisma.booking.findUniqueOrThrow({ where: { id: b.id }, include: { table: true } });
      await this.line.adminConfirmCard(shop, updated);
    }
    this.realtime.changed(b.shopId, 'bookings');
    return this.customerView(publicToken);
  }

  // ---------- staff actions ----------

  async list(shopId: string, q: { from?: string; to?: string; status?: string }) {
    const where: Prisma.BookingWhereInput = { shopId };
    if (q.from) where.startAt = { gte: fromLocal(q.from) };
    if (q.to) where.startAt = { ...(where.startAt as object), lt: new Date(fromLocal(q.to).getTime() + 86400000) };
    if (q.status) where.status = { in: q.status.split(',') as BookingStatus[] };
    return this.prisma.booking.findMany({
      where,
      orderBy: { startAt: 'asc' },
      take: 300,
      include: { table: { select: { name: true } } },
    });
  }

  private async staffBooking(shopId: string, id: string) {
    const b = await this.prisma.booking.findFirst({ where: { id, shopId }, include: { table: true, shop: true } });
    if (!b) throw new NotFoundException('ไม่พบการจอง');
    return b;
  }

  async confirm(shopId: string, id: string, by: string) {
    const b = await this.staffBooking(shopId, id);
    if (b.status === BookingStatus.CONFIRMED) return b;
    if (b.status !== BookingStatus.DEPOSIT_SUBMITTED && b.status !== BookingStatus.PENDING_DEPOSIT) {
      throw new BadRequestException(`ยืนยันไม่ได้ สถานะปัจจุบัน: ${b.status}`);
    }
    if (b.startAt.getTime() + b.shop.lateGraceMin * 60000 < Date.now()) throw new BadRequestException('เลยเวลาจองแล้ว');
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.booking.updateMany({
        where: { id: b.id, status: { in: [BookingStatus.DEPOSIT_SUBMITTED, BookingStatus.PENDING_DEPOSIT] } },
        data: { status: BookingStatus.CONFIRMED, confirmedAt: new Date(), confirmedBy: by },
      });
      if (r.count === 0) throw new ConflictException('การจองถูกดำเนินการไปแล้ว');
      await tx.payment.create({
        data: { shopId, type: PaymentType.DEPOSIT, method: PaymentMethod.PROMPTPAY, amount: b.depositAmount, bookingId: b.id, createdById: by.includes(':') ? null : by, note: `มัดจำ ${b.code}` },
      });
      return tx.booking.findUniqueOrThrow({ where: { id: b.id }, include: { table: true } });
    });
    await this.line.confirmed(b.shop, updated);
    this.realtime.changed(shopId, 'bookings');
    this.sessions.afterChange(shopId, b.tableId);
    return updated;
  }

  async reject(shopId: string, id: string, reason: string | undefined, by: string) {
    const b = await this.staffBooking(shopId, id);
    if (![BookingStatus.DRAFT, BookingStatus.PENDING_DEPOSIT, BookingStatus.DEPOSIT_SUBMITTED].includes(b.status as never)) {
      throw new BadRequestException(`ปฏิเสธไม่ได้ สถานะปัจจุบัน: ${b.status}`);
    }
    const r = await this.prisma.booking.updateMany({
      where: { id: b.id, status: { in: [BookingStatus.DRAFT, BookingStatus.PENDING_DEPOSIT, BookingStatus.DEPOSIT_SUBMITTED] } },
      data: { status: BookingStatus.REJECTED, rejectReason: reason?.slice(0, 200) || null, confirmedBy: by },
    });
    if (r.count === 0) throw new ConflictException('การจองถูกดำเนินการไปแล้ว');
    const updated = await this.prisma.booking.findUniqueOrThrow({ where: { id: b.id }, include: { table: true } });
    await this.line.rejected(b.shop, updated);
    this.realtime.changed(shopId, 'bookings');
    return updated;
  }

  /** Cancel a confirmed booking (e.g. customer called ahead). Optionally refund the deposit. */
  async cancel(shopId: string, id: string, refund: boolean, userId: string) {
    const b = await this.staffBooking(shopId, id);
    const cancellable: BookingStatus[] = [BookingStatus.DRAFT, BookingStatus.PENDING_DEPOSIT, BookingStatus.DEPOSIT_SUBMITTED, BookingStatus.CONFIRMED];
    if (!cancellable.includes(b.status)) throw new BadRequestException(`ยกเลิกไม่ได้ สถานะปัจจุบัน: ${b.status}`);
    await this.prisma.$transaction(async (tx) => {
      // Guarded on the status we read, so two concurrent cancels can't both refund.
      const r = await tx.booking.updateMany({
        where: { id: b.id, status: b.status },
        data: { status: BookingStatus.CANCELLED, depositForfeited: b.status === BookingStatus.CONFIRMED && !refund },
      });
      if (r.count === 0) throw new ConflictException('การจองถูกดำเนินการไปแล้ว');
      if (b.status === BookingStatus.CONFIRMED && refund) {
        await tx.payment.create({
          data: { shopId, type: PaymentType.REFUND, method: PaymentMethod.TRANSFER, amount: -b.depositAmount, bookingId: b.id, createdById: userId, note: `คืนมัดจำ ${b.code}` },
        });
      }
    });
    this.realtime.changed(shopId, 'bookings');
    this.sessions.afterChange(shopId, b.tableId);
  }

  /** Front desk scans the customer's QR → validate window → open the table. */
  async checkIn(shopId: string, raw: string, userId: string) {
    const id = verifyBookingQr(raw);
    if (!id) throw new BadRequestException('QR ไม่ถูกต้อง');
    const b = await this.staffBooking(shopId, id);
    const now = Date.now();
    const from = b.startAt.getTime() - b.shop.earlyCheckinMin * 60000;
    const until = b.startAt.getTime() + b.shop.lateGraceMin * 60000;
    if (b.status === BookingStatus.CHECKED_IN) throw new BadRequestException(`การจอง ${b.code} เช็คอินไปแล้ว`);
    if (b.status === BookingStatus.NO_SHOW || (b.status === BookingStatus.CONFIRMED && now > until)) {
      throw new BadRequestException(`QR หมดอายุ — สายเกิน ${b.shop.lateGraceMin} นาที (ไม่คืนมัดจำ)`);
    }
    if (b.status !== BookingStatus.CONFIRMED) throw new BadRequestException(`การจองยังไม่ยืนยัน (สถานะ ${b.status})`);
    if (now < from) throw new BadRequestException(`ยังไม่ถึงเวลา เช็คอินได้ตั้งแต่ ${local(from).format('HH:mm')} น.`);

    const r = await this.prisma.booking.updateMany({
      where: { id: b.id, status: BookingStatus.CONFIRMED },
      data: { status: BookingStatus.CHECKED_IN, checkedInAt: new Date() },
    });
    if (r.count === 0) throw new ConflictException('การจองถูกใช้ไปแล้ว');
    this.realtime.changed(shopId, 'bookings');
    this.sessions.afterChange(shopId, b.tableId);
    return { booking: await this.startInfo(shopId, b.id) };
  }

  pendingSlips(shopId: string) {
    return this.prisma.booking.count({ where: { shopId, status: BookingStatus.DEPOSIT_SUBMITTED } });
  }

  /** What the front desk needs after a check-in: the booked table and whether it's free right now. */
  async startInfo(shopId: string, id: string) {
    const b = await this.prisma.booking.findFirst({ where: { id, shopId }, include: { table: true, session: { select: { id: true } } } });
    if (!b) throw new NotFoundException('ไม่พบการจอง');
    const busy = await this.prisma.tableSession.findFirst({ where: { tableId: b.tableId, status: { not: 'CLOSED' } }, select: { id: true } });
    return {
      id: b.id, code: b.code, name: b.name, partySize: b.partySize, status: b.status,
      table: b.table.name, tableId: b.tableId, tableFree: !busy && b.table.active, started: !!b.session,
    };
  }

  /** Start the clock for a checked-in booking, on its own table or another free one. */
  async start(shopId: string, id: string, tableId: string | undefined, userId: string) {
    const b = await this.staffBooking(shopId, id);
    if (b.status !== BookingStatus.CHECKED_IN) throw new BadRequestException('ต้องสแกน QR เช็คอินก่อน');
    const target = tableId || b.tableId;
    const session = await this.prisma.$transaction(async (tx) => {
      if (await tx.tableSession.findFirst({ where: { bookingId: b.id } })) throw new ConflictException('การจองนี้เริ่มจับเวลาไปแล้ว');
      if (target !== b.tableId) await tx.booking.update({ where: { id: b.id }, data: { tableId: target } });
      return this.sessions.open(shopId, target, { customerId: b.customerId, customerName: b.name, bookingId: b.id, userId }, tx);
    });
    this.sessions.afterChange(shopId, target);
    if (target !== b.tableId) this.sessions.afterChange(shopId, b.tableId);
    this.realtime.changed(shopId, 'bookings');
    return { sessionId: session.id };
  }

  /** Every minute: kill expired QRs (no-show), expire abandoned drafts, refresh device "reserved" state. */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweep() {
    const now = Date.now();
    // Grace is per shop (≤ 1000 min); only rows that started already can be overdue.
    const confirmed = await this.prisma.booking.findMany({
      where: { status: BookingStatus.CONFIRMED, startAt: { lt: new Date(now) } },
      include: { shop: true, table: true },
    });
    for (const b of confirmed) {
      if (b.startAt.getTime() + b.shop.lateGraceMin * 60000 >= now) continue;
      const r = await this.prisma.booking.updateMany({
        where: { id: b.id, status: BookingStatus.CONFIRMED },
        data: { status: BookingStatus.NO_SHOW, depositForfeited: true },
      });
      if (r.count) {
        this.log.log(`no-show ${b.code}`);
        await this.line.noShow(b.shop, b);
        await this.line.adminNotice(b.shop, `การจอง ${b.code} (${b.name}) ไม่มาตามนัด — QR หมดอายุ ยึดมัดจำ ${b.depositAmount} บาท`, b.id);
        this.realtime.changed(b.shopId, 'bookings');
      }
    }
    const expired = await this.prisma.booking.updateMany({
      where: {
        OR: [
          { status: BookingStatus.DRAFT, createdAt: { lt: new Date(now - DRAFT_HOLD_MIN * 60000) } },
          { status: BookingStatus.PENDING_DEPOSIT, updatedAt: { lt: new Date(now - DEPOSIT_WINDOW_MIN * 60000) } },
        ],
      },
      data: { status: BookingStatus.EXPIRED },
    });
    if (expired.count) this.log.log(`expired ${expired.count} unfinished bookings`);

    // Slips nobody checked: remind staff once, then give up at the booking time.
    const waiting = await this.prisma.booking.findMany({
      where: { status: BookingStatus.DEPOSIT_SUBMITTED, OR: [{ startAt: { lt: new Date(now) } }, { remindedAt: null, submittedAt: { lt: new Date(now - SLIP_REMIND_MIN * 60000) } }] },
      include: { shop: true, table: true },
    });
    for (const b of waiting) {
      if (b.startAt.getTime() < now) {
        const r = await this.prisma.booking.updateMany({ where: { id: b.id, status: BookingStatus.DEPOSIT_SUBMITTED }, data: { status: BookingStatus.EXPIRED } });
        if (!r.count) continue;
        await this.line.slipUnreviewedExpired(b.shop, b);
        this.realtime.changed(b.shopId, 'bookings');
      } else {
        await this.prisma.booking.update({ where: { id: b.id }, data: { remindedAt: new Date() } });
        await this.line.slipReminder(b.shop, b, SLIP_REMIND_MIN);
      }
    }
    await this.sessions.syncAllDevices();
  }
}

/** True if [from, to) has a free stretch of at least one hour between the busy intervals. */
function gapExists(busy: (readonly [number, number])[], from: number, to: number) {
  let cursor = from;
  for (const [a, b] of busy) {
    if (a - cursor >= 3600000) return true;
    cursor = Math.max(cursor, b);
  }
  return to - cursor >= 3600000;
}
