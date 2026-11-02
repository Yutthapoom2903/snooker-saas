import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/** Shops are in Thailand: fixed UTC+7, no DST. */
export const TZ_OFFSET_MIN = 7 * 60;

export function local(d: Date | string | number = new Date()): Dayjs {
  return dayjs(d).utcOffset(TZ_OFFSET_MIN);
}

/** Parse "YYYY-MM-DD" + "HH:mm" in Bangkok time to a Date. */
export function fromLocal(date: string, time = '00:00'): Date {
  return dayjs.utc(`${date}T${time}:00`).subtract(TZ_OFFSET_MIN, 'minute').toDate();
}

export function localDateStr(d: Date): string {
  return local(d).format('YYYY-MM-DD');
}

/** "HH:mm" → minutes since midnight */
export function hm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 2 พ.ย. 2569 */
export function thaiDate(d: Date): string {
  const l = local(d);
  return `${l.date()} ${TH_MONTHS[l.month()]} ${l.year() + 543}`;
}

export function thaiDateTime(d: Date): string {
  return `${thaiDate(d)} ${local(d).format('HH:mm')}`;
}

/** YYYY-MM-DD ± days (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  return dayjs.utc(`${date}T00:00:00`).add(days, 'day').format('YYYY-MM-DD');
}

interface Hours { openTime: string; closeTime: string; open24h: boolean; closedWeekdays: string; closedDates: string }

/** Opening window of a business day in minutes from that day's midnight; close may exceed 1440. */
export function businessWindow(shop: Pick<Hours, 'openTime' | 'closeTime' | 'open24h'>) {
  if (shop.open24h) return { open: 0, close: 24 * 60 };
  const open = hm(shop.openTime);
  let close = hm(shop.closeTime);
  if (close <= open) close += 24 * 60;
  return { open, close };
}

/**
 * The shop's "today". A shop that closes at 02:00 is still on Monday's night at
 * 01:00 Tuesday, so bookings for that night belong to Monday.
 */
export function businessToday(shop: Pick<Hours, 'openTime' | 'closeTime' | 'open24h'>, at = new Date()): string {
  const l = local(at);
  const { close } = businessWindow(shop);
  const nowMin = l.hour() * 60 + l.minute();
  if (close > 24 * 60 && nowMin < close - 24 * 60) return l.subtract(1, 'day').format('YYYY-MM-DD');
  return l.format('YYYY-MM-DD');
}

export function isClosedDay(shop: Pick<Hours, 'closedWeekdays' | 'closedDates'>, date: string): boolean {
  const dow = dayjs.utc(`${date}T00:00:00`).day();
  if (shop.closedWeekdays.split(',').filter(Boolean).map(Number).includes(dow)) return true;
  return shop.closedDates.split(',').includes(date);
}
