import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { AuthUser, CurrentUser, Roles, ShopId } from '../common/auth';
import { pick } from '../common/util';
import { imageUpload, removeUpload } from '../common/upload';
import { isLineLive } from '../line/line.service';
import { PrismaService } from '../prisma/prisma.service';

const EDITABLE = [
  'name', 'phone', 'address', 'openTime', 'closeTime', 'promptpayId', 'depositAmount', 'lateGraceMin',
  'earlyCheckinMin', 'roundingMin', 'minimumMin', 'lineChannelId', 'lineLoginChannelId', 'lineLiffId',
  'lineOaBasicId', 'lineAdminTargetId', 'bookingHorizonDays', 'closedWeekdays', 'closedDates', 'open24h', 'lineOwnerTargetId', 'slipProvider', 'slipOkBranchId', 'slipReceiverAccounts',
] as const;
const SECRETS = ['lineChannelSecret', 'lineAccessToken', 'slipApiKey'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

@Controller('shop')
export class ShopController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async get(@ShopId() shopId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException();
    const { lineChannelSecret, lineAccessToken, slipApiKey, ...rest } = shop;
    return {
      ...rest,
      slipApiKeySet: !!slipApiKey,
      lineChannelSecretSet: !!lineChannelSecret,
      lineAccessTokenSet: !!lineAccessToken,
      lineLive: isLineLive(shop),
      webhookPath: `/api/line/webhook/${shop.slug}`,
    };
  }

  @Roles(Role.SHOP_OWNER)
  @Patch()
  async update(@ShopId() shopId: string, @Body() body: Record<string, unknown>) {
    const data: Record<string, unknown> = pick(body, EDITABLE);
    for (const k of ['openTime', 'closeTime'] as const) {
      if (data[k] !== undefined && !HHMM.test(String(data[k]))) throw new BadRequestException(`${k} ต้องเป็น HH:mm`);
    }
    for (const k of ['depositAmount', 'lateGraceMin', 'earlyCheckinMin', 'roundingMin', 'minimumMin'] as const) {
      if (data[k] !== undefined) {
        const n = Number(data[k]);
        if (!Number.isInteger(n) || n < 0 || n > 1000) throw new BadRequestException(`${k} ไม่ถูกต้อง`);
        data[k] = n;
      }
    }
    if (data.roundingMin === 0) data.roundingMin = 1;
    if (data.slipProvider !== undefined) {
      data.slipProvider = String(data.slipProvider || 'none');
      if (!['none', 'easyslip', 'slipok'].includes(data.slipProvider as string)) throw new BadRequestException('ผู้ให้บริการตรวจสลิปไม่ถูกต้อง');
    }
    if (data.slipReceiverAccounts !== undefined) {
      data.slipReceiverAccounts = String(data.slipReceiverAccounts ?? '').split(/[,\s]+/).map((x) => x.replace(/[^\d-]/g, '')).filter((x) => x.replace(/\D/g, '').length >= 6).join(',');
    }
    if (data.open24h !== undefined) data.open24h = data.open24h === true || data.open24h === 'true';
    if (data.bookingHorizonDays !== undefined) {
      const n = Number(data.bookingHorizonDays);
      if (!Number.isInteger(n) || n < 0 || n > 60) throw new BadRequestException('จองล่วงหน้าได้ 0–60 วัน');
      data.bookingHorizonDays = n;
    }
    if (data.closedWeekdays !== undefined) {
      const raw = Array.isArray(data.closedWeekdays) ? data.closedWeekdays : String(data.closedWeekdays ?? '').split(',');
      const days = [...new Set(raw.map(String).filter((x) => /^[0-6]$/.test(x)))].sort();
      if (days.length === 7) throw new BadRequestException('ปิดทุกวันไม่ได้');
      data.closedWeekdays = days.join(',');
    }
    if (data.closedDates !== undefined) {
      const raw = Array.isArray(data.closedDates) ? data.closedDates : String(data.closedDates ?? '').split(',');
      const dates = [...new Set(raw.map((x) => String(x).trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
      if (dates.length > 200) throw new BadRequestException('วันหยุดพิเศษมากเกินไป');
      data.closedDates = dates.join(',');
    }
    for (const k of Object.keys(data)) if (data[k] === '' && !['closedWeekdays', 'closedDates', 'slipReceiverAccounts', 'slipProvider'].includes(k)) data[k] = null;
    if (data.name === null) throw new BadRequestException('ต้องมีชื่อร้าน');
    // Secrets are write-only: send a value to set, send "" to clear, omit to keep.
    for (const k of SECRETS) if (typeof body[k] === 'string') data[k] = (body[k] as string).trim() || null;
    await this.prisma.shop.update({ where: { id: shopId }, data });
    return this.get(shopId);
  }

  @Roles(Role.SHOP_OWNER)
  @Post('logo')
  @UseInterceptors(FileInterceptor('file', imageUpload('logos')))
  async logo(@ShopId() shopId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('เลือกไฟล์รูป');
    const old = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { logoUrl: true } });
    await this.prisma.shop.update({ where: { id: shopId }, data: { logoUrl: `/uploads/logos/${file.filename}` } });
    removeUpload(old?.logoUrl);
    return this.get(shopId);
  }

  @Roles(Role.SHOP_OWNER)
  @Delete('logo')
  async removeLogo(@ShopId() shopId: string) {
    const old = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { logoUrl: true } });
    await this.prisma.shop.update({ where: { id: shopId }, data: { logoUrl: null } });
    removeUpload(old?.logoUrl);
    return this.get(shopId);
  }

  // ----- staff users -----

  @Roles(Role.SHOP_OWNER)
  @Get('users')
  users(@ShopId() shopId: string) {
    return this.prisma.user.findMany({
      where: { shopId },
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Roles(Role.SHOP_OWNER)
  @Post('users')
  async createUser(@ShopId() shopId: string, @Body() b: { email?: string; name?: string; password?: string; role?: Role }) {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('อีเมลไม่ถูกต้อง');
    if (!b.name?.trim()) throw new BadRequestException('กรอกชื่อ');
    if (!b.password || b.password.length < 8) throw new BadRequestException('รหัสผ่านอย่างน้อย 8 ตัว');
    const role = b.role === Role.SHOP_OWNER ? Role.SHOP_OWNER : Role.SHOP_STAFF;
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('อีเมลนี้ถูกใช้แล้ว');
    const u = await this.prisma.user.create({ data: { email, name: b.name.trim(), role, shopId, passwordHash: await hash(b.password, 10) } });
    return { id: u.id };
  }

  @Roles(Role.SHOP_OWNER)
  @Patch('users/:id')
  async updateUser(
    @ShopId() shopId: string,
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body() b: { name?: string; active?: boolean; role?: Role; password?: string },
  ) {
    const u = await this.prisma.user.findFirst({ where: { id, shopId } });
    if (!u) throw new NotFoundException();
    if (id === me.sub && (b.active === false || (b.role && b.role !== u.role))) throw new BadRequestException('แก้สิทธิ์ตัวเองไม่ได้');
    const data: Record<string, unknown> = {};
    if (b.name?.trim()) data.name = b.name.trim();
    if (typeof b.active === 'boolean') data.active = b.active;
    if (b.role === Role.SHOP_OWNER || b.role === Role.SHOP_STAFF) data.role = b.role;
    if (b.password) {
      if (b.password.length < 8) throw new BadRequestException('รหัสผ่านอย่างน้อย 8 ตัว');
      data.passwordHash = await hash(b.password, 10);
    }
    await this.prisma.user.update({ where: { id }, data });
    return { ok: true };
  }
}
