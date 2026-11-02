import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { DiscountType, Role } from '@prisma/client';
import { Roles, ShopId } from '../common/auth';
import { fromLocal } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

@Controller('campaigns')
export class CampaignsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@ShopId() shopId: string) {
    return this.prisma.campaign.findMany({ where: { shopId }, orderBy: [{ active: 'desc' }, { startDate: 'desc' }] });
  }

  private data(b: Record<string, unknown>, partial: boolean, currentType?: DiscountType) {
    const d: Record<string, unknown> = {};
    const has = (k: string) => b[k] !== undefined || !partial;
    if (has('name')) {
      if (!String(b.name ?? '').trim()) throw new BadRequestException('กรอกชื่อแคมเปญ');
      d.name = String(b.name).trim().slice(0, 80);
    }
    if (b.description !== undefined) d.description = String(b.description ?? '').trim().slice(0, 300) || null;
    if (has('type')) {
      if (!Object.values(DiscountType).includes(b.type as DiscountType)) throw new BadRequestException('ประเภทส่วนลดไม่ถูกต้อง');
      d.type = b.type;
    }
    if (has('value')) {
      const v = Number(b.value);
      const max = (d.type ?? currentType) === DiscountType.PERCENT ? 100 : 100000;
      if (!Number.isInteger(v) || v < 1 || v > max) throw new BadRequestException('มูลค่าส่วนลดไม่ถูกต้อง');
      d.value = v;
    }
    if (has('startDate')) {
      if (!DATE.test(String(b.startDate))) throw new BadRequestException('วันเริ่มไม่ถูกต้อง');
      d.startDate = fromLocal(String(b.startDate), '00:00');
    }
    if (has('endDate')) {
      if (!DATE.test(String(b.endDate))) throw new BadRequestException('วันสิ้นสุดไม่ถูกต้อง');
      d.endDate = new Date(fromLocal(String(b.endDate), '00:00').getTime() + 86400000 - 1);
    }
    if (d.startDate && d.endDate && (d.endDate as Date) < (d.startDate as Date)) throw new BadRequestException('วันสิ้นสุดต้องหลังวันเริ่ม');
    if (b.daysOfWeek !== undefined) {
      const days = (Array.isArray(b.daysOfWeek) ? b.daysOfWeek : String(b.daysOfWeek).split(',')).map(Number).filter((n) => n >= 0 && n <= 6);
      if (!days.length) throw new BadRequestException('เลือกวันอย่างน้อย 1 วัน');
      d.daysOfWeek = [...new Set(days)].sort().join(',');
    }
    if (b.timeFrom !== undefined || b.timeTo !== undefined) {
      const from = b.timeFrom ? String(b.timeFrom) : null;
      const to = b.timeTo ? String(b.timeTo) : null;
      if ((from && !HHMM.test(from)) || (to && !HHMM.test(to)) || (!!from !== !!to)) throw new BadRequestException('ช่วงเวลาต้องมีทั้งเริ่มและสิ้นสุด (HH:mm)');
      d.timeFrom = from;
      d.timeTo = to;
    }
    if (b.tableIds !== undefined) {
      const ids = Array.isArray(b.tableIds) ? b.tableIds : String(b.tableIds ?? '').split(',');
      d.tableIds = ids.filter(Boolean).join(',') || null;
    }
    if (typeof b.membersOnly === 'boolean') d.membersOnly = b.membersOnly;
    if (typeof b.active === 'boolean') d.active = b.active;
    return d;
  }

  @Roles(Role.SHOP_OWNER)
  @Post()
  create(@ShopId() shopId: string, @Body() b: Record<string, unknown>) {
    return this.prisma.campaign.create({ data: { ...this.data(b, false), shopId } as never });
  }

  @Roles(Role.SHOP_OWNER)
  @Patch(':id')
  async update(@ShopId() shopId: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const current = await this.prisma.campaign.findFirst({ where: { id, shopId } });
    if (!current) throw new NotFoundException();
    // Switching to PERCENT must re-check the stored value against the 100% cap.
    const data = this.data(b.type !== undefined && b.value === undefined ? { ...b, value: current.value } : b, true, current.type);
    return this.prisma.campaign.update({ where: { id }, data });
  }

  @Roles(Role.SHOP_OWNER)
  @Delete(':id')
  async remove(@ShopId() shopId: string, @Param('id') id: string) {
    if (!(await this.prisma.campaign.findFirst({ where: { id, shopId } }))) throw new NotFoundException();
    await this.prisma.campaign.delete({ where: { id } });
    return { ok: true };
  }
}
