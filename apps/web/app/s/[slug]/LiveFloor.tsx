'use client';
import { useCallback, useEffect, useState } from 'react';
import { TableArt } from '@/components/TableArt';
import { Button } from '@/components/ui';
import { clock, hhmm } from '@/lib/format';
import { useTick } from '@/lib/live';
import type { PublicShop, PublicTable } from '@/lib/types';
import { PICK_TABLE } from './BookingForm';

const STATUS_TEXT: Record<PublicTable['status'], string> = { free: 'ว่าง', playing: 'มีคนเล่น', paused: 'พักเกม', reserved: 'มีคิวจอง' };

export function LiveFloor({ slug, initial }: { slug: string; initial: PublicTable[] }) {
  const [tables, setTables] = useState(initial);
  // Booking is the page's job; the floor is there for whoever wants to look.
  const [open, setOpen] = useState(false);
  useTick(1000);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    const r = await fetch(`/api/public/shops/${slug}`, { cache: 'no-store' }).catch(() => null);
    if (r?.ok) setTables(((await r.json()) as PublicShop).tables);
  }, [slug]);

  useEffect(() => {
    const t = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refresh]);

  const free = tables.filter((t) => t.status === 'free').length;

  const pick = (id: string) => window.dispatchEvent(new CustomEvent(PICK_TABLE, { detail: id }));

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft" aria-live="polite">
          ว่าง <span className="num text-base text-baize">{free}</span> จาก <span className="num text-base">{tables.length}</span> โต๊ะ
        </p>
        <Button variant="outline" size="sm" aria-expanded={open} aria-controls="live-floor" onClick={() => setOpen((o) => !o)}>
          {open ? 'ซ่อนผังโต๊ะ' : 'ดูผังโต๊ะ'}
        </Button>
      </div>
      {open && (
        <div id="live-floor" className="swap-in">
          <p className="mt-2 max-w-[60ch] text-sm text-ink-mute">โต๊ะที่ไฟเปิดคือมีคนเล่นอยู่ ลูกเหลืองคือมีคิวจองใกล้ถึงเวลา กดโต๊ะเพื่อเลือกในฟอร์มจอง</p>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
            {tables.map((t) => {
              const body = (
                <>
                  <TableArt state={t.status} title={`${t.name} ${STATUS_TEXT[t.status]}`} />
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="num text-sm text-ink-soft">{t.pricePerHour}฿/ชม.</span>
                  </div>
                  <p className={`text-sm ${t.status === 'free' ? 'text-baize' : t.status === 'reserved' ? 'text-[#8a6210]' : 'text-ink-soft'}`}>
                    {STATUS_TEXT[t.status]}
                    {t.status === 'playing' && t.since && <span className="num"> {clock(Date.now() - new Date(t.since).getTime(), false)} ชม.</span>}
                    {t.status === 'reserved' && t.nextBookingAt && <span className="num"> {hhmm(t.nextBookingAt)} น.</span>}
                    {t.status === 'free' && t.nextBookingAt && <span className="text-ink-mute"> · คิวถัดไป <span className="num">{hhmm(t.nextBookingAt)}</span></span>}
                  </p>
                </>
              );
              return (
                <li key={t.id}>
                  {t.bookable ? (
                    <button type="button" onClick={() => pick(t.id)} aria-label={`จอง${t.name}`} className="press -m-1.5 block w-[calc(100%+0.75rem)] rounded-xl p-1.5 text-left hover:bg-white/70">
                      {body}
                    </button>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
