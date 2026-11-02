/**
 * Pure checks on a verified slip (what the bank says happened) against what the
 * shop expects. Unit-tested in test/slip.test.ts.
 */
export interface VerifiedSlip {
  transRef: string;
  amount: number;
  paidAt: Date | null;
  receiverValues: string[]; // masked account / proxy strings, e.g. "xxx-x-x3109-x", "086xxx0000"
}

export interface Expectation {
  depositAmount: number;
  bookingCreatedAt: Date;
  shopAccounts: string[]; // PromptPay id + bank account numbers, any format
}

const digitsAndMask = (s: string) => s.toLowerCase().replace(/[^0-9x*]/g, '').replace(/\*/g, 'x');

function normalisePhone(d: string) {
  // +66 81 234 5678 → 0812345678
  return d.startsWith('66') && d.length === 11 ? `0${d.slice(2)}` : d;
}

/**
 * Does a masked value ("xxx-x-x3109-x") fit a real number ("123-4-53109-0")?
 * Compared right-aligned; needs at least 4 visible digits, all matching.
 */
export function maskedMatches(masked: string, actual: string): boolean {
  const m = digitsAndMask(masked);
  const a = normalisePhone(actual.replace(/\D/g, ''));
  if (!m || !a) return false;
  let visible = 0;
  for (let i = 1; i <= Math.min(m.length, a.length); i++) {
    const mc = m[m.length - i];
    if (mc === 'x') continue;
    if (mc !== a[a.length - i]) return false;
    visible++;
  }
  // Leading digits beyond the actual number's length must be masked.
  if (m.length > a.length && /\d/.test(m.slice(0, m.length - a.length))) return false;
  return visible >= 4;
}

export function checkSlip(slip: VerifiedSlip, exp: Expectation): string[] {
  const reasons: string[] = [];
  if (slip.amount + 1e-9 < exp.depositAmount) reasons.push(`ยอดโอน ${slip.amount} บาท น้อยกว่ามัดจำ ${exp.depositAmount} บาท`);
  // Bank clocks and ours may differ slightly; allow 2 minutes.
  if (slip.paidAt && slip.paidAt.getTime() < exp.bookingCreatedAt.getTime() - 2 * 60000) reasons.push('โอนก่อนกดจอง (อาจเป็นสลิปเก่า)');
  const accounts = exp.shopAccounts.filter((a) => a.replace(/\D/g, '').length >= 4);
  if (!accounts.length) reasons.push('ร้านยังไม่ได้ตั้งบัญชีรับเงิน จึงตรวจบัญชีผู้รับไม่ได้');
  else if (!slip.receiverValues.some((v) => accounts.some((a) => maskedMatches(v, a)))) reasons.push('บัญชีผู้รับไม่ใช่บัญชีของร้าน');
  return reasons;
}
