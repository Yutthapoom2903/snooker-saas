import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { AuthUser, CurrentUser, ShopId } from '../common/auth';
import { SessionsService } from './sessions.service';

@Controller()
export class SessionsController {
  constructor(private sessions: SessionsService) {}

  @Get('board')
  board(@ShopId() shopId: string) {
    return this.sessions.board(shopId);
  }

  @Post('tables/:id/open')
  open(@ShopId() shopId: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { customerId?: string; customerName?: string }) {
    return this.sessions.open(shopId, id, { customerId: b.customerId || null, customerName: b.customerName, userId: u.sub });
  }

  @Post('tables/:id/reset-score')
  resetScore(@ShopId() shopId: string, @Param('id') id: string) {
    return this.sessions.resetScore(shopId, id);
  }

  @Post('sessions/:id/pause')
  pause(@ShopId() shopId: string, @Param('id') id: string) {
    return this.sessions.pause(shopId, id);
  }

  @Post('sessions/:id/resume')
  resume(@ShopId() shopId: string, @Param('id') id: string) {
    return this.sessions.resume(shopId, id);
  }

  @Get('sessions/:id/bill')
  preview(@ShopId() shopId: string, @Param('id') id: string) {
    return this.sessions.preview(shopId, id);
  }

  @Get('sessions/:id/promptpay')
  promptpay(@ShopId() shopId: string, @Param('id') id: string, @Query('at') at?: string) {
    return this.sessions.promptpay(shopId, id, at);
  }

  @Post('sessions/:id/close')
  close(@ShopId() shopId: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { method?: PaymentMethod; at?: string }) {
    if (!b.method || !Object.values(PaymentMethod).includes(b.method)) throw new BadRequestException('เลือกวิธีชำระเงิน');
    return this.sessions.close(shopId, id, b.method, u.sub, b.at);
  }

  @Get('sessions')
  history(@ShopId() shopId: string, @Query('limit') limit?: string) {
    return this.sessions.history(shopId, Number(limit) || 50);
  }
}
