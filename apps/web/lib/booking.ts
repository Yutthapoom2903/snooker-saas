export interface CustomerBooking {
  code: string;
  status: string;
  name: string;
  partySize: number;
  table: string;
  startAt: string;
  endAt: string;
  depositAmount: number;
  hasSlip: boolean;
  slipCheck: { verdict: 'pass' | 'fail' | 'manual'; reasons: string[]; amount: number | null } | null;
  lineLinked: boolean;
  checkinFrom: string;
  expiresAt: string;
  rejectReason: string | null;
  promptpayQr: string | null;
  promptpayId: string | null;
  bookingQr: string | null;
  shop: { name: string; slug: string; logoUrl: string | null; phone: string | null; lateGraceMin: number; lineOaBasicId: string | null; liffId: string | null; live: boolean };
}
