import { HttpException, HttpStatus } from '@nestjs/common';

/** Tiny in-memory fixed-window limiter for public endpoints (single-process dev server). */
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return;
  }
  if (++h.n > max) throw new HttpException('ทำรายการถี่เกินไป ลองใหม่ภายหลัง', HttpStatus.TOO_MANY_REQUESTS);
}
