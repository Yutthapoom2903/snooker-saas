import { Controller, ForbiddenException, Get, HttpCode, Logger, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { Public, ShopId } from '../common/auth';
import { BookingsService } from '../bookings/bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { LineService } from './line.service';

interface LineEvent {
  type: string;
  replyToken?: string;
  source: { type: string; userId?: string; groupId?: string; roomId?: string };
  postback?: { data: string };
  message?: { type: string; text?: string };
}

@Controller('line')
export class LineController {
  private readonly log = new Logger('LINE webhook');
  constructor(private prisma: PrismaService, private line: LineService, private bookings: BookingsService) {}

  /** Admin → LINE inbox: every message the system sent (mock or live). */
  @Get('outbox')
  async outbox(@ShopId() shopId: string, @Query('limit') limit?: string) {
    const rows = await this.prisma.lineOutbox.findMany({ where: { shopId }, orderBy: { createdAt: 'desc' }, take: Math.min(100, Number(limit) || 40) });
    // The inbox threads messages by booking, so each row carries who the booking is for.
    const ids = [...new Set(rows.map((r) => r.bookingId).filter((id): id is string => !!id))];
    const bookings = ids.length
      ? await this.prisma.booking.findMany({ where: { shopId, id: { in: ids } }, select: { id: true, code: true, name: true, startAt: true, status: true, table: { select: { name: true } } } })
      : [];
    const byId = new Map(bookings.map((b) => [b.id, { code: b.code, name: b.name, startAt: b.startAt, status: b.status, table: b.table?.name ?? null }]));
    return rows.map((r) => ({ ...r, booking: r.bookingId ? byId.get(r.bookingId) ?? null : null }));
  }

  @Public()
  @Post('webhook/:slug')
  @HttpCode(200)
  async webhook(@Param('slug') slug: string, @Req() req: RawBodyRequest<Request>) {
    const shop = await this.prisma.shop.findUnique({ where: { slug } });
    if (!shop) throw new NotFoundException();
    if (!req.rawBody || !this.line.verifySignature(shop, req.rawBody, req.header('x-line-signature'))) throw new ForbiddenException('bad signature');

    const events = (req.body?.events ?? []) as LineEvent[];
    for (const ev of events) {
      const sourceId = ev.source.groupId ?? ev.source.roomId ?? ev.source.userId ?? '';
      try {
        if (ev.type === 'join' || (ev.type === 'message' && ev.message?.text?.trim() === 'ไอดี')) {
          // Helps setup: owner adds the bot to the staff group, types "ไอดี", then pastes the id into settings.
          await this.prisma.shop.update({ where: { id: shop.id }, data: { lineLastSeenGroupId: sourceId } });
          await this.reply(shop.lineAccessToken, ev.replyToken, `ID ของห้องนี้: ${sourceId}\nนำไปใส่ใน ตั้งค่า → LINE → ผู้รับการแจ้งเตือน`);
        } else if (ev.type === 'postback' && ev.postback) {
          if (!shop.lineAdminTargetId || sourceId !== shop.lineAdminTargetId) {
            await this.reply(shop.lineAccessToken, ev.replyToken, 'ไม่มีสิทธิ์ยืนยันการจอง');
            continue;
          }
          const p = new URLSearchParams(ev.postback.data);
          const id = p.get('b') ?? '';
          const by = `line:${ev.source.userId ?? sourceId}`;
          if (p.get('a') === 'confirm') {
            const b = await this.bookings.confirm(shop.id, id, by);
            await this.reply(shop.lineAccessToken, ev.replyToken, `✅ ยืนยันการจอง ${b.code} แล้ว ส่ง QR ให้ลูกค้าเรียบร้อย`);
          } else if (p.get('a') === 'reject') {
            const b = await this.bookings.reject(shop.id, id, undefined, by);
            await this.reply(shop.lineAccessToken, ev.replyToken, `❌ ปฏิเสธการจอง ${b.code} แล้ว`);
          }
        }
      } catch (e) {
        this.log.warn(`${shop.slug}: ${(e as Error).message}`);
        await this.reply(shop.lineAccessToken, ev.replyToken, `ทำรายการไม่สำเร็จ: ${(e as Error).message}`);
      }
    }
    return { ok: true };
  }

  private async reply(token: string | null, replyToken: string | undefined, text: string) {
    if (!token || !replyToken) return;
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    }).catch(() => undefined);
  }
}
