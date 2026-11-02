import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { Roles } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['admin', 'api', 'login', 'platform', 'uploads', 'www', 'app']);

/** Platform owner: onboard shops and switch them on/off. */
@Roles(Role.PLATFORM_ADMIN)
@Controller('platform')
export class PlatformController {
  constructor(private prisma: PrismaService) {}

  @Get('shops')
  async shops() {
    const since = new Date(Date.now() - 30 * 86400000);
    const shops = await this.prisma.shop.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { tables: true, users: true } } },
    });
    const revenue = await this.prisma.payment.groupBy({ by: ['shopId'], where: { createdAt: { gte: since } }, _sum: { amount: true } });
    return shops.map((s) => ({
      id: s.id, slug: s.slug, name: s.name, logoUrl: s.logoUrl, active: s.active, createdAt: s.createdAt,
      tables: s._count.tables, users: s._count.users,
      revenue30d: revenue.find((r) => r.shopId === s.id)?._sum.amount ?? 0,
    }));
  }

  @Post('shops')
  async create(@Body() b: { name?: string; slug?: string; ownerEmail?: string; ownerName?: string; ownerPassword?: string; tables?: number; pricePerHour?: number }) {
    const slug = String(b.slug ?? '').trim().toLowerCase();
    if (!b.name?.trim()) throw new BadRequestException('กรอกชื่อร้าน');
    if (!SLUG.test(slug) || RESERVED.has(slug)) throw new BadRequestException('slug ใช้ a-z 0-9 - ยาว 3–40 ตัว');
    if (await this.prisma.shop.findUnique({ where: { slug } })) throw new BadRequestException('slug นี้ถูกใช้แล้ว');
    const email = String(b.ownerEmail ?? '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('อีเมลเจ้าของร้านไม่ถูกต้อง');
    if (!b.ownerPassword || b.ownerPassword.length < 8) throw new BadRequestException('รหัสผ่านอย่างน้อย 8 ตัว');
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('อีเมลนี้ถูกใช้แล้ว');
    const n = Math.max(0, Math.min(50, Number(b.tables) || 0));
    const price = Math.max(0, Number(b.pricePerHour) || 120);
    const passwordHash = await hash(b.ownerPassword, 10);
    return this.prisma.shop.create({
      data: {
        slug,
        name: b.name.trim(),
        users: { create: { email, name: b.ownerName?.trim() || 'เจ้าของร้าน', role: Role.SHOP_OWNER, passwordHash } },
        tables: { create: Array.from({ length: n }, (_, i) => ({ name: `โต๊ะ ${i + 1}`, label: `T${i + 1}`, sortOrder: i + 1, pricePerHour: price })) },
      },
    });
  }

  @Patch('shops/:id')
  async update(@Param('id') id: string, @Body() b: { active?: boolean; name?: string }) {
    if (!(await this.prisma.shop.findUnique({ where: { id } }))) throw new NotFoundException();
    return this.prisma.shop.update({
      where: { id },
      data: { ...(typeof b.active === 'boolean' ? { active: b.active } : {}), ...(b.name?.trim() ? { name: b.name.trim() } : {}) },
    });
  }
}
