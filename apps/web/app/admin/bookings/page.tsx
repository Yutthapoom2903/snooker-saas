'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { BOOKING_STATUS, hhmm, thDay, todayLocal } from '@/lib/format';
import { useLive } from '@/lib/live';
import { Badge, Button, Empty, Field, Modal, PageHead } from '@/components/ui';
import { isOwner, useMe } from '@/lib/session';
import { useToast } from '@/components/toast';

interface Booking {
  id: string; code: string; name: string; phone: string; partySize: number; note: string | null;
  startAt: string; endAt: string; status: string; depositAmount: number; slipUrl: string | null;
  table: { name: string }; rejectReason: string | null; slipCheck: string | null;
}
interface SlipCheck { verdict: 'pass' | 'fail' | 'manual'; provider: string | null; reasons: string[]; amount: number | null }

const VIEWS = [
  { k: 'action', t: 'รอดำเนินการ', status: 'DEPOSIT_SUBMITTED,PENDING_DEPOSIT' },
  { k: 'upcoming', t: 'กำลังจะมา', status: 'CONFIRMED' },
  { k: 'all', t: 'ทั้งหมด', status: '' },
] as const;

export default function BookingsPage() {
  const [view, setView] = useState<(typeof VIEWS)[number]['k']>('action');
  const [from, setFrom] = useState(todayLocal(-1));
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [slip, setSlip] = useState<Booking | null>(null);
  const [rejecting, setRejecting] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    const v = VIEWS.find((x) => x.k === view)!;
    const q = new URLSearchParams({ from: view === 'all' ? from : todayLocal(-1) });
    if (v.status) q.set('status', v.status);
    api<Booking[]>(`/bookings?${q}`).then(setRows).catch((e) => toast(e.message, 'error'));
  }, [view, from, toast]);
  useEffect(load, [load]);
  useLive(['bookings'], load);

  async function confirm(b: Booking) {
    try {
      await api(`/bookings/${b.id}/confirm`, { method: 'POST' });
      toast(`ยืนยัน ${b.code} แล้ว ส่ง QR ให้ลูกค้าทาง LINE`);
      setSlip(null);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'ยืนยันไม่สำเร็จ', 'error');
    }
  }

  return (
    <>
      <PageHead title="การจอง">
        <Link href="/admin/check-in" className="rounded-lg bg-baize px-4 py-2 text-sm font-medium text-white hover:bg-baize-deep">สแกน QR เช็คอิน</Link>
      </PageHead>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-line bg-white" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.k} role="tab" aria-selected={view === v.k} onClick={() => setView(v.k)} className={`px-4 py-2 text-sm transition-colors ${view === v.k ? 'bg-baize text-white' : 'hover:bg-mist'}`}>{v.t}</button>
          ))}
        </div>
        {view === 'all' && (
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            ตั้งแต่ <input type="date" className="field w-auto py-1.5" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
        )}
      </div>

      {!rows ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : rows.length === 0 ? (
        <Empty title={view === 'action' ? 'ไม่มีการจองที่รอยืนยัน' : 'ไม่มีการจองในช่วงนี้'}>การจองใหม่จากหน้าเว็บร้านจะขึ้นที่นี่และในกลุ่ม LINE ของร้าน</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="data-table min-w-[720px]">
            <thead><tr><th>รหัส</th><th>เวลา</th><th>โต๊ะ</th><th>ผู้จอง</th><th>สถานะ</th><th className="text-right">ดำเนินการ</th></tr></thead>
            <tbody>
              {rows.map((b) => {
                const st = BOOKING_STATUS[b.status] ?? { label: b.status, tone: 'gray' as const };
                return (
                  <tr key={b.id}>
                    <td className="num">{b.code}</td>
                    <td className="whitespace-nowrap">{thDay(b.startAt)} <span className="num">{hhmm(b.startAt)}–{hhmm(b.endAt)}</span></td>
                    <td>{b.table.name}</td>
                    <td>
                      {b.name} <span className="text-ink-mute">({b.partySize} คน)</span>
                      <div className="num text-xs text-ink-mute"><a href={`tel:${b.phone}`}>{b.phone}</a></div>
                      {b.note && <div className="text-xs text-ink-soft">“{b.note}”</div>}
                    </td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="text-right whitespace-nowrap">
                      {b.status === 'DEPOSIT_SUBMITTED' && <Button size="sm" onClick={() => setSlip(b)}>ตรวจสลิป</Button>}
                      {b.status === 'PENDING_DEPOSIT' && <Button size="sm" variant="outline" onClick={() => confirm(b)} title="ใช้เมื่อลูกค้าจ่ายมัดจำที่ร้านหรือช่องทางอื่น">ได้รับมัดจำแล้ว</Button>}
                      {['DEPOSIT_SUBMITTED', 'PENDING_DEPOSIT', 'DRAFT'].includes(b.status) && <Button size="sm" variant="quiet" onClick={() => setRejecting(b)}>ปฏิเสธ</Button>}
                      {b.status === 'CONFIRMED' && <Button size="sm" variant="quiet" onClick={() => setCancelling(b)}>ยกเลิก</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!slip} onClose={() => setSlip(null)} title={`ตรวจสลิป ${slip?.code ?? ''}`}>
        {slip && (
          <>
            <p className="text-sm text-ink-soft">{slip.name} {thDay(slip.startAt)} <span className="num">{hhmm(slip.startAt)}</span> น. {slip.table.name} มัดจำ <span className="num">{slip.depositAmount}</span> บาท</p>
            {slip.slipUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slip.slipUrl} alt="สลิปการโอน" className="mt-3 max-h-[50vh] w-full rounded-lg border border-line object-contain" />
            ) : <p className="mt-3 text-sm">ไม่มีไฟล์สลิป</p>}
            <SlipVerdict raw={slip.slipCheck} deposit={slip.depositAmount} />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRejecting(slip); setSlip(null); }}>ปฏิเสธ</Button>
              <Button onClick={() => confirm(slip)}>ยืนยันการจอง</Button>
            </div>
          </>
        )}
      </Modal>

      <RejectModal b={rejecting} onClose={() => setRejecting(null)} onDone={load} />
      <CancelModal b={cancelling} onClose={() => setCancelling(null)} onDone={load} />
    </>
  );
}

