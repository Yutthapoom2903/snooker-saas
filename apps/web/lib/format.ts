const TZ = 'Asia/Bangkok';

export const baht = (n: number) => `${Math.round(n).toLocaleString('th-TH')} ฿`;

const dateFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const dateShort = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

/** 2 พ.ย. 2569 (th-TH uses the Buddhist calendar) */
export const thDate = (d: string | Date) => dateFmt.format(new Date(d));
export const thDay = (d: string | Date) => dateShort.format(new Date(d));
export const hhmm = (d: string | Date) => timeFmt.format(new Date(d));
export const thDateTime = (d: string | Date) => `${thDate(d)} ${hhmm(d)}`;

/** Elapsed ms → "1:07:32" or "7:32" */
export function clock(ms: number, withSeconds = true) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  if (!withSeconds) return `${h}:${mm}`;
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function minutesText(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} ชม. ${m} นาที` : `${h} ชม.`) : `${m} นาที`;
}

/** Today in Bangkok as YYYY-MM-DD */
export function todayLocal(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

export const BOOKING_STATUS: Record<string, { label: string; tone: 'green' | 'yellow' | 'red' | 'gray' }> = {
  DRAFT: { label: 'ยังไม่ผูก LINE', tone: 'gray' },
  PENDING_DEPOSIT: { label: 'รอโอนมัดจำ', tone: 'yellow' },
  DEPOSIT_SUBMITTED: { label: 'รอยืนยัน', tone: 'yellow' },
  CONFIRMED: { label: 'ยืนยันแล้ว', tone: 'green' },
  CHECKED_IN: { label: 'มาแล้ว', tone: 'green' },
  NO_SHOW: { label: 'ไม่มา', tone: 'red' },
  REJECTED: { label: 'ปฏิเสธ', tone: 'red' },
  CANCELLED: { label: 'ยกเลิก', tone: 'gray' },
  EXPIRED: { label: 'หมดเวลา', tone: 'gray' },
};

export const METHOD: Record<string, string> = { CASH: 'เงินสด', PROMPTPAY: 'พร้อมเพย์', TRANSFER: 'โอน', CARD: 'บัตร' };
export const ROLE: Record<string, string> = { PLATFORM_ADMIN: 'ผู้ดูแลระบบ', SHOP_OWNER: 'เจ้าของร้าน', SHOP_STAFF: 'พนักงาน' };
