'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { BOOKING_STATUS, hhmm, thDay, todayLocal } from '@/lib/format';
import { useLive } from '@/lib/live';
import { Badge, Button, Empty, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';

interface BookingRef { code: string; name: string; startAt: string; status: string; table: string | null }
interface Outbox { id: string; to: string; audience: 'CUSTOMER' | 'ADMIN'; altText: string; payload: string; bookingId: string | null; booking: BookingRef | null; mock: boolean; error: string | null; createdAt: string }
interface Thread { key: string; booking: BookingRef | null; rows: Outbox[]; last: string }

const GENERAL = 'general';

/** Rows arrive newest first; threads keep that order, messages inside a thread read oldest first like a chat. */
function threadsOf(rows: Outbox[]): Thread[] {
  const map = new Map<string, Thread>();
  for (const r of rows) {
    const key = r.bookingId ?? GENERAL; // messages not tied to a booking share one thread
    let t = map.get(key);
    if (!t) map.set(key, (t = { key, booking: r.booking, rows: [], last: r.createdAt }));
    t.rows.unshift(r);
  }
  return [...map.values()];
}

const dayKey = (d: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(d));
function dayLabel(d: string) {
  const k = dayKey(d);
  return k === todayLocal() ? 'วันนี้' : k === todayLocal(-1) ? 'เมื่อวาน' : thDay(d);
}
// Minimal Flex renderer: enough to read the message and press its buttons.
type Node = { type: string; text?: string; url?: string; contents?: Node[]; action?: { type: string; label: string; uri?: string; data?: string }; style?: string; color?: string };

export default function LineInbox() {
  const [rows, setRows] = useState<Outbox[] | null>(null);
  const toast = useToast();
  const load = useCallback(() => api<Outbox[]>('/line/outbox').then(setRows).catch(() => undefined), []);
  useEffect(() => {
    load();
  }, [load]);
  useLive(['line'], load);

  const live = rows?.some((r) => !r.mock);
  const threads = rows ? threadsOf(rows) : [];
  const [picked, setPicked] = useState<string | null>(null);
  // Phones show one pane at a time: the list, or the thread that was opened from it.
  const [phoneThread, setPhoneThread] = useState(false);
  const current = threads.find((t) => t.key === picked) ?? threads[0];

  async function postback(data: string) {
    const p = new URLSearchParams(data);
    const a = p.get('a');
    const id = p.get('b');
    if (!id || (a !== 'confirm' && a !== 'reject')) return;
    try {
      await api(`/bookings/${id}/${a}`, { method: 'POST', json: {} });
      toast(a === 'confirm' ? 'ยืนยันการจองแล้ว' : 'ปฏิเสธการจองแล้ว');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  function render(n: Node, key: string | number): React.ReactNode {
    switch (n.type) {
      case 'bubble': {
        const b = n as unknown as { header?: Node; body?: Node; footer?: Node };
        return (
          <div key={key} className="w-full max-w-[300px] overflow-hidden rounded-2xl border border-line bg-white text-sm shadow-sm">
            {b.header && <div className="bg-baize px-4 py-3 text-white">{b.header.contents?.map(render)}</div>}
            {b.body && <div className="space-y-2 px-4 py-3">{b.body.contents?.map(render)}</div>}
            {b.footer && <div className="space-y-1.5 border-t border-line px-3 py-3">{b.footer.contents?.map(render)}</div>}
          </div>
        );
      }
      case 'box':
        return <div key={key} className="flex gap-2">{n.contents?.map(render)}</div>;
      case 'text':
        return <p key={key} className="min-w-0 flex-1 break-words" style={{ color: n.color }}>{n.text}</p>;
      case 'image':
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={key} src={toLocal(n.url ?? '')} alt="" className="mx-auto w-40" />;
      case 'button': {
        const a = n.action!;
        const cls = `w-full rounded-lg py-2 text-center text-sm font-medium ${n.style === 'primary' ? 'bg-baize text-white' : 'bg-mist text-baize-deep'}`;
        return a.type === 'uri' ? (
          <a key={key} href={toLocal(a.uri ?? '#')} target="_blank" className={`block ${cls}`}>{a.label}</a>
        ) : (
          <button key={key} className={cls} onClick={() => postback(a.data ?? '')}>{a.label}</button>
        );
      }
      default:
        return null;
    }
  }

  return (
    <>
      <PageHead
        title="ข้อความ LINE ที่ร้านส่ง"
        sub={live ? 'ข้อความที่ระบบส่งออกไปทาง LINE ของร้าน' : 'โหมดทดลอง: ยังไม่ได้เชื่อม LINE OA ข้อความที่จะส่งจะแสดงที่นี่แทน กดปุ่มในการ์ดได้เหมือนกดใน LINE'}
      >
        <Button variant="outline" onClick={load}>โหลดใหม่</Button>
      </PageHead>
      {!rows ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : rows.length === 0 ? (
        <Empty title="ยังไม่มีข้อความ">ลองจองโต๊ะจากหน้าเว็บของร้าน ข้อความถึงลูกค้าและถึงกลุ่มพนักงานจะขึ้นที่นี่</Empty>
      ) : (
        <div className="grid overflow-hidden rounded-2xl border border-line bg-white lg:h-[calc(100dvh-11rem)] lg:min-h-[30rem] lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <nav aria-label="การจอง" className={`min-h-0 overflow-y-auto border-line lg:block lg:border-r ${phoneThread ? 'hidden' : ''}`}>
            {threads.map((t, i) => {
              const newDay = i === 0 || dayKey(threads[i - 1].last) !== dayKey(t.last);
              const st = t.booking ? BOOKING_STATUS[t.booking.status] : null;
              const on = t.key === current?.key;
              const lastRow = t.rows[t.rows.length - 1];
              return (
                <div key={t.key}>
                  {newDay && <p className="sticky top-0 z-10 border-b border-line bg-white/95 px-4 py-1.5 text-xs text-ink-mute backdrop-blur">{dayLabel(t.last)}</p>}
                  <button
                    type="button"
                    aria-current={on ? 'true' : undefined}
                    onClick={() => {
                      setPicked(t.key);
                      setPhoneThread(true);
                    }}
                    className={`block w-full border-b border-l-[3px] border-b-line/70 px-4 py-3 text-left transition-colors duration-150 ${on ? 'border-l-baize bg-mist' : 'border-l-transparent hover:bg-mist/50'}`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {t.booking ? (
                          <>
                            <span className="num font-medium text-baize-deep">{t.booking.code}</span> <span className="text-sm">{t.booking.name}</span>
                          </>
                        ) : (
                          <span className="font-medium">ข้อความทั่วไป</span>
                        )}
                      </span>
                      <span className="num shrink-0 text-xs text-ink-mute">{hhmm(t.last)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-ink-soft">{lastRow.altText}</span>
                    {st && <span className="mt-1.5 block"><Badge tone={st.tone}>{st.label}</Badge></span>}
                  </button>
                </div>
              );
            })}
          </nav>

          {current && (
            <section aria-label={current.booking ? `การจอง ${current.booking.code}` : 'ข้อความทั่วไป'} className={`min-h-0 min-w-0 flex-col lg:flex ${phoneThread ? 'flex' : 'hidden'}`}>
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
                <button type="button" onClick={() => setPhoneThread(false)} className="-ml-1 rounded-md px-1 py-0.5 text-sm text-baize lg:hidden">ทุกการจอง</button>
                {current.booking ? (
                  <>
                    <span className="num font-medium text-baize-deep">{current.booking.code}</span>
                    <span>{current.booking.name}</span>
                    <span className="text-sm text-ink-mute">
                      {current.booking.table ?? 'โต๊ะไหนก็ได้'}, {thDay(current.booking.startAt)} <span className="num">{hhmm(current.booking.startAt)}</span> น.
                    </span>
                    {BOOKING_STATUS[current.booking.status] && <Badge tone={BOOKING_STATUS[current.booking.status].tone}>{BOOKING_STATUS[current.booking.status].label}</Badge>}
                  </>
                ) : (
                  <span className="font-medium">ข้อความทั่วไป</span>
                )}
              </header>
              <ol className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-mist/40 px-4 py-5 sm:px-6">
                {current.rows.map((r) => {
                  const msgs = JSON.parse(r.payload) as ({ type: 'text'; text: string } | { type: 'flex'; contents: Node })[];
                  const toAdmin = r.audience === 'ADMIN';
                  return (
                    <li key={r.id} className={`flex flex-col gap-1.5 ${toAdmin ? 'items-end' : 'items-start'}`}>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
                        <Badge tone={toAdmin ? 'yellow' : 'green'}>{toAdmin ? 'ส่งถึงกลุ่มพนักงาน' : 'ส่งถึงลูกค้า'}</Badge>
                        <span className="num">{dayKey(r.createdAt) === dayKey(current.last) ? hhmm(r.createdAt) : `${thDay(r.createdAt)} ${hhmm(r.createdAt)}`}</span>
                        {r.mock && <span>จำลอง</span>}
                        {r.error && <span className="text-ball-red">ส่งไม่สำเร็จ: {r.error}</span>}
                      </p>
                      {msgs.map((m, j) =>
                        m.type === 'text' ? (
                          <p key={j} className={`max-w-[300px] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line ${toAdmin ? 'bg-baize text-white' : 'border border-line bg-white'}`}>{m.text}</p>
                        ) : (
                          render(m.contents, j)
                        ),
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>
      )}
    </>
  );
}

/** LINE needs absolute URLs; in the inbox open them on this host instead. */
function toLocal(u: string) {
  try {
    const url = new URL(u);
    return url.pathname + url.search;
  } catch {
    return u;
  }
}
