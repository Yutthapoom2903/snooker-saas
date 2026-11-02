import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export const AUTH_COOKIE = 'snk_session';

export interface AuthUser {
  sub: string;
  role: Role;
  shopId: string | null;
  name: string;
}

export const ROLES_KEY = 'roles';
/** Restrict an endpoint to roles. PLATFORM_ADMIN always passes. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const PUBLIC_KEY = 'public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  /** userId → current role/shop, re-read from the DB at most every 30 s. */
  private cache = new Map<string, { at: number; user: AuthUser | null }>();

  constructor(private jwt: JwtService, private reflector: Reflector, private prisma: PrismaService) {}

  /** The token says who you were at login; this says who you are now (disabled user/shop, changed role). */
  private async current(sub: string): Promise<AuthUser | null> {
    const hit = this.cache.get(sub);
    if (hit && Date.now() - hit.at < 30000) return hit.user;
    const u = await this.prisma.user.findUnique({ where: { id: sub }, include: { shop: { select: { active: true } } } });
    const user = u && u.active && (!u.shop || u.shop.active) ? { sub: u.id, role: u.role, shopId: u.shopId, name: u.name } : null;
    this.cache.set(sub, { at: Date.now(), user });
    return user;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.cookies?.[AUTH_COOKIE];
    if (!token) throw new UnauthorizedException();
    let claims: AuthUser;
    try {
      claims = this.jwt.verify<AuthUser>(token);
    } catch {
      throw new UnauthorizedException();
    }
    const live = await this.current(claims.sub);
    if (!live) throw new UnauthorizedException();
    req.user = live;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles && req.user.role !== Role.PLATFORM_ADMIN && !roles.includes(req.user.role)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ใช้งานส่วนนี้');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/**
 * The shop a staff request acts on. Shop users are pinned to their own shop;
 * a platform admin picks one with the `x-shop-id` header.
 */
export const ShopId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  const user = req.user;
  if (user.role === Role.PLATFORM_ADMIN) {
    const id = req.header('x-shop-id');
    if (!id) throw new ForbiddenException('เลือกร้านก่อน (x-shop-id)');
    return id;
  }
  if (!user.shopId) throw new ForbiddenException();
  return user.shopId;
});
