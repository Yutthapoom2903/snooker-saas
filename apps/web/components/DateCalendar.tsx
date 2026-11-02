'use client';
import { useMemo, useState } from 'react';

export type DayStatus = 'open' | 'few' | 'full' | 'closed';

const WEEK = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Month grid limited to the shop's booking window. Days outside the window, closed
 * days and full days can't be picked; "few" days carry a yellow dot. Arrow keys move
 * the focus by day/week (roving tabindex), as in a native date grid.
 */
export function DateCalendar({
  value,
  min,
  max,
  status,
  onChange,
}: {
  value: string;
  min: string;
  max: string;
  status: Record<string, DayStatus>;
  onChange: (d: string) => void;
}) {
  const [month, setMonth] = useState(() => value.slice(0, 7));
  const first = parse(`${month}-01`);
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();

  const cells = useMemo(() => {
    const lead = first.getUTCDay();
    const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysIn; d++) out.push(iso(new Date(Date.UTC(y, m, d))));
    while (out.length % 7) out.push(null);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const shift = (n: number) => setMonth(iso(new Date(Date.UTC(y, m + n, 1))).slice(0, 7));
  const canPrev = `${month}-01` > min;
  const canNext = iso(new Date(Date.UTC(y, m + 1, 1))) <= max;
  const pickable = (d: string) => d >= min && d <= max && status[d] !== 'closed' && status[d] !== 'full';

  function onKey(e: React.KeyboardEvent<HTMLButtonElement>, d: string) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = iso(new Date(parse(d).getTime() + step * 86400000));
    if (next < min || next > max) return;
    if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7));
    requestAnimationFrame(() => (document.querySelector(`[data-day="${next}"]`) as HTMLElement | null)?.focus());
  }

  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} disabled={!canPrev} className="rounded-md p-1.5 text-baize hover:bg-mist disabled:text-ink-mute/30" aria-label="เดือนก่อน">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <p className="font-medium" aria-live="polite">{MONTHS[m]} {y + 543}</p>
        <button type="button" onClick={() => shift(1)} disabled={!canNext} className="rounded-md p-1.5 text-baize hover:bg-mist disabled:text-ink-mute/30" aria-label="เดือนถัดไป">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
      <div role="grid" aria-label={`${MONTHS[m]} ${y + 543}`} className="grid grid-cols-7 gap-0.5 text-center">
        {WEEK.map((w) => (
          <span key={w} role="columnheader" className="pb-1 text-xs text-ink-mute">{w}</span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const st = status[d];
          const inRange = d >= min && d <= max;
          const ok = pickable(d);
          const selected = d === value;
          const label = `${parse(d).getUTCDate()} ${MONTHS[m]}${st === 'closed' ? ' ร้านปิด' : st === 'full' ? ' เต็ม' : st === 'few' ? ' เหลือน้อย' : ''}`;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              data-day={d}
              aria-selected={selected}
              aria-label={label}
              aria-disabled={!ok}
              tabIndex={selected || (!value && d === min) ? 0 : -1}
              onKeyDown={(e) => onKey(e, d)}
              onClick={() => ok && onChange(d)}
              className={`num relative flex h-10 flex-col items-center justify-center rounded-lg text-sm transition-colors duration-150 ${
                selected
                  ? 'bg-baize text-white'
                  : ok
                    ? 'hover:bg-mist'
                    : inRange
                      ? 'cursor-not-allowed text-ink-mute/50 line-through decoration-ink-mute/40'
                      : 'cursor-default text-ink-mute/30'
              }`}
            >
              {parse(d).getUTCDate()}
              {inRange && st === 'few' && !selected && <span className="absolute bottom-1 size-1 rounded-full bg-ball-yellow" aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-mute">
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ball-yellow" aria-hidden />เหลือน้อย</span>
        <span><span className="line-through">12</span> เต็มหรือร้านปิด</span>
      </p>
    </div>
  );
}
