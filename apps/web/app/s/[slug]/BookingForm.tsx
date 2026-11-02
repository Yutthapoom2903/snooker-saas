'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { todayLocal } from '@/lib/format';
import type { PublicShop } from '@/lib/types';
import { Button } from '@/components/ui';
import { DateCalendar, DayStatus } from '@/components/DateCalendar';

/** Fired by the live floor when a customer taps a table: preselect it here. */
export const PICK_TABLE = 'cue:pick-table';

/** Server's offer when the slot was taken a moment ago (409). */
interface Alternative { tableId: string | null; table: string; date: string; time: string }

interface CalendarResp { today: string; horizonDays: number; days: { date: string; status: DayStatus }[] }

interface Availability {
  date: string;
  tables: { id: string; name: string; pricePerHour: number; busy: { startAt: string; endAt: string }[] }[];
}

const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const fmt = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** YYYY-MM-DD + days */
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Bangkok wall time → epoch ms */
const epoch = (date: string, min: number) => Date.parse(`${addDays(date, Math.floor(min / 1440))}T${fmt(min % 1440)}:00+07:00`);

const utcDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fullDate = (d: string) => new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(utcDate(d));
const shortDate = (d: string) => new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(utcDate(d));

const QUICK = 4; // chips that always fit the card without scrolling

const STEPS = ['กรอกข้อมูลการจอง', 'ยืนยันตัวตนผ่าน LINE', 'โอนมัดจำและแนบสลิป', 'รับ QR สำหรับเช็คอินที่ร้าน'];

