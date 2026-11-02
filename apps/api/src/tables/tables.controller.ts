import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { Roles, ShopId } from '../common/auth';
import { randomToken, shortCode } from '../common/util';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SessionsService } from '../sessions/sessions.service';

interface TableBody { name?: string; label?: string; pricePerHour?: number; sortOrder?: number; bookable?: boolean; active?: boolean; streamUrl?: string }

@Controller()
export class TablesController {
  constructor(
    private prisma: PrismaService,
    private mqtt: MqttService,
    private sessions: SessionsService,
    private realtime: RealtimeGateway,
  ) {}

  @Get('tables')
  list(@ShopId() shopId: string) {
    return this.prisma.snookerTable.findMany({
      where: { shopId },
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { device: { select: { id: true, name: true, online: true } } },
    });
  }

  private clean(b: TableBody, partial: boolean) {
    const d: Record<string, unknown> = {};
    if (b.name !== undefined || !partial) {
      if (!b.name?.trim()) throw new BadRequestException('กรอกชื่อโต๊ะ');
      d.name = b.name.trim().slice(0, 40);
    }
    if (b.label !== undefined || !partial) {
      const l = String(b.label ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{1,4}$/.test(l)) throw new BadRequestException('ป้ายบนจอต้องเป็น A-Z/0-9 ไม่เกิน 4 ตัว เช่น T1');
      d.label = l;
    }
    if (b.pricePerHour !== undefined || !partial) {
      const p = Number(b.pricePerHour);
      if (!Number.isInteger(p) || p < 0 || p > 100000) throw new BadRequestException('ราคาต่อชั่วโมงไม่ถูกต้อง');
      d.pricePerHour = p;
    }
    if (b.sortOrder !== undefined) d.sortOrder = Number(b.sortOrder) || 0;
    if (typeof b.bookable === 'boolean') d.bookable = b.bookable;
    if (typeof b.active === 'boolean') d.active = b.active;
    if (b.streamUrl !== undefined) d.streamUrl = b.streamUrl?.trim() || null;
    return d;
  }

  @Roles(Role.SHOP_OWNER)
  @Post('tables')
  async create(@ShopId() shopId: string, @Body() b: TableBody) {
    const data = this.clean(b, false);
    if (await this.prisma.snookerTable.findFirst({ where: { shopId, label: data.label as string } })) throw new BadRequestException('ป้ายนี้ซ้ำกับโต๊ะอื่น');
    const t = await this.prisma.snookerTable.create({ data: { ...(data as { name: string; label: string; pricePerHour: number }), shopId } });
    this.realtime.changed(shopId, 'tables');
    return t;
  }

  @Roles(Role.SHOP_OWNER)
  @Patch('tables/:id')
  async update(@ShopId() shopId: string, @Param('id') id: string, @Body() b: TableBody) {
    const t = await this.prisma.snookerTable.findFirst({ where: { id, shopId } });
    if (!t) throw new NotFoundException();
    const data = this.clean(b, true);
    if (data.label && data.label !== t.label && (await this.prisma.snookerTable.findFirst({ where: { shopId, label: data.label as string } }))) {
      throw new BadRequestException('ป้ายนี้ซ้ำกับโต๊ะอื่น');
    }
    // Price changes only affect sessions opened afterwards (sessions snapshot the price).
    const r = await this.prisma.snookerTable.update({ where: { id }, data });
    this.sessions.afterChange(shopId, id);
    return r;
  }

  /** Tables with history are deactivated, not deleted, so reports stay intact. */
  @Roles(Role.SHOP_OWNER)
  @Delete('tables/:id')
  async remove(@ShopId() shopId: string, @Param('id') id: string) {
    const t = await this.prisma.snookerTable.findFirst({ where: { id, shopId }, include: { _count: { select: { sessions: true, bookings: true } } } });
    if (!t) throw new NotFoundException();
    const running = await this.prisma.tableSession.count({ where: { tableId: id, status: { not: 'CLOSED' } } });
    if (running) throw new BadRequestException('โต๊ะนี้กำลังเปิดใช้งาน');
    if (t._count.sessions || t._count.bookings) {
      await this.prisma.snookerTable.update({ where: { id }, data: { active: false, bookable: false } });
      const devs = await this.prisma.device.findMany({ where: { tableId: id }, select: { id: true } });
      await this.prisma.device.updateMany({ where: { tableId: id }, data: { tableId: null } });
      this.idle(devs.map((d) => d.id));
      this.realtime.changed(shopId, 'tables');
      return { deactivated: true };
    }
    await this.prisma.snookerTable.delete({ where: { id } });
    this.realtime.changed(shopId, 'tables');
    return { deleted: true };
  }

