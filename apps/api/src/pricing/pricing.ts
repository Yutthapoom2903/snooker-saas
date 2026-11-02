/**
 * Pure pricing rules — no I/O, unit-tested in test/pricing.test.ts.
 */
export interface DiscountCandidate {
  kind: 'MEMBER' | 'CAMPAIGN';
  label: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
}

export interface BillingRules {
  roundingMin: number; // round billed time up to a multiple of this
  minimumMin: number; // bill at least this many minutes
}

export function billedMinutes(playedMs: number, rules: BillingRules): number {
  const played = Math.max(0, playedMs) / 60000;
  const step = Math.max(1, rules.roundingMin);
  const rounded = Math.ceil(played / step - 1e-9) * step;
  return Math.max(rules.minimumMin, rounded);
}

export function discountAmount(gross: number, d: DiscountCandidate): number {
  const raw = d.type === 'PERCENT' ? Math.round((gross * Math.min(100, Math.max(0, d.value))) / 100) : d.value;
  return Math.min(gross, Math.max(0, raw));
}

export function bestDiscount(gross: number, candidates: DiscountCandidate[]): { candidate: DiscountCandidate | null; amount: number } {
  let best: DiscountCandidate | null = null;
  let amount = 0;
  for (const c of candidates) {
    const a = discountAmount(gross, c);
    if (a > amount) {
      best = c;
      amount = a;
    }
  }
  return { candidate: best, amount };
}

export interface Bill {
  playedMinutes: number;
  billedMinutes: number;
  gross: number;
  discount: number;
  discountLabel: string | null;
  depositApplied: number;
  depositChange: number; // deposit left over after the bill, handed back to the customer
  net: number;
}

export function computeBill(args: {
  playedMs: number;
  pricePerHour: number;
  rules: BillingRules;
  candidates: DiscountCandidate[];
  deposit: number;
}): Bill {
  const billed = billedMinutes(args.playedMs, args.rules);
  const gross = Math.ceil((billed * args.pricePerHour) / 60);
  const { candidate, amount } = bestDiscount(gross, args.candidates);
  const afterDiscount = gross - amount;
  const depositApplied = Math.min(args.deposit, afterDiscount);
  return {
    playedMinutes: Math.floor(Math.max(0, args.playedMs) / 60000),
    billedMinutes: billed,
    gross,
    discount: amount,
    discountLabel: candidate?.label ?? null,
    depositApplied,
    depositChange: args.deposit - depositApplied,
    net: afterDiscount - depositApplied,
  };
}

export interface CampaignLike {
  name: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  startDate: Date;
  endDate: Date;
  daysOfWeek: string;
  timeFrom: string | null;
  timeTo: string | null;
  tableIds: string | null;
  membersOnly: boolean;
  active: boolean;
}

/**
 * Is the campaign valid at `at` for this table?
 * `localDow` (0=Sun) and `localMinutes` (since local midnight) are passed in so
 * this stays timezone-free. Time windows may wrap midnight (22:00–02:00).
 */
export function campaignApplies(
  c: CampaignLike,
  at: Date,
  localDow: number,
  localMinutes: number,
  tableId: string,
  isMember: boolean,
): boolean {
  if (!c.active) return false;
  if (at < c.startDate || at > c.endDate) return false;
  if (c.membersOnly && !isMember) return false;
  const days = c.daysOfWeek.split(',').filter(Boolean).map(Number);
  if (!days.includes(localDow)) return false;
  if (c.tableIds) {
    const ids = c.tableIds.split(',').filter(Boolean);
    if (ids.length && !ids.includes(tableId)) return false;
  }
  if (c.timeFrom && c.timeTo) {
    const from = toMin(c.timeFrom);
    const to = toMin(c.timeTo);
    const inside = from <= to ? localMinutes >= from && localMinutes < to : localMinutes >= from || localMinutes < to;
    if (!inside) return false;
  }
  return true;
}

function toMin(s: string) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