export function BookingForm({ shop }: { shop: PublicShop }) {
  // The shop's business day: at 01:00 a shop that closes at 02:00 is still on "tonight".
  const today = shop.today;
  const lateNight = today !== todayLocal();
  const quick = useMemo(() => Array.from({ length: QUICK }, (_, i) => addDays(today, i)), [today]);
  const maxDate = addDays(today, shop.bookingHorizonDays);
  const [date, setDate] = useState(today);
  const [cal, setCal] = useState<Record<string, DayStatus>>({});
  const [calOpen, setCalOpen] = useState(false);
  const [time, setTime] = useState<number | null>(null); // minutes from business-day midnight (may exceed 1440)
  const [hours, setHours] = useState(2);
  const [tableId, setTableId] = useState('');
  const [party, setParty] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [agree, setAgree] = useState(false);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alts, setAlts] = useState<Alternative[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const tableRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const onPick = (e: Event) => {
      setTableId((e as CustomEvent<string>).detail);
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      formRef.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
      tableRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener(PICK_TABLE, onPick);
    return () => window.removeEventListener(PICK_TABLE, onPick);
  }, []);

  useEffect(() => {
    api<CalendarResp>(`/public/shops/${shop.slug}/calendar`)
      .then((c) => {
        setCal(Object.fromEntries(c.days.map((d) => [d.date, d.status])));
        // If today is closed or full, start on the first day that can still be booked.
        const first = c.days.find((d) => d.status === 'open' || d.status === 'few');
        setDate((cur) => {
          const st = c.days.find((d) => d.date === cur)?.status;
          return (st === 'closed' || st === 'full') && first ? first.date : cur;
        });
      })
      .catch(() => undefined);
  }, [shop.slug]);

  useEffect(() => {
    let alive = true;
    setAvail(null);
    api<Availability>(`/public/shops/${shop.slug}/availability?date=${date}`).then((a) => alive && setAvail(a)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [date, shop.slug]);

  // A 24-hour shop starts games any time of day and lets them run past midnight.
  const open = shop.open24h ? 0 : toMin(shop.openTime);
  let close = shop.open24h ? 1440 + 240 : toMin(shop.closeTime);
  if (close <= open) close += 1440;
  const lastStart = shop.open24h ? 1410 : close - 60;

  // Start slots every 30 min, at least 15 min from now, leaving room for 1 hour.
  const slots = useMemo(() => {
    const out: number[] = [];
    const earliest = Date.now() + 15 * 60000;
    for (let m = open; m <= lastStart; m += 30) if (epoch(date, m) >= earliest) out.push(m);
    return out;
  }, [date, open, lastStart]);

  useEffect(() => {
    if (time !== null && !slots.includes(time)) setTime(null);
  }, [slots, time]);

  const maxHours = time === null || shop.open24h ? 4 : Math.min(4, Math.floor((close - time) / 60));
  useEffect(() => {
    if (hours > maxHours) setHours(Math.max(1, maxHours));
  }, [hours, maxHours]);

  const tableFree = (t: Availability['tables'][number]) => {
    if (time === null) return true;
    const s = epoch(date, time);
    const e = s + hours * 3600000;
    return !t.busy.some((b) => Date.parse(b.startAt) < e && Date.parse(b.endAt) > s);
  };
  const freeTables = avail?.tables.filter(tableFree) ?? [];
  const chosen = avail?.tables.find((t) => t.id === tableId);
  useEffect(() => {
    if (chosen && !tableFree(chosen)) setTableId('');
  });

  const price = (chosen?.pricePerHour ?? Math.min(...(avail?.tables.map((t) => t.pricePerHour) ?? [0]))) * hours;
  const phoneOk = /^0\d{8,9}$/.test(phone.replace(/\D/g, ''));
  const ready = time !== null && name.trim() && phoneOk && agree && (!avail || freeTables.length > 0);
  // A greyed-out button alone reads as broken; name the first thing still missing.
  const missing =
    time === null ? 'เลือกเวลาเริ่ม'
    : avail && freeTables.length === 0 ? 'เลือกเวลาที่ยังมีโต๊ะว่าง'
    : !name.trim() ? 'กรอกชื่อผู้จอง'
    : !phoneOk ? 'กรอกเบอร์โทรให้ครบ'
    : !agree ? 'ติ๊กรับทราบเงื่อนไขมัดจำ'
    : null;

  function takeAlt(a: Alternative) {
    // The form keeps late-night times on the business day (25:00 = 01:00 next day).
    const nextDay = a.date === addDays(date, 1);
    if (!nextDay && a.date !== date) setDate(a.date);
    setTableId(a.tableId ?? '');
    setTime(toMin(a.time) + (nextDay ? 1440 : 0));
    setAlts([]);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || time === null) return;
    setBusy(true);
    setError(null);
    setAlts([]);
    try {
      const r = await api<{ lineUrl: string }>(`/public/shops/${shop.slug}/bookings`, {
        method: 'POST',
        json: {
          date: addDays(date, Math.floor(time / 1440)),
          time: fmt(time % 1440),
          hours,
          partySize: party,
          tableId: tableId || null,
          name,
          phone: phone.replace(/\D/g, ''),
          note,
        },
      });
      window.location.href = r.lineUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ส่งการจองไม่สำเร็จ ลองอีกครั้ง');
      if (err instanceof ApiError && err.status === 409) setAlts((err.data as { alternatives?: Alternative[] } | undefined)?.alternatives ?? []);
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="scroll-mt-4 rounded-2xl border border-line bg-white/90 p-5 shadow-[0_1px_0_rgba(14,107,67,0.06),0_12px_40px_-20px_rgba(14,107,67,0.35)] backdrop-blur sm:p-6">
      <h2 className="text-xl font-semibold text-baize-deep">จองโต๊ะล่วงหน้า</h2>
      <ol className="mt-3 space-y-1 text-sm text-ink-soft">
        {STEPS.map((s, i) => (
          <li key={s} className="flex gap-2">
            <span className={`num inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${i === 0 ? 'bg-baize text-white' : 'bg-mist text-baize'}`}>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <fieldset className="mt-5">
        <legend className="label">วันที่</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {quick.map((d, i) => {
            const st = cal[d];
            const blocked = st === 'closed' || st === 'full';
            const on = date === d && !calOpen;
            return (
              <button
                type="button"
                key={d}
                disabled={blocked}
                onClick={() => {
                  setDate(d);
                  setCalOpen(false);
                }}
                aria-pressed={on}
                className={`press relative flex min-h-12 flex-col items-center justify-center rounded-lg border px-1 text-sm leading-tight transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-mist/50 disabled:text-ink-mute/60 ${on ? 'border-baize bg-baize text-white' : 'border-line bg-white hover:border-felt'}`}
              >
                <span>{i === 0 ? (lateNight ? 'คืนนี้' : 'วันนี้') : i === 1 ? 'พรุ่งนี้' : shortDate(d).split(' ')[0]}</span>
                <span className={`num text-xs ${on ? 'text-white/80' : 'text-ink-mute'}`}>
                  {st === 'closed' ? 'ปิด' : st === 'full' ? 'เต็ม' : utcDate(d).getUTCDate()}
                </span>
                {st === 'few' && !on && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-ball-yellow" aria-label="เหลือน้อย" />}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCalOpen((v) => !v)}
            aria-expanded={calOpen}
            aria-controls="booking-calendar"
            className={`press flex min-h-12 flex-col items-center justify-center rounded-lg border px-1 text-sm leading-tight transition-colors ${calOpen || !quick.includes(date) ? 'border-baize bg-baize text-white' : 'border-line bg-white hover:border-felt'}`}
          >
            <span>{!quick.includes(date) ? shortDate(date).split(' ')[0] : 'วันอื่น'}</span>
            <span className={`num text-xs ${calOpen || !quick.includes(date) ? 'text-white/80' : 'text-ink-mute'}`}>
              {!quick.includes(date) ? utcDate(date).getUTCDate() : 'ปฏิทิน'}
            </span>
          </button>
        </div>
        {calOpen && (
          <div id="booking-calendar" className="mt-2">
            <DateCalendar
              value={date}
              min={today}
              max={maxDate}
              status={cal}
              onChange={(d) => {
                setDate(d);
                setCalOpen(false);
              }}
            />
          </div>
        )}
        <p className="mt-2 text-sm text-baize-deep" aria-live="polite">{fullDate(date)}</p>
      </fieldset>

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
        <label>
          <span className="label">เวลาเริ่ม</span>
          <select className="field" value={time ?? ''} onChange={(e) => setTime(e.target.value === '' ? null : Number(e.target.value))} required>
            <option value="">{slots.length ? 'เลือกเวลา' : 'วันนี้ไม่มีเวลาว่างแล้ว'}</option>
            {slots.map((m) => (
              <option key={m} value={m}>
                {fmt(m)} น.{m >= 1440 ? ' (หลังเที่ยงคืน)' : ''}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="label">ชั่วโมง</legend>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {[1, 2, 3, 4].map((h) => (
              <button
                type="button"
                key={h}
                disabled={h > maxHours}
                onClick={() => setHours(h)}
                aria-pressed={hours === h}
                className={`num w-10 py-2 text-sm transition-colors disabled:text-ink-mute/40 ${hours === h ? 'bg-baize text-white' : 'bg-white hover:bg-mist'}`}
              >
                {h}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
        <label>
          <span className="label">โต๊ะ</span>
          <select ref={tableRef} className="field" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">โต๊ะไหนก็ได้{time !== null && avail ? ` (ว่าง ${freeTables.length})` : ''}</option>
            {avail?.tables.map((t) => (
              <option key={t.id} value={t.id} disabled={!tableFree(t)}>
                {t.name} {t.pricePerHour}฿/ชม.{tableFree(t) ? '' : ' (ถูกจองแล้ว)'}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="label">จำนวนคน</legend>
          <div className="flex items-center rounded-lg border border-line">
            <button type="button" className="px-3 py-2 text-baize disabled:text-ink-mute/40" onClick={() => setParty((p) => Math.max(1, p - 1))} disabled={party <= 1} aria-label="ลดจำนวนคน">−</button>
            <span className="num w-6 text-center" aria-live="polite">{party}</span>
            <button type="button" className="px-3 py-2 text-baize disabled:text-ink-mute/40" onClick={() => setParty((p) => Math.min(8, p + 1))} disabled={party >= 8} aria-label="เพิ่มจำนวนคน">+</button>
          </div>
        </fieldset>
      </div>
      {time !== null && avail && freeTables.length === 0 && <p className="mt-2 text-sm text-ball-red">ช่วงเวลานี้โต๊ะเต็ม ลองเลือกเวลาอื่น</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <label>
          <span className="label">ชื่อผู้จอง</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
        </label>
        <label>
          <span className="label">เบอร์โทร</span>
          <input className="field num" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="08xxxxxxxx" required />
          {phone && !phoneOk && <span className="mt-1 block text-xs text-ball-red">เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0</span>}
        </label>
      </div>
      <label className="mt-3 block">
        <span className="label">หมายเหตุถึงร้าน (ถ้ามี)</span>
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </label>

      <div className="mt-5 rounded-xl bg-mist px-4 py-3 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-soft">ค่าโต๊ะโดยประมาณ</span>
          <span className="num">{Number.isFinite(price) && price > 0 ? `${price.toLocaleString('th-TH')}฿` : '—'}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-ink-soft">มัดจำตอนจอง (หักจากค่าโต๊ะ)</span>
          <span className="num font-semibold text-baize">{shop.depositAmount}฿</span>
        </div>
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-1 size-4 accent-[#0e6b43]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          รับทราบว่า <strong className="font-medium">หากไม่มาหรือมาสายเกิน {shop.lateGraceMin} นาที</strong> QR การจองจะใช้ไม่ได้ และร้านไม่คืนมัดจำ {shop.depositAmount} บาท
        </span>
      </label>

      {error && (
        <div role="alert" className="mt-3 rounded-lg bg-[#f8e3e1] px-3 py-2 text-sm text-ball-red">
          <p>{error}{alts.length > 0 && ' ข้อมูลที่กรอกไว้ยังอยู่ เลือกทางนี้แทนได้'}</p>
          {alts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {alts.map((a) => (
                <button key={`${a.tableId}-${a.date}-${a.time}`} type="button" onClick={() => takeAlt(a)} className="press rounded-lg border border-ball-red/30 bg-white px-3 py-1.5 text-ink hover:border-ball-red/60">
                  {a.table} เวลา <span className="num">{a.time}</span> น.
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {missing && <p className="mt-5 text-center text-sm text-ink-soft">{missing}ก่อน แล้วจึงจองได้</p>}
      <Button type="submit" size="lg" className={`${missing ? 'mt-2' : 'mt-5'} w-full bg-[#06c755] hover:bg-[#05b14c] active:bg-[#05a046]`} disabled={!ready} busy={busy}>
        <LineGlyph />
        จองผ่าน LINE
      </Button>
      <p className="mt-2 text-center text-xs text-ink-mute">
        {shop.lineLive ? 'ระบบจะเปิด LINE ให้ยืนยันตัวตน ไม่ต้องพิมพ์ส่งข้อความเอง' : 'โหมดทดลอง: จำลองขั้นตอน LINE บนเว็บ'}
      </p>
    </form>
  );
}

function LineGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.6 1.1-.5 6-3.5 8.2-6 1.5-1.6 2.2-3.3 2.2-5C22.4 6.6 17.9 3 12 3Zm-3.8 10.6H6.3c-.3 0-.5-.2-.5-.5V9.2c0-.3.2-.5.5-.5s.5.2.5.5v3.4h1.4c.3 0 .5.2.5.5s-.2.5-.5.5Zm2-.5c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.2c0-.3.2-.5.5-.5s.5.2.5.5v3.9Zm4.6 0c0 .2-.1.4-.3.5h-.2c-.2 0-.3-.1-.4-.2l-2-2.7v2.4c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.2c0-.2.1-.4.3-.5h.2c.2 0 .3.1.4.2l2 2.7V9.2c0-.3.2-.5.5-.5s.5.2.5.5v3.9Zm3.2-2.5c.3 0 .5.2.5.5s-.2.5-.5.5h-1.4v.9H18c.3 0 .5.2.5.5s-.2.5-.5.5h-1.9c-.3 0-.5-.2-.5-.5V9.2c0-.3.2-.5.5-.5H18c.3 0 .5.2.5.5s-.2.5-.5.5h-1.4v.9H18Z" />
    </svg>
  );
}
