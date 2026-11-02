export interface PublicTable {
  id: string;
  name: string;
  pricePerHour: number;
  bookable: boolean;
  status: 'free' | 'playing' | 'paused' | 'reserved';
  since: string | null;
  nextBookingAt: string | null;
}

export interface PublicShop {
  slug: string;
  name: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  openTime: string;
  closeTime: string;
  open24h: boolean;
  closedWeekdays: string;
  bookingHorizonDays: number;
  depositAmount: number;
  lateGraceMin: number;
  lineLive: boolean;
  lineOaBasicId: string | null;
  today: string;
  tables: PublicTable[];
  plans: { id: string; name: string; price: number; durationDays: number; discountPercent: number }[];
  campaigns: { id: string; name: string; description: string | null; type: 'PERCENT' | 'FIXED'; value: number; daysOfWeek: string; timeFrom: string | null; timeTo: string | null; membersOnly: boolean }[];
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'PLATFORM_ADMIN' | 'SHOP_OWNER' | 'SHOP_STAFF';
  shop: { id: string; slug: string; name: string; logoUrl: string | null } | null;
}

export interface BoardTable {
  id: string;
  name: string;
  label: string;
  pricePerHour: number;
  bookable: boolean;
  session: null | { id: string; status: 'RUNNING' | 'PAUSED'; startedAt: string; playedMs: number; customerName: string | null; bookingCode: string | null };
  upcoming: { id: string; code: string; name: string; startAt: string; endAt: string; status: string }[];
  device: null | { id: string; online: boolean; lastSeenAt: string | null };
  score: null | { p1: number; p2: number; f1: number; f2: number; active: 1 | 2; brk: number };
}

export interface Bill {
  playedMinutes: number;
  billedMinutes: number;
  gross: number;
  discount: number;
  discountLabel: string | null;
  depositApplied: number;
  depositChange: number;
  net: number;
}
