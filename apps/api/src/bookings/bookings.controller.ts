import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, ShopId } from '../common/auth';
import { BookingsService } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  @Get()
  list(@ShopId() shopId: string, @Query() q: { from?: string; to?: string; status?: string }) {
    return this.bookings.list(shopId, q);
  }

  @Post('check-in')
  checkIn(@ShopId() shopId: string, @CurrentUser() u: AuthUser, @Body() b: { qr?: string }) {
    return this.bookings.checkIn(shopId, String(b.qr ?? ''), u.sub);
  }

  @Get('pending-count')
  async pending(@ShopId() shopId: string) {
    return { count: await this.bookings.pendingSlips(shopId) };
  }

  @Get(':id/start-info')
  startInfo(@ShopId() shopId: string, @Param('id') id: string) {
    return this.bookings.startInfo(shopId, id);
  }

  @Post(':id/start')
  start(@ShopId() shopId: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { tableId?: string }) {
    return this.bookings.start(shopId, id, b.tableId, u.sub);
  }

  @Post(':id/confirm')
  confirm(@ShopId() shopId: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.bookings.confirm(shopId, id, u.sub);
  }

  @Post(':id/reject')
  reject(@ShopId() shopId: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { reason?: string }) {
    return this.bookings.reject(shopId, id, b.reason, u.sub);
  }

  @Post(':id/cancel')
  cancel(@ShopId() shopId: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { refund?: boolean }) {
    // Money going out of the shop is the owner's call.
    if (b.refund && u.role === Role.SHOP_STAFF) throw new ForbiddenException('เฉพาะเจ้าของร้านคืนมัดจำได้');
    return this.bookings.cancel(shopId, id, !!b.refund, u.sub);
  }
}
