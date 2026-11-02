'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { baht, clock, hhmm, METHOD, minutesText } from '@/lib/format';
import { useLive, useTick } from '@/lib/live';
import type { Bill, BoardTable } from '@/lib/types';
import { TableArt, TableState } from '@/components/TableArt';
import { Badge, Button, Empty, Field, Modal, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';

interface Customer { id: string; name: string; phone: string | null; membership: { plan: string; discountPercent: number; endsAt: string } | null }

function stateOf(t: BoardTable): TableState {
  if (t.session) return t.session.status === 'PAUSED' ? 'paused' : 'playing';
  if (t.upcoming.some((b) => b.status === 'CHECKED_IN')) return 'reserved';
  const next = t.upcoming.find((b) => b.status === 'CONFIRMED');
  if (next && Date.parse(next.startAt) - Date.now() < 30 * 60000) return 'reserved';
  return 'free';
}

export default function FloorPage() {
  const [tables, setTables] = useState<BoardTable[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [opening, setOpening] = useState<BoardTable | null>(null);
  const [closing, setClosing] = useState<BoardTable | null>(null);
  const toast = useToast();
  useTick(1000);

  const load = useCallback(async () => {
    try {
      setTables(await api<BoardTable[]>('/board'));
      setLoadedAt(Date.now());
    } catch (e) {
      if (e instanceof ApiError) toast(e.message, 'error');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useLive(['tables', 'bookings', 'devices'], () => load());
  useLive(['score'], (_k, data) => {
    const d = data as { tableId: string; score: BoardTable['score'] } | undefined;
    if (!d) return;
    setTables((ts) => ts?.map((t) => (t.id === d.tableId ? { ...t, score: d.score } : t)) ?? ts);
  }, 60000);

  async function act(path: string, ok: string) {
    try {
      await api(path, { method: 'POST' });
      toast(ok);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'ทำรายการไม่สำเร็จ', 'error');
    }
  }

  const playing = tables?.filter((t) => t.session).length ?? 0;

  return (
    <>
      <PageHead title="โต๊ะในร้าน" sub={tables ? `เล่นอยู่ ${playing} จาก ${tables.length} โต๊ะ` : undefined} />
      {!tables ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : tables.length === 0 ? (
        <Empty title="ยังไม่มีโต๊ะ">เพิ่มโต๊ะได้ที่เมนู โต๊ะและราคา</Empty>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {tables.map((t) => {
            const s = t.session;
            const elapsed = s ? s.playedMs + (s.status === 'RUNNING' ? Date.now() - loadedAt : 0) : 0;
            const state = stateOf(t);
            const next = t.upcoming[0];
            const arrived = t.upcoming.find((b) => b.status === 'CHECKED_IN');
            return (
              <li key={t.id} className="floor-card rounded-2xl border border-line bg-white p-4" data-state={state}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{t.name}</h2>
                    {t.device && (
                      <span className={`size-2 rounded-full ${t.device.online ? 'bg-felt' : 'bg-ink-mute/40'}`} title={t.device.online ? 'บอร์ดออนไลน์' : 'บอร์ดออฟไลน์'} aria-label={t.device.online ? 'บอร์ดออนไลน์' : 'บอร์ดออฟไลน์'} />
                    )}
                  </div>
                  <span className="num text-sm text-ink-mute">{t.pricePerHour}฿/ชม.</span>
                </div>

                <div className="relative">
                  <TableArt state={state} title={`${t.name}`} />
                  {s && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className={`timer num rounded-md bg-black/35 px-2.5 py-0.5 text-[clamp(1.4rem,3.2vw,2rem)] text-white backdrop-blur-[2px] ${s.status === 'PAUSED' ? 'opacity-70' : ''}`} aria-label={`เวลาเล่น ${clock(elapsed)}`}>
                        {clock(elapsed)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-3 min-h-[3.25rem] text-sm">
                  {s ? (
                    <>
                      <p>
                        {s.customerName ?? 'ลูกค้าหน้าร้าน'}
                        {s.bookingCode && <Badge tone="green">จอง {s.bookingCode}</Badge>}
                        {s.status === 'PAUSED' && <> <Badge tone="yellow">พักเกม</Badge></>}
                      </p>
                      <p className="text-ink-mute">เริ่ม <span className="num">{hhmm(s.startedAt)}</span> น.</p>
                    </>
                  ) : arrived ? (
                    <p className="text-[#7a560e]">
                      <Badge tone="yellow">เช็คอินแล้ว รอเริ่ม</Badge> {arrived.name} <span className="num text-ink-mute">({arrived.code})</span>
                    </p>
                  ) : next ? (
                    <p className={state === 'reserved' ? 'text-[#7a560e]' : 'text-ink-soft'}>
                      คิวถัดไป <span className="num">{hhmm(next.startAt)}</span> น. {next.name} <span className="num text-ink-mute">({next.code})</span>
                    </p>
                  ) : (
                    <p className="text-baize">ว่าง</p>
                  )}
                  {t.score && s && (
                    <p className="num mt-1 text-ink-soft" aria-label="คะแนน">
                      <span className={t.score.active === 1 ? 'text-baize' : ''}>{t.score.p1}</span>
                      {' – '}
                      <span className={t.score.active === 2 ? 'text-baize' : ''}>{t.score.p2}</span>
                      <span className="ml-2 text-xs text-ink-mute">เฟรม {t.score.f1}–{t.score.f2}{t.score.brk ? `  เบรก ${t.score.brk}` : ''}</span>
                    </p>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!s && arrived && <Button onClick={() => act(`/bookings/${arrived.id}/start`, `เริ่มจับเวลา${t.name}แล้ว`)}>เริ่มจับเวลา</Button>}
                  {!s && !arrived && <Button onClick={() => setOpening(t)}>เปิดโต๊ะ</Button>}
                  {s && <Button onClick={() => setClosing(t)}>ปิดโต๊ะและคิดเงิน</Button>}
                  {s?.status === 'RUNNING' && <Button variant="outline" onClick={() => act(`/sessions/${s.id}/pause`, `พักเกม ${t.name}`)}>พักเกม</Button>}
                  {s?.status === 'PAUSED' && <Button variant="outline" onClick={() => act(`/sessions/${s.id}/resume`, `เล่นต่อ ${t.name}`)}>เล่นต่อ</Button>}
                  {t.device && s && <Button variant="quiet" onClick={() => act(`/tables/${t.id}/reset-score`, 'ล้างคะแนนแล้ว')}>ล้างคะแนน</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <OpenModal table={opening} onClose={() => setOpening(null)} onDone={load} />
      <CloseModal table={closing} onClose={() => setClosing(null)} onDone={load} />
    </>
  );
}

function OpenModal({ table, onClose, onDone }: { table: BoardTable | null; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!table) {
      setQ('');
      setResults([]);
      setCustomer(null);
      setName('');
    }
  }, [table]);

  useEffect(() => {
    if (!q.trim() || customer) return setResults([]);
    const t = setTimeout(() => api<Customer[]>(`/customers?q=${encodeURIComponent(q.trim())}`).then((r) => setResults(r.slice(0, 6))).catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [q, customer]);

  const upcoming = table?.upcoming.find((b) => b.status === 'CONFIRMED' && Date.parse(b.startAt) - Date.now() < 3 * 3600000);

  async function open() {
    if (!table) return;
    setBusy(true);
    try {
      await api(`/tables/${table.id}/open`, { method: 'POST', json: { customerId: customer?.id, customerName: customer ? undefined : name } });
      toast(`เปิด${table.name}แล้ว`);
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'เปิดโต๊ะไม่สำเร็จ', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!table} onClose={onClose} title={`เปิด${table?.name ?? ''}`}>
      {upcoming && (
        <p className="mb-4 rounded-lg bg-[#fbf1dc] px-3 py-2 text-sm text-[#7a560e]">
          โต๊ะนี้มีคิวจอง <span className="num">{hhmm(upcoming.startAt)}</span> น. ({upcoming.name}) ถ้าลูกค้าที่จองมาถึง ให้สแกน QR แทน
        </p>
      )}
      <Field label="สมาชิก (ค้นหาชื่อหรือเบอร์)" hint="เลือกสมาชิกเพื่อให้ได้ส่วนลดอัตโนมัติ เว้นว่างได้">
        {customer ? (
          <div className="flex items-center justify-between rounded-lg border border-felt bg-mist px-3 py-2">
            <span>
              {customer.name}
              {customer.membership && <span className="ml-2 text-sm text-baize">สมาชิก {customer.membership.plan} −{customer.membership.discountPercent}%</span>}
            </span>
            <button className="text-sm text-ink-mute hover:text-ink" onClick={() => setCustomer(null)}>เปลี่ยน</button>
          </div>
        ) : (
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="เช่น บอย หรือ 0812" />
        )}
      </Field>
      {results.length > 0 && (
        <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
          {results.map((c) => (
            <li key={c.id}>
              <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-mist" onClick={() => setCustomer(c)}>
                <span>{c.name} <span className="num text-ink-mute">{c.phone}</span></span>
                {c.membership ? <Badge tone="green">สมาชิก</Badge> : <span className="text-xs text-ink-mute">ไม่ใช่สมาชิก</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!customer && (
        <Field label="ชื่อลูกค้า (ถ้ามี)" className="mt-4">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={open} busy={busy}>เริ่มจับเวลา</Button>
      </div>
    </Modal>
  );
}

// Card is still a valid method on old records and reports; the counter just doesn't take it.
const CLOSE_METHODS = ['CASH', 'PROMPTPAY', 'TRANSFER'] as const;
type CloseMethod = (typeof CLOSE_METHODS)[number];

interface Preview { bill: Bill; at: string; promptpayReady: boolean }
interface PromptpayQr { amount: number; promptpayId: string; qr: string }

function CloseModal({ table, onClose, onDone }: { table: BoardTable | null; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [method, setMethod] = useState<CloseMethod>('CASH');
  const [qr, setQr] = useState<PromptpayQr | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // After closing, the result stays in the dialog where the cashier is looking, then the dialog goes.
  const [done, setDone] = useState<Bill | null>(null);
  const toast = useToast();
  const sid = table?.session?.id;
  const bill = preview?.bill;
  const leave = useRef(onClose);
  leave.current = onClose;

  useEffect(() => {
    setPreview(null);
    setMethod('CASH');
    setQr(null);
    setQrError(null);
    setDone(null);
    if (!sid) return;
    api<Preview>(`/sessions/${sid}/bill`).then(setPreview).catch((e) => toast(e.message, 'error'));
  }, [sid, toast]);

  // The QR carries the amount of the bill as shown, so it is made once per bill.
  useEffect(() => {
    if (method !== 'PROMPTPAY' || !sid || !preview || qr || qrError) return;
    let alive = true;
    api<PromptpayQr>(`/sessions/${sid}/promptpay?at=${encodeURIComponent(preview.at)}`)
      .then((r) => alive && setQr(r))
      .catch((e) => alive && setQrError(e instanceof ApiError ? e.message : 'สร้าง QR ไม่สำเร็จ'));
    return () => {
      alive = false;
    };
  }, [method, sid, preview, qr, qrError]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => leave.current(), 900);
    return () => clearTimeout(t);
  }, [done]);

  const owed = !!bill && bill.net > 0;

  async function close() {
    if (!sid || !preview) return;
    setBusy(true);
    try {
      const r = await api<{ bill: Bill }>(`/sessions/${sid}/close`, { method: 'POST', json: { method: owed ? method : 'CASH', at: preview.at } });
      setDone(r.bill);
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'ปิดโต๊ะไม่สำเร็จ', 'error');
    } finally {
      setBusy(false);
    }
  }

  const at = CLOSE_METHODS.indexOf(method);
  const cta = !owed ? 'ปิดโต๊ะ' : method === 'CASH' ? 'รับเงินสดแล้ว ปิดโต๊ะ' : 'เงินเข้าแล้ว ปิดโต๊ะ';

  return (
    <Modal open={!!table} onClose={onClose} title={`ปิด${table?.name ?? ''}`} wide>
      {done ? (
        <div className="result-in flex flex-col items-center py-10 text-center" role="status">
          <svg viewBox="0 0 48 48" className="size-14 text-baize" aria-hidden>
            <circle cx="24" cy="24" r="23" fill="currentColor" opacity="0.12" />
            <path className="check-draw" d="M15 25l6 6 12-13" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="mt-3 font-medium">ปิด{table?.name}แล้ว</p>
          <p className="num mt-1 text-2xl text-baize-deep">{done.net > 0 ? `รับ ${baht(done.net)}` : 'ไม่มียอดต้องเก็บ'}</p>
          {done.depositChange > 0 && <p className="mt-1 text-sm text-ink-soft">ทอนมัดจำคืนลูกค้า {baht(done.depositChange)}</p>}
        </div>
      ) : !bill ? (
        <p className="text-ink-mute">กำลังคำนวณ</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:gap-6">
          <section aria-label="บิล" className="flex flex-col rounded-xl bg-mist px-4 py-4">
            <dl className="space-y-1.5 text-sm">
              <Row k="เวลาเล่นจริง" v={minutesText(bill.playedMinutes)} />
              <Row k="คิดเวลา" v={minutesText(bill.billedMinutes)} />
              <Row k={`ค่าโต๊ะ (${table?.session ? `${table.pricePerHour}฿/ชม.` : ''})`} v={baht(bill.gross)} />
              {bill.discount > 0 && <Row k={`ส่วนลด ${bill.discountLabel ?? ''}`} v={`−${baht(bill.discount)}`} tone="green" />}
              {bill.depositApplied > 0 && <Row k="หักมัดจำการจอง" v={`−${baht(bill.depositApplied)}`} tone="green" />}
              {bill.depositChange > 0 && <Row k="มัดจำเหลือ ทอนคืนลูกค้า" v={baht(bill.depositChange)} tone="green" />}
            </dl>
            <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-dashed border-felt/40 pt-3 sm:mt-auto">
              <span className="text-sm text-ink-soft">ยอดที่ต้องเก็บ</span>
              <span className="num text-4xl leading-none text-baize-deep">{baht(bill.net)}</span>
            </div>
          </section>

          <section className="flex flex-col">
            {owed ? (
              <>
                <div role="radiogroup" aria-label="รับชำระด้วย" className="relative grid grid-cols-3 rounded-lg bg-mist p-1">
                  <span aria-hidden className="seg-thumb absolute inset-y-1 left-1 rounded-md bg-white shadow-sm" style={{ width: 'calc((100% - 0.5rem) / 3)', transform: `translateX(${at * 100}%)` }} />
                  {CLOSE_METHODS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={method === k}
                      disabled={k === 'PROMPTPAY' && !preview.promptpayReady}
                      onClick={() => setMethod(k)}
                      className={`relative rounded-md py-2 text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${method === k ? 'font-medium text-baize-deep' : 'text-ink-soft hover:text-ink'}`}
                    >
                      {METHOD[k]}
                    </button>
                  ))}
                </div>
                {!preview.promptpayReady && <p className="mt-1.5 text-xs text-ink-mute">รับพร้อมเพย์ได้หลังตั้งเลขพร้อมเพย์ของร้านในหน้าตั้งค่า</p>}

                <div key={method} className="swap-in mt-4 flex min-h-24 flex-1 flex-col items-center justify-center text-center sm:min-h-64">
                  {method === 'PROMPTPAY' ? (
                    qr ? (
                      <figure className="w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qr.qr} alt={`QR พร้อมเพย์ ${qr.amount} บาท`} className="mx-auto w-44 rounded-lg border border-line bg-white p-1" />
                        <figcaption className="mt-2 text-sm text-ink-soft">
                          ให้ลูกค้าสแกนจ่าย แล้วเช็กยอด <span className="num text-ink">{baht(bill.net)}</span> ในแอปธนาคารของร้าน
                          <span className="num mt-0.5 block text-xs text-ink-mute">พร้อมเพย์ {qr.promptpayId}</span>
                        </figcaption>
                      </figure>
                    ) : qrError ? (
                      <p className="text-sm text-ball-red">{qrError}</p>
                    ) : (
                      <p className="text-sm text-ink-mute">กำลังสร้าง QR</p>
                    )
                  ) : method === 'TRANSFER' ? (
                    <>
                      <PayGlyph kind="TRANSFER" />
                      <p className="mt-3 max-w-64 text-sm text-ink-soft">ให้ลูกค้าโอนเข้าบัญชีร้าน แล้วเช็กยอด <span className="num text-ink">{baht(bill.net)}</span> ในแอปธนาคารก่อนปิดโต๊ะ</p>
                    </>
                  ) : (
                    <>
                      <PayGlyph kind="CASH" />
                      <p className="mt-3 max-w-64 text-sm text-ink-soft">รับเงินสด <span className="num text-ink">{baht(bill.net)}</span> นับให้ครบก่อนปิดโต๊ะ</p>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="flex min-h-24 flex-1 items-center justify-center text-center text-sm text-ink-soft">มัดจำครอบคลุมค่าโต๊ะแล้ว ไม่ต้องเก็บเงินเพิ่ม</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
              <Button onClick={close} busy={busy} disabled={owed && method === 'PROMPTPAY' && !qr}>{cta}</Button>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

/** Quiet marker for the cash / transfer panel, so the space the QR occupies for PromptPay isn't left blank. */
function PayGlyph({ kind }: { kind: 'CASH' | 'TRANSFER' }) {
  return (
    <span className="grid size-14 place-items-center rounded-full bg-mist text-baize" aria-hidden>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'CASH' ? (
          <>
            <rect x="2.5" y="6" width="19" height="12" rx="2" />
            <circle cx="12" cy="12" r="2.6" />
            <path d="M6 9.5v5M18 9.5v5" />
          </>
        ) : (
          <>
            <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" />
            <path d="M10 18.5h4M9.5 10.5l2 2 3.5-3.5" />
          </>
        )}
      </svg>
    </span>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'green' }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-soft">{k}</dt>
      <dd className={`num ${tone === 'green' ? 'text-baize' : ''}`}>{v}</dd>
    </div>
  );
}
