import { Body, Controller, Get, Ip, Post, Res, UnauthorizedException } from '@nestjs/common';
import { rateLimit } from '../common/rate-limit';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { Response } from 'express';
import { AUTH_COOKIE, AuthUser, CurrentUser, Public } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';

const SESSION_HOURS = 12;

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { email?: string; password?: string }, @Res({ passthrough: true }) res: Response, @Ip() ip: string) {
    const email = String(body.email ?? '').trim().toLowerCase();
    rateLimit(`login:${ip}`, 20, 15 * 60000);
    rateLimit(`login:${email}`, 10, 15 * 60000);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { shop: true } });
    // Same error for unknown user / bad password / disabled to avoid account probing.
    const ok = user && user.active && (await compare(String(body.password ?? ''), user.passwordHash));
    if (!ok || (user.shop && !user.shop.active)) throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    const payload: AuthUser = { sub: user.id, role: user.role, shopId: user.shopId, name: user.name };
    res.cookie(AUTH_COOKIE, this.jwt.sign(payload, { expiresIn: `${SESSION_HOURS}h` }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_HOURS * 3600 * 1000,
      path: '/',
    });
    return this.me(payload);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: u.sub },
      select: { id: true, email: true, name: true, role: true, shop: { select: { id: true, slug: true, name: true, logoUrl: true } } },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
