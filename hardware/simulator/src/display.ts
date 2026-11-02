// Timer/score "display" text - mirrors firmware display.cpp behaviour.
import type { ScoreState } from './score.ts';

export type SessionStateName = 'idle' | 'reserved' | 'running' | 'paused';

export interface SessionView {
  state: SessionStateName;
  table: string;
  elapsedMs: number; // elapsed at the moment the cmd was received
  receivedAt: number; // local Date.now() at receipt (device uses millis())
  reservedAt?: number; // epoch ms
}

/** Fixed offset like the device (no NTP/timezone db): Thailand UTC+7. */
export const TZ_OFFSET_MIN = 420;

function fmtElapsed(ms: number, colon: boolean): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}${colon ? ':' : ' '}${String(m).padStart(2, '0')}`;
}

function fmtLocalHHMM(epochMs: number): string {
  const localMin = Math.floor(epochMs / 60000) + TZ_OFFSET_MIN;
  const minOfDay = ((localMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(minOfDay / 60)).padStart(2, '0')}:${String(minOfDay % 60).padStart(2, '0')}`;
}

/** Text on the timer display, or '' when the display is blanked (blink). */
export function timerText(s: SessionView | null, statusMsg: string, now: number): string {
  if (!s) return statusMsg;
  switch (s.state) {
    case 'idle':
      return s.table || '----';
    case 'reserved':
      return Math.floor(now / 2000) % 2 === 0 ? 'RSV' : fmtLocalHHMM(s.reservedAt ?? 0);
    case 'running': {
      const elapsed = s.elapsedMs + (now - s.receivedAt);
      return fmtElapsed(elapsed, Math.floor(elapsed / 1000) % 2 === 0);
    }
    case 'paused':
      // frozen value, whole display blinks
      return Math.floor(now / 500) % 2 === 1 ? '' : fmtElapsed(s.elapsedMs, true);
  }
}

/** Score display pages: points 5 s -> frames 1.5 s -> break 1.5 s (if brk > 0). */
export class ScorePager {
  private page: 'points' | 'frames' | 'break' = 'points';
  private since = Date.now();

  reset(): void {
    this.page = 'points';
    this.since = Date.now();
  }

  text(sc: ScoreState, now: number): string {
    const on = now - this.since;
    if (this.page === 'points' && on >= 5000) this.go('frames', now);
    else if (this.page === 'frames' && on >= 1500) this.go(sc.brk ? 'break' : 'points', now);
    else if (this.page === 'break' && on >= 1500) this.go('points', now);

    switch (this.page) {
      case 'points': {
        const a = String(sc.p1 % 1000).padStart(3);
        const b = String(sc.p2 % 1000).padEnd(3);
        const u1 = sc.active === 1 ? '___' : '   ';
        const u2 = sc.active === 2 ? '___' : '   ';
        return `${a}  ${b}   (${u1}|${u2})`;
      }
      case 'frames':
        return `F ${String(sc.f1).padStart(2)}-${String(sc.f2).padEnd(2)}`;
      case 'break':
        return `B ${String(sc.brk).padStart(5)}  (P${sc.active})`;
    }
  }

  private go(p: 'points' | 'frames' | 'break', now: number): void {
    this.page = p;
    this.since = now;
  }
}
