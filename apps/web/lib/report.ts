export interface Summary {
  shop: { name: string; logoUrl: string | null };
  period: 'day' | 'week' | 'month';
  from: string;
  to: string;
  label: string;
  total: number;
  previousTotal: number;
  changePct: number | null;
  byType: Record<'TABLE' | 'DEPOSIT' | 'MEMBERSHIP' | 'REFUND', number>;
  byMethod: Record<string, number>;
  series: { key: string; label: string; amount: number }[];
  sessions: { count: number; minutes: number; discount: number };
  perTable: { id: string; name: string; sessions: number; minutes: number; revenue: number; utilization: number }[];
  startsByHour: number[];
  bookings: { total: number; confirmed: number; checkedIn: number; noShow: number; cancelled: number; forfeited: number };
  payments: { id: string; at: string; type: string; method: string; amount: number; note: string | null }[];
}

export const TYPE_LABEL: Record<string, string> = { TABLE: 'ค่าโต๊ะ', DEPOSIT: 'มัดจำการจอง', MEMBERSHIP: 'สมาชิก', REFUND: 'คืนเงิน' };
