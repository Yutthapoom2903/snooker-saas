import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthController } from './auth/auth.controller';
import { BookingsController } from './bookings/bookings.controller';
import { BookingsService } from './bookings/bookings.service';
import { CampaignsController } from './campaigns/campaigns.controller';
import { AuthGuard } from './common/auth';
import { UPLOAD_ROOT } from './common/upload';
import { LineController } from './line/line.controller';
import { LineService } from './line/line.service';
import { MembersController } from './members/members.controller';
import { MqttModule } from './mqtt/mqtt.service';
import { PlatformController } from './platform/platform.controller';
import { PrismaModule } from './prisma/prisma.service';
import { PublicController } from './public/public.controller';
import { RealtimeModule } from './realtime/realtime.gateway';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { SessionsController } from './sessions/sessions.controller';
import { SessionsService } from './sessions/sessions.service';
import { ShopController } from './shop/shop.controller';
import { TablesController } from './tables/tables.controller';

@Module({
  imports: [
    PrismaModule,
    RealtimeModule,
    MqttModule,
    ScheduleModule.forRoot(),
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    // Logos, slips. Served at /uploads (the web app proxies it).
    ServeStaticModule.forRoot({ rootPath: UPLOAD_ROOT, serveRoot: '/uploads', serveStaticOptions: { index: false, fallthrough: false } }),
  ],
  controllers: [
    AuthController, PlatformController, ShopController, TablesController, SessionsController, BookingsController,
    MembersController, CampaignsController, ReportsController, LineController, PublicController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, SessionsService, BookingsService, LineService, ReportsService],
})
export class AppModule {}
