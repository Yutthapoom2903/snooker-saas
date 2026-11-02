import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { PaymentMethod, PaymentType, Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles, ShopId } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class MembersController {
  constructor(private prisma: PrismaService) {}

  // ----- plans (owner) -----
  @Get('plans')
  plans(@ShopId() shopId: string) {
    return this.prisma.membershipPlan.findMany({ where: { shopId }, orderBy: [{ active: 'desc' }, { price: 'asc' }] });
  }

  private planData(b: Record<string, unknown>, partial: boolean) {
    const d: Record<string, unknown> = {};
    if (b.name !== undefined || !partial) {
      if (!String(b.name ?? '').trim()) throw new BadRequestException('กรอกชื่อแพ็ก');
      d.name = String(b.name).trim().slice(0, 60);
    }
    for (const [k, min, max] of [['price', 0, 1000000], ['durationDays', 1, 3660], ['discountPercent', 0, 100]] as const) {
      if (b[k] !== undefined || !partial) {
        const n = Number(b[k]);
        if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${k} ไม่ถูกต้อง`);
        d[k] = n;
      }
    }
    if (typeof b.active === 'boolean') d.active = b.active;
    return d;
  }

  @Roles(Role.SHOP_OWNER)
  @Post('plans')
  createPlan(@ShopId() shopId: string, @Body() b: Record<string, unknown>) {
    return this.prisma.membershipPlan.create({ data: { ...this.planData(b, false), shopId } as never });
  }

  @Roles(Role.SHOP_OWNER)
  @Patch('plans/:id')
  async updatePlan(@ShopId() shopId: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const p = await this.prisma.membershipPlan.findFirst({ where: { id, shopId } });
    if (!p) throw new NotFoundException();
    return this.prisma.membershipPlan.update({ where: { id }, data: this.planData(b, true) });
  }

  // ----- customers -----
  @Get('customers')
  async customers(@ShopId() shopId: string, @Query('q') q?: string) {
    const now = new Date();
    const term = q?.trim();
    const rows = await this.prisma.customer.findMany({
      where: { shopId, ...(term ? { OR: [{ name: { contains: term } }, { phone: { contains: term } }] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { memberships: { where: { endsAt: { gte: now } }, orderBy: { endsAt: 'desc' }, take: 1, include: { plan: true } } },
    });
    return rows.map(({ memberships, ...c }) => ({
      ...c,
      membership: memberships[0] ? { plan: memberships[0].plan.name, discountPercent: memberships[0].plan.discountPercent, startsAt: memberships[0].startsAt, endsAt: memberships[0].endsAt } : null,
    }));
  }

  @Post('customers')
  async createCustomer(@ShopId() shopId: string, @Body() b: { name?: string; phone?: string }) {
    const name = b.name?.trim();
    const phone = b.phone?.replace(/\D/g, '') || null;
    if (!name) throw new BadRequestException('กรอกชื่อลูกค้า');
    if (phone && (await this.prisma.customer.findFirst({ where: { shopId, phone } }))) throw new BadRequestException('เบอร์นี้มีในระบบแล้ว');
    return this.prisma.customer.create({ data: { shopId, name: name.slice(0, 80), phone } });
  }

  /** Sell a membership at the counter. Renewals extend from the current end date. */
  @Post('customers/:id/memberships')
  async sell(@ShopId() shopId: string, @CurrentUser() u: AuthUser, @Param('id') customerId: string, @Body() b: { planId?: string; method?: PaymentMethod }) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, shopId } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    if (!b.planId) throw new BadRequestException('เลือกแพ็กสมาชิก');
    const plan = await this.prisma.membershipPlan.findFirst({ where: { id: b.planId, shopId, active: true } });
    if (!plan) throw new BadRequestException('เลือกแพ็กสมาชิก');
    const method = b.method && Object.values(PaymentMethod).includes(b.method) ? b.method : PaymentMethod.CASH;
    const now = new Date();
    const current = await this.prisma.membership.findFirst({ where: { shopId, customerId, endsAt: { gt: now } }, orderBy: { endsAt: 'desc' } });
    const startsAt = current ? current.endsAt : now;
    const endsAt = new Date(startsAt.getTime() + plan.durationDays * 86400000);
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.membership.create({ data: { shopId, customerId, planId: plan.id, startsAt, endsAt, pricePaid: plan.price } });
      if (plan.price > 0) {
        await tx.payment.create({ data: { shopId, type: PaymentType.MEMBERSHIP, method, amount: plan.price, membershipId: m.id, createdById: u.sub, note: `${plan.name} — ${customer.name}` } });
      }
      return m;
    });
  }
}
