// Score logic - mirrors hardware/firmware/src/common/score.cpp exactly.

export interface ScoreState {
  p1: number; // points in the current frame
  p2: number;
  f1: number; // frames won
  f2: number;
  active: 1 | 2; // player at the table
  brk: number; // current break
}

const UNDO_DEPTH = 20;

export class Score {
  private s: ScoreState = { p1: 0, p2: 0, f1: 0, f2: 0, active: 1, brk: 0 };
  private undoStack: ScoreState[] = [];

  get state(): ScoreState {
    return { ...this.s };
  }

  private push(): void {
    this.undoStack.push({ ...this.s });
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
  }

  /** Pot: +n (1..7) to the active player, break += n. */
  addPoints(n: number): boolean {
    if (n < 1 || n > 7) return false;
    this.push();
    if (this.s.active === 1) this.s.p1 += n;
    else this.s.p2 += n;
    this.s.brk += n;
    return true;
  }

  /** Foul by the active player: max(4, n) to the opponent, who plays next. */
  foul(n: number): boolean {
    if (n < 1 || n > 7) return false;
    const pts = Math.max(4, n);
    this.push();
    if (this.s.active === 1) {
      this.s.p2 += pts;
      this.s.active = 2;
    } else {
      this.s.p1 += pts;
      this.s.active = 1;
    }
    this.s.brk = 0;
    return true;
  }

  /** End of visit: other player to the table, break resets. */
  switchPlayer(): boolean {
    this.push();
    this.s.active = this.s.active === 1 ? 2 : 1;
    this.s.brk = 0;
    return true;
  }

  /** Frame to the leader; refused on a tie. Breaker alternates (P1 breaks odd frames). */
  newFrame(): boolean {
    if (this.s.p1 === this.s.p2) return false;
    this.push();
    if (this.s.p1 > this.s.p2) this.s.f1++;
    else this.s.f2++;
    this.s.p1 = this.s.p2 = 0;
    this.s.brk = 0;
    this.s.active = (this.s.f1 + this.s.f2) % 2 === 0 ? 1 : 2;
    return true;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.s = prev;
    return true;
  }

  /** From the server `score` cmd: missing fields keep current values; clears undo. */
  overwrite(partial: Partial<ScoreState>): void {
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const active = num(partial.active, this.s.active);
    this.s = {
      p1: num(partial.p1, this.s.p1),
      p2: num(partial.p2, this.s.p2),
      f1: num(partial.f1, this.s.f1),
      f2: num(partial.f2, this.s.f2),
      active: active === 2 ? 2 : 1,
      brk: num(partial.brk, this.s.brk),
    };
    this.undoStack = [];
  }
}
