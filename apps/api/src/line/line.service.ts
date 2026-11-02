import { Injectable, Logger } from '@nestjs/common';
import { Booking, Shop, SnookerTable } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { thaiDate, local } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

type FlexMessage = { type: 'flex'; altText: string; contents: unknown } | { type: 'text'; text: string };
export type BookingWithTable = Booking & { table: SnookerTable };

const GREEN = '#0F7A4A';

export function isLineLive(shop: Shop) {
  return !!(shop.lineAccessToken && shop.lineChannelSecret);
}

/**
 * Sends LINE messages for a shop. Without credentials the shop is in mock
 * mode: messages are only written to LineOutbox, and Admin → LINE inbox shows
 * them with working buttons, so the whole booking flow can be tested offline.
 */
@Injectable()
export class LineService {
  private readonly log = new Logger('LINE');
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  webUrl(path: string) {
    return `${(process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '')}${path}`;
  }

  verifySignature(shop: Shop, rawBody: Buffer, signature: string | undefined): boolean {
    if (!shop.lineChannelSecret || !signature) return false;
    const expected = createHmac('sha256', shop.lineChannelSecret).update(rawBody).digest();
    const got = Buffer.from(signature, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  /** Verify a LIFF ID token; returns the LINE user. */
  async verifyIdToken(shop: Shop, idToken: string): Promise<{ userId: string; name: string }> {
    if (!shop.lineLoginChannelId) throw new Error('LINE Login channel not configured');
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: shop.lineLoginChannelId }),
    });
    if (!res.ok) throw new Error(`LINE verify failed: ${res.status}`);
    const body = (await res.json()) as { sub: string; name?: string };
    return { userId: body.sub, name: body.name ?? 'LINE user' };
  }

  private async push(shop: Shop, audience: 'CUSTOMER' | 'ADMIN', to: string | null, messages: FlexMessage[], bookingId?: string) {
    const live = isLineLive(shop) && !!to;
    let error: string | null = null;
    if (live) {
      try {
        const res = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shop.lineAccessToken}` },
          body: JSON.stringify({ to, messages }),
        });
        if (!res.ok) error = `${res.status} ${(await res.text()).slice(0, 300)}`;
      } catch (e) {
        error = (e as Error).message;
      }
      if (error) this.log.warn(`push to ${audience} failed: ${error}`);
    }
    await this.prisma.lineOutbox.create({
      data: {
        shopId: shop.id,
        to: to ?? (audience === 'ADMIN' ? 'admin' : `customer:${bookingId}`),
        audience,
        altText: messages.map((m) => (m.type === 'flex' ? m.altText : m.text)).join(' | '),
        payload: JSON.stringify(messages),
        bookingId,
        mock: !live,
        error,
      },
    });
    this.realtime.changed(shop.id, 'line');
  }

  // ---------- booking messages ----------

  depositRequest(shop: Shop, b: BookingWithTable) {
    return this.push(shop, 'CUSTOMER', b.lineUserId, [
      flex(`ชำระมัดจำ ${b.depositAmount} บาท การจอง ${b.code}`, bubble(shop, 'ชำระมัดจำเพื่อยืนยันการจอง', [
        ...bookingRows(b),
        row('มัดจำ', `${b.depositAmount} บาท`, true),
        note(`หากไม่มาหรือมาสายเกิน ${shop.lateGraceMin} นาที ทางร้านขอสงวนสิทธิ์ไม่คืนมัดจำ`),
      ], [uriButton('จ่ายมัดจำและแนบสลิป', this.webUrl(`/s/${shop.slug}/liff?b=${b.publicToken}`))])),
    ], b.id);
  }

  adminConfirmCard(shop: Shop, b: BookingWithTable, prefix = '') {
    const check = b.slipCheck ? (JSON.parse(b.slipCheck) as { verdict: string; reasons: string[]; amount: number | null }) : null;
    const checkRows = !check
      ? []
      : check.verdict === 'fail'
        ? [note(`⚠ ตรวจสลิปไม่ผ่าน: ${check.reasons.join(' / ')}`)]
        : check.reasons.length
          ? [{ type: 'text', text: `ตรวจด้วยตา: ${check.reasons.join(' / ')}`, size: 'xs', color: '#8a6210', wrap: true, margin: 'md' }]
          : [];
    const body = [
      ...bookingRows(b),
      row('ผู้จอง', `${b.name} (${b.phone})`),
      row('จำนวน', `${b.partySize} คน`),
      ...(b.note ? [row('หมายเหตุ', b.note)] : []),
      row('มัดจำ', `${b.depositAmount} บาท — แนบสลิปแล้ว`, true),
      ...checkRows,
    ];
    const buttons = [
      ...(b.slipUrl ? [uriButton('ดูสลิป', this.webUrl(b.slipUrl), 'secondary')] : []),
      postbackButton('ยืนยัน', `a=confirm&b=${b.id}`),
      postbackButton('ปฏิเสธ', `a=reject&b=${b.id}`, 'secondary'),
    ];
    return this.push(shop, 'ADMIN', shop.lineAdminTargetId, [
      flex(`${prefix}การจองใหม่ ${b.code} รอยืนยัน`, bubble(shop, `${prefix}การจองใหม่ · ${b.code}`, body, buttons)),
    ], b.id);
  }

  /** Nobody checked the slip for a while: card again to the group, plus the owner directly. */
  async slipReminder(shop: Shop, b: BookingWithTable, minutes: number) {
    await this.adminConfirmCard(shop, b, `⏰ รอนานกว่า ${minutes} นาที · `);
    await this.ownerNotice(shop, `⏰ สลิปการจอง ${b.code} (${b.name}) รอตรวจเกิน ${minutes} นาที ยังไม่มีใครยืนยัน`, b.id);
  }

  /** The booking time came and the slip was never reviewed. The customer paid, so tell everyone. */
  async slipUnreviewedExpired(shop: Shop, b: BookingWithTable) {
    await this.push(shop, 'CUSTOMER', b.lineUserId, [
      { type: 'text', text: `ขออภัย ร้านยังไม่ได้ยืนยันการจอง ${b.code} ทันเวลา การจองนี้จึงถูกยกเลิก\nกรุณาติดต่อร้าน ${shop.name}${shop.phone ? ` โทร ${shop.phone}` : ''} เพื่อรับมัดจำ ${b.depositAmount} บาทคืน` },
    ], b.id);
    const msg = `❗ การจอง ${b.code} (${b.name} ${b.phone}) หมดเวลาโดยไม่มีใครตรวจสลิป ลูกค้าโอนมัดจำ ${b.depositAmount} บาทแล้ว ต้องโอนคืน`;
    await this.adminNotice(shop, msg, b.id);
    await this.ownerNotice(shop, msg, b.id);
  }

  ownerNotice(shop: Shop, text: string, bookingId?: string) {
    if (!shop.lineOwnerTargetId && isLineLive(shop)) return Promise.resolve();
    return this.push(shop, 'ADMIN', shop.lineOwnerTargetId ?? 'owner', [{ type: 'text', text: `[ถึงเจ้าของร้าน] ${text}` }], bookingId);
  }

  confirmed(shop: Shop, b: BookingWithTable) {
    const ticket = this.webUrl(`/s/${shop.slug}/b/${b.publicToken}`);
    return this.push(shop, 'CUSTOMER', b.lineUserId, [
      flex(`ยืนยันการจอง ${b.code} แล้ว`, bubble(shop, 'ยืนยันการจองแล้ว ✓', [
        { type: 'image', url: this.webUrl(`/api/public/bookings/${b.publicToken}/qr.png`), size: 'xl', aspectRatio: '1:1' },
        { type: 'text', text: b.code, align: 'center', weight: 'bold', size: 'xl', color: GREEN },
        ...bookingRows(b),
        note(`แสดง QR นี้ที่ร้าน ใช้ได้ตั้งแต่ ${shop.earlyCheckinMin} นาทีก่อนเวลา ถึงสายได้ไม่เกิน ${shop.lateGraceMin} นาที หลังจากนั้น QR จะใช้ไม่ได้และไม่คืนมัดจำ`),
      ], [uriButton('เปิดตั๋วการจอง', ticket)])),
    ], b.id);
  }

  rejected(shop: Shop, b: BookingWithTable) {
    return this.push(shop, 'CUSTOMER', b.lineUserId, [
      { type: 'text', text: `การจอง ${b.code} ไม่ได้รับการยืนยัน${b.rejectReason ? `: ${b.rejectReason}` : ''}\nกรุณาติดต่อร้าน ${shop.name}${shop.phone ? ` โทร ${shop.phone}` : ''}` },
    ], b.id);
  }

  noShow(shop: Shop, b: BookingWithTable) {
    return this.push(shop, 'CUSTOMER', b.lineUserId, [
      { type: 'text', text: `การจอง ${b.code} หมดเวลาแล้ว (สายเกิน ${shop.lateGraceMin} นาที) QR ใช้งานไม่ได้ และร้านขอสงวนสิทธิ์ไม่คืนมัดจำตามเงื่อนไข` },
    ], b.id);
  }

  adminNotice(shop: Shop, text: string, bookingId?: string) {
    return this.push(shop, 'ADMIN', shop.lineAdminTargetId, [{ type: 'text', text }], bookingId);
  }
}

// ---------- Flex helpers ----------

function flex(altText: string, contents: unknown): FlexMessage {
  return { type: 'flex', altText, contents };
}

function bubble(shop: Shop, title: string, body: unknown[], buttons: unknown[]) {
  return {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: GREEN, paddingAll: '16px',
      contents: [
        { type: 'text', text: shop.name, color: '#D7F5E4', size: 'xs' },
        { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: body },
    footer: buttons.length ? { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } : undefined,
  };
}

function bookingRows(b: BookingWithTable) {
  return [
    row('วันที่', thaiDate(b.startAt)),
    row('เวลา', `${local(b.startAt).format('HH:mm')}–${local(b.endAt).format('HH:mm')} น.`),
    row('โต๊ะ', b.table.name),
  ];
}

function row(label: string, value: string, strong = false) {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#6B7C72', flex: 2 },
      { type: 'text', text: value, size: 'sm', color: strong ? GREEN : '#1B2A22', weight: strong ? 'bold' : 'regular', flex: 5, wrap: true },
    ],
  };
}

function note(text: string) {
  return { type: 'text', text, size: 'xs', color: '#B4502E', wrap: true, margin: 'md' };
}

function uriButton(label: string, uri: string, style: 'primary' | 'secondary' = 'primary') {
  return { type: 'button', style, color: style === 'primary' ? GREEN : undefined, action: { type: 'uri', label, uri } };
}

function postbackButton(label: string, data: string, style: 'primary' | 'secondary' = 'primary') {
  return { type: 'button', style, color: style === 'primary' ? GREEN : undefined, action: { type: 'postback', label, data } };
}
