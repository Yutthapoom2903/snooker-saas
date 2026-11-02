import { Global, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { createBroker } from 'aedes';
import type Aedes from 'aedes';
import type { Client } from 'aedes';
import { createServer, Server } from 'net';
import { compare } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/**
 * Embedded MQTT broker (see docs/mqtt-contract.md).
 * Devices authenticate with deviceId + secret and are confined to snk/dev/{id}/#.
 */
@Injectable()
export class MqttService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('MQTT');
  private broker: Aedes;
  private server: Server;
  /** Hook set by SessionsService so a reconnecting device gets its state. */
  onDeviceConnected?: (deviceId: string) => Promise<void>;

  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  onApplicationBootstrap() {
    this.broker = createBroker();

    this.broker.authenticate = (client, username, password, done) => {
      const fail = () => {
        const err = Object.assign(new Error('bad credentials'), { returnCode: 4 as const });
        done(err as never, false);
      };
      if (!username || !password || username !== client.id) return fail();
      this.prisma.device
        .findUnique({ where: { id: username } })
        .then(async (dev) => (dev && (await compare(password.toString(), dev.secretHash)) ? done(null, true) : fail()))
        .catch(() => fail());
    };

    const own = (client: Client | null, topic: string) => !!client && topic.startsWith(`snk/dev/${client.id}/`);
    this.broker.authorizePublish = (client, packet, cb) => {
      if (!own(client, packet.topic) || packet.topic.endsWith('/cmd')) return cb(new Error('denied'));
      cb(null);
    };
    this.broker.authorizeSubscribe = (client, sub, cb) => {
      // Null subscription = SUBACK 0x80 for this topic only; the device stays connected.
      if (sub.topic !== `snk/dev/${client.id}/cmd`) return cb(null, null);
      cb(null, sub);
    };

    this.broker.on('client', (client) => {
      this.log.log(`device connected: ${client.id}`);
      this.markOnline(client.id, true);
    });
    this.broker.on('clientDisconnect', (client) => {
      this.log.log(`device disconnected: ${client.id}`);
      this.markOnline(client.id, false);
    });
    this.broker.on('subscribe', (subs, client) => {
      if (client && subs.some((s) => s.topic === `snk/dev/${client.id}/cmd`)) {
        this.onDeviceConnected?.(client.id).catch((e) => this.log.warn(e.message));
      }
    });
    this.broker.on('publish', (packet, client) => {
      if (!client) return;
      this.handleDeviceMessage(client.id, packet.topic, packet.payload.toString()).catch((e) =>
        this.log.warn(`bad message from ${client.id}: ${e.message}`),
      );
    });

    const port = Number(process.env.MQTT_PORT ?? 1883);
    this.server = createServer(this.broker.handle);
    this.server.listen(port, '0.0.0.0', () => this.log.log(`MQTT broker on :${port}`));
  }

  async onModuleDestroy() {
    // Never let shutdown hang on a lingering device socket (it blocks `nest start --watch` restarts).
    this.server?.close();
    const closed = new Promise<void>((r) => (this.broker ? this.broker.close(() => r()) : r()));
    await Promise.race([closed, new Promise((r) => setTimeout(r, 1500))]);
  }

  private async markOnline(deviceId: string, online: boolean) {
    const dev = await this.prisma.device
      .update({ where: { id: deviceId }, data: { online, lastSeenAt: new Date() } })
      .catch(() => null);
    if (dev) this.realtime.changed(dev.shopId, 'devices');
  }

  private async handleDeviceMessage(deviceId: string, topic: string, raw: string) {
    const kind = topic.split('/')[3];
    const body = JSON.parse(raw);
    if (kind === 'status') {
      if (body.online === false) return; // LWT; disconnect event handles it
      const dev = await this.prisma.device.update({
        where: { id: deviceId },
        data: {
          online: true,
          lastSeenAt: new Date(),
          fwVersion: body.fw?.toString().slice(0, 32),
          ip: body.ip?.toString().slice(0, 64),
          rssi: Number.isFinite(body.rssi) ? Math.round(body.rssi) : null,
        },
      });
      this.realtime.changed(dev.shopId, 'devices');
    } else if (kind === 'score') {
      const s = {
        p1: int(body.p1), p2: int(body.p2), f1: int(body.f1), f2: int(body.f2),
        active: body.active === 2 ? 2 : 1, brk: int(body.brk),
      };
      const dev = await this.prisma.device.update({ where: { id: deviceId }, data: { scoreJson: JSON.stringify(s) } });
      this.realtime.changed(dev.shopId, 'score', { tableId: dev.tableId, score: s });
    } else if (kind === 'log') {
      const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
      this.log.log(`[${deviceId}] ${String(body.msg).slice(0, 200)}`);
      if (dev) this.realtime.changed(dev.shopId, 'devices', { deviceId, log: String(body.msg).slice(0, 200) });
    }
  }

  /** Send a command to a device. `session` commands are retained. */
  send(deviceId: string, cmd: Record<string, unknown>) {
    if (!this.broker) return;
    this.broker.publish(
      {
        cmd: 'publish',
        topic: `snk/dev/${deviceId}/cmd`,
        payload: Buffer.from(JSON.stringify(cmd)),
        qos: 1,
        retain: cmd.type === 'session',
        dup: false,
      },
      () => undefined,
    );
  }
}

function int(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(999, Math.round(n))) : 0;
}

@Global()
@Module({ providers: [MqttService], exports: [MqttService] })
export class MqttModule {}