function RejectModal({ b, onClose, onDone }: { b: Booking | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const toast = useToast();
  useEffect(() => setReason(''), [b]);
  async function go() {
    if (!b) return;
    try {
      await api(`/bookings/${b.id}/reject`, { method: 'POST', json: { reason } });
      toast(`ปฏิเสธ ${b.code} แล้ว แจ้งลูกค้าทาง LINE`);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <Modal open={!!b} onClose={onClose} title={`ปฏิเสธการจอง ${b?.code ?? ''}`}>
      <Field label="เหตุผลที่แจ้งลูกค้า" hint="ถ้าลูกค้าโอนมัดจำมาแล้ว ร้านต้องโอนคืนเอง">
        <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น สลิปไม่ถูกต้อง" maxLength={200} />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>กลับ</Button>
        <Button variant="danger" onClick={go}>ปฏิเสธการจอง</Button>
      </div>
    </Modal>
  );
}

function SlipVerdict({ raw, deposit }: { raw: string | null; deposit: number }) {
  if (!raw) return <p className="mt-3 text-sm text-ink-soft">ตรวจยอด {deposit} บาท และชื่อบัญชีผู้รับในสลิปให้ตรงกับร้าน</p>;
  const c = JSON.parse(raw) as SlipCheck;
  if (c.verdict === 'pass') return <p className="mt-3 rounded-lg bg-mist px-3 py-2 text-sm text-baize-deep">ตรวจกับธนาคารแล้ว ยอด {c.amount} บาท เข้าบัญชีร้าน</p>;
  return (
    <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${c.verdict === 'fail' ? 'bg-[#f8e3e1] text-ball-red' : 'bg-[#fbf1dc] text-[#7a560e]'}`}>
      <p className="font-medium">{c.verdict === 'fail' ? 'ตรวจสลิปไม่ผ่าน' : 'ระบบตรวจอัตโนมัติไม่ได้ ตรวจด้วยตา'}</p>
      <ul className="mt-1 list-disc pl-5">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
}

function CancelModal({ b, onClose, onDone }: { b: Booking | null; onClose: () => void; onDone: () => void }) {
  const me = useMe();
  const canRefund = isOwner(me);
  const [refund, setRefund] = useState(canRefund);
  const toast = useToast();
  useEffect(() => setRefund(canRefund), [b, canRefund]);
  async function go() {
    if (!b) return;
    try {
      await api(`/bookings/${b.id}/cancel`, { method: 'POST', json: { refund } });
      toast(`ยกเลิก ${b.code} แล้ว`);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <Modal open={!!b} onClose={onClose} title={`ยกเลิกการจอง ${b?.code ?? ''}`}>
      <p className="text-sm text-ink-soft">ใช้เมื่อลูกค้าแจ้งยกเลิกล่วงหน้า โต๊ะจะว่างให้จองใหม่ทันที</p>
      <fieldset className="mt-4 space-y-2 text-sm">
        {canRefund ? (
          <label className="flex items-center gap-2"><input type="radio" className="accent-[#0e6b43]" checked={refund} onChange={() => setRefund(true)} /> คืนมัดจำ {b?.depositAmount} บาท (บันทึกเป็นรายการคืนเงิน)</label>
        ) : (
          <p className="text-ink-soft">การคืนมัดจำต้องให้เจ้าของร้านทำ ถ้าลูกค้าต้องได้เงินคืน ให้แจ้งเจ้าของร้านแทนการยกเลิกเอง</p>
        )}
        <label className="flex items-center gap-2"><input type="radio" className="accent-[#0e6b43]" checked={!refund} onChange={() => setRefund(false)} /> ไม่คืนมัดจำ</label>
      </fieldset>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>กลับ</Button>
        <Button variant="danger" onClick={go}>ยกเลิกการจอง</Button>
      </div>
    </Modal>
  );
}
