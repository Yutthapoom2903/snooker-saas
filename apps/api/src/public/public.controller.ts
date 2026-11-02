import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Ip, NotFoundException, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { SessionStatus } from '@prisma/client';
import { Response } from 'express';
import { Public } from '../common/auth';
import { rateLimit } from '../common/rate-limit';
import { businessToday } from '../common/time';
import { imageUpload, removeUpload } from '../common/upload';
import { BookingsService, CreateBookingInput } from '../bookings/bookings.service';
import { isLineLive } from '../line/line.service';
import { PrismaService } from '../prisma/prisma.service';
import { HOLDING } from '../sessions/sessions.service';

/** Rate limit + "is this booking waiting for a slip?" before the upload is streamed to disk. */
@Injectable()
export class SlipUploadGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    rateLimit(`slip:${req.ip}`, 20, 60 * 60000);
    const b = await this.prisma.booking.findUnique({ where: { publicToken: String(req.params.token) }, select: { status: true } });
    if (!b) throw new NotFoundException('ไม่พบการจอง');
    if (b.status !== BookingStatus.PENDING_DEPOSIT && b.status !== BookingStatus.DEPOSIT_SUBMITTED) throw new BadRequestException('สถานะการจองนี้แนบสลิปไม่ได้');
    return true;
  }
}

/** Everything a customer can reach without logging in. */
@Public()
@Controller('public')
export class PublicController {
  constructor(private prisma: PrismaService, private bookings: BookingsService) {}

  private async shop(slug: string) {
    const shop = await this.prisma.shop.findUnique({ where: { slug } });
    if (!shop || !shop.active) throw new NotFoundException('ไม่พบร้าน');
    return shop;
  }

  @Get('shops')
  shops() {
    return this.prisma.shop.findMany({ where: { active: true }, select: { slug: true, name: true, logoUrl: true, address: true }, orderBy: { name: 'asc' } });
  }

  /** Shop landing: info, live table status (no customer names), membership plans, active campaigns. */
  @Get('shops/:slug')
  async info(@Param('slug') slug: string) {
    const shop = await this.shop(slug);
    const now = new Date();
    const [tables, plans, campaigns] = await Promise.all([
      this.prisma.snookerTable.findMany({
        where: { shopId: shop.id, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          sessions: { where: { status: { not: SessionStatus.CLOSED } }, select: { status: true, startedAt: true } },
          bookings: { where: { status: { in: HOLDING }, endAt: { gt: now }, startAt: { lt: new Date(now.getTime() + 12 * 3600000) } }, orderBy: { startAt: 'asc' }, take: 1, select: { startAt: true, endAt: true } },
        },
      }),
      this.prisma.membershipPlan.findMany({ where: { shopId: shop.id, active: true }, orderBy: { price: 'asc' }, select: { id: true, name: true, price: true, durationDays: true, discountPercent: true } }),
      this.prisma.campaign.findMany({ where: { shopId: shop.id, active: true, endDate: { gte: now }, startDate: { lte: now } }, select: { id: true, name: true, description: true, type: true, value: true, daysOfWeek: true, timeFrom: true, timeTo: true, membersOnly: true } }),
    ]);
    return {
      slug: shop.slug,
      name: shop.name,
      logoUrl: shop.logoUrl,
      phone: shop.phone,
      address: shop.address,
      openTime: shop.openTime,
      closeTime: shop.closeTime,
      open24h: shop.open24h,
      closedWeekdays: shop.closedWeekdays,
      depositAmount: shop.depositAmount,
      lateGraceMin: shop.lateGraceMin,
      lineLive: isLineLive(shop),
      lineOaBasicId: shop.lineOaBasicId,
      today: businessToday(shop, now),
      bookingHorizonDays: shop.bookingHorizonDays,
      tables: tables.map((t) => {
        const s = t.sessions[0];
        const b = t.bookings[0];
        const reservedSoon = b && b.startAt.getTime() - now.getTime() < 60 * 60000;
        return {
          id: t.id,
          name: t.name,
          pricePerHour: t.pricePerHour,
          bookable: t.bookable,
          status: s ? (s.status === SessionStatus.PAUSED ? 'paused' : 'playing') : reservedSoon ? 'reserved' : 'free',
          since: s?.startedAt ?? null,
          nextBookingAt: b?.startAt ?? null,
        };
      }),
      plans,
      campaigns,
    };
  }

  @Get('shops/:slug/calendar')
  async calendar(@Param('slug') slug: string) {
    return this.bookings.calendar(await this.shop(slug));
  }

  @Get('shops/:slug/availability')
  async availability(@Param('slug') slug: string, @Query('date') date?: string) {
    const shop = await this.shop(slug);
    const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : businessToday(shop);
    return { date: d, openTime: shop.openTime, closeTime: shop.closeTime, open24h: shop.open24h, tables: await this.bookings.availability(shop, d) };
  }

  @Post('shops/:slug/bookings')
  async create(@Param('slug') slug: string, @Body() body: CreateBookingInput, @Ip() ip: string) {
    rateLimit(`book:${ip}`, 10, 60 * 60000);
    const shop = await this.shop(slug);
    return this.bookings.createDraft(shop, body);
  }

  @Get('bookings/:token')
  view(@Param('token') token: string) {
    return this.bookings.customerView(token);
  }

  @Get('bookings/:token/qr.png')
  async qr(@Param('token') token: string, @Res() res: Response) {
    const png = await this.bookings.qrPng(token);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  }

  @Post('bookings/:token/link-line')
  link(@Param('token') token: string, @Body() body: { idToken?: string; mock?: boolean }, @Ip() ip: string) {
    rateLimit(`link:${ip}`, 30, 60 * 60000);
    return this.bookings.linkLine(token, body);
  }

  @Post('bookings/:token/slip')
  @UseGuards(SlipUploadGuard) // runs before multer, so rejected requests never touch the disk
  @UseInterceptors(FileInterceptor('file', imageUpload('slips', 8)))
  async slip(@Param('token') token: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('แนบรูปสลิป');
    const url = `/uploads/slips/${file.filename}`;
    try {
      return await this.bookings.attachSlip(token, url);
    } catch (e) {
      removeUpload(url);
      throw e;
    }
  }
}