  // ----- devices -----

  @Roles(Role.SHOP_OWNER)
  @Get('devices')
  devices(@ShopId() shopId: string) {
    return this.prisma.device.findMany({
      where: { shopId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, tableId: true, table: { select: { name: true } }, online: true, lastSeenAt: true, fwVersion: true, ip: true, rssi: true, createdAt: true },
    });
  }

  /** Register a board; the secret is returned once and only its hash is stored. */
  @Roles(Role.SHOP_OWNER)
  @Post('devices')
  async createDevice(@ShopId() shopId: string, @Body() b: { name?: string; tableId?: string }) {
    const secret = randomToken(18);
    const id = `snk-${shortCode(8).toLowerCase()}`;
    if (b.tableId) await this.assertTable(shopId, b.tableId);
    await this.prisma.device.create({
      data: { id, shopId, name: b.name?.trim() || id, tableId: b.tableId || null, secretHash: await hash(secret, 10) },
    });
    if (b.tableId) await this.prisma.device.updateMany({ where: { tableId: b.tableId, id: { not: id } }, data: { tableId: null } });
    this.realtime.changed(shopId, 'devices');
    return { id, secret };
  }

  @Roles(Role.SHOP_OWNER)
  @Post('devices/:id/rotate-secret')
  async rotate(@ShopId() shopId: string, @Param('id') id: string) {
    await this.assertDevice(shopId, id);
    const secret = randomToken(18);
    await this.prisma.device.update({ where: { id }, data: { secretHash: await hash(secret, 10) } });
    return { id, secret };
  }

  @Roles(Role.SHOP_OWNER)
  @Patch('devices/:id')
  async updateDevice(@ShopId() shopId: string, @Param('id') id: string, @Body() b: { name?: string; tableId?: string | null }) {
    await this.assertDevice(shopId, id);
    if (b.tableId) {
      await this.assertTable(shopId, b.tableId);
      const displaced = await this.prisma.device.findMany({ where: { tableId: b.tableId, id: { not: id } }, select: { id: true } });
      await this.prisma.device.updateMany({ where: { tableId: b.tableId, id: { not: id } }, data: { tableId: null } });
      this.idle(displaced.map((d) => d.id));
    }
    const d = await this.prisma.device.update({
      where: { id },
      data: { ...(b.name?.trim() ? { name: b.name.trim() } : {}), ...(b.tableId !== undefined ? { tableId: b.tableId || null } : {}) },
      select: { id: true, name: true, tableId: true, online: true },
    });
    if (d.tableId) await this.sessions.syncDevice(d.tableId, true);
    else this.idle([d.id]);
    this.realtime.changed(shopId, 'devices');
    return d;
  }

  @Roles(Role.SHOP_OWNER)
  @Delete('devices/:id')
  async deleteDevice(@ShopId() shopId: string, @Param('id') id: string) {
    await this.assertDevice(shopId, id);
    await this.prisma.device.delete({ where: { id } });
    this.realtime.changed(shopId, 'devices');
    return { ok: true };
  }

  @Roles(Role.SHOP_OWNER)
  @Post('devices/:id/test')
  async test(@ShopId() shopId: string, @Param('id') id: string, @Body() b: { action?: string; text?: string }) {
    const d = await this.assertDevice(shopId, id);
    const action = ['blink', 'relay', 'text'].includes(String(b.action)) ? b.action : 'blink';
    this.mqtt.send(d.id, { type: 'test', action, ...(action === 'text' ? { text: String(b.text ?? 'HELLO').slice(0, 32) } : {}) });
    return { sent: true, online: d.online };
  }

  /** A board that no longer has a table must stop showing a game and switch its light off. */
  private idle(deviceIds: string[]) {
    for (const id of deviceIds) this.mqtt.send(id, { type: 'session', state: 'idle', table: '--', serverTime: Date.now(), light: false });
  }

  private async assertDevice(shopId: string, id: string) {
    const d = await this.prisma.device.findFirst({ where: { id, shopId } });
    if (!d) throw new NotFoundException('ไม่พบอุปกรณ์');
    return d;
  }

  private async assertTable(shopId: string, id: string) {
    const t = await this.prisma.snookerTable.findFirst({ where: { id, shopId } });
    if (!t) throw new BadRequestException('ไม่พบโต๊ะ');
  }
}
