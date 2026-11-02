import { Global, Logger, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Role } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { AUTH_COOKIE, AuthUser } from '../common/auth';

export type ChangeKind = 'tables' | 'bookings' | 'devices' | 'score' | 'line';

/**
 * Staff-only live channel. Clients only receive "something changed" hints and
 * refetch over HTTP, so the HTTP layer stays the single source of truth.
 */
@WebSocketGateway({
  cors: { origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server: Server;

  constructor(private jwt: JwtService) {}

  handleConnection(client: Socket) {
    try {
      const cookie = client.handshake.headers.cookie ?? '';
      const token = cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${AUTH_COOKIE}=`))
        ?.slice(AUTH_COOKIE.length + 1);
      if (!token) throw new Error('no token');
      const user = this.jwt.verify<AuthUser>(decodeURIComponent(token));
      const shopId = user.role === Role.PLATFORM_ADMIN ? String(client.handshake.query.shopId ?? '') : user.shopId;
      if (!shopId) throw new Error('no shop');
      client.join(`shop:${shopId}`);
    } catch (e) {
      this.log.debug(`reject socket: ${(e as Error).message}`);
      client.disconnect(true);
    }
  }

  changed(shopId: string, kind: ChangeKind, data?: unknown) {
    this.server?.to(`shop:${shopId}`).emit('changed', { kind, data });
  }
}

@Global()
@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
