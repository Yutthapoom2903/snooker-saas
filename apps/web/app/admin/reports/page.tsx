'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, getActingShop } from '@/lib/api';
import { baht, METHOD, thDateTime, todayLocal } from '@/lib/format';
import { Summary, TYPE_LABEL } from '@/lib/report';
import { BarChart } from '@/components/BarChart';
import { Button, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';

type Period = 'day' | 'week' | 'month';
const PERIODS: { k: Period; t: string }[] = [
  { k: 'day', t: 'รายวัน' },
  { k: 'week', t: 'รายสัปดาห์' },
  { k: 'month', t: 'รายเดือน' },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('day');
  const [date, setDate] = useState(todayLocal());
  const [s, setS] = useState<Summary | null>(null);
  const [pdfBusy, setPdfBusy] = useState<'view' | 'save' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setS(null);
    api<Summary>(`/reports/summary?period=${period}&date=${date}`).then(setS).catch((e) => toast(e.message, 'error'));
  }, [period, date, toast]);

  // Fetch as a blob so the x-shop-id header (platform admin) travels with it.
  const pdf = useCallback(
    async (mode: 'view' | 'save') => {
      setPdfBusy(mode);
      const tab = mode === 'view' ? window.open('', '_blank') : null;
      try {
        const res = await fetch(`/api/reports/pdf?period=${period}&date=${date}`, { headers: getActingShop() ? { 'x-shop-id': getActingShop()! } : {} });
        if (!res.ok) throw new Error('สร้าง PDF ไม่สำเร็จ');
        const url = URL.createObjectURL(await res.blob());
        if (tab) tab.location.href = url;
        else {
          const a = document.createElement('a');
          a.href = url;
          a.download = `report-${period}-${date}.pdf`;
          a.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) {
        tab?.close();
        toast((e as Error).message, 'error');
      } finally {
        setPdfBusy(null);
      }
    },
    [period, date, toast],
  );

  const payments = showAll ? s?.payments : s?.payments.slice(-15);

  return (
    <>
      <PageHead title="รายงานรายรับ" sub={s?.label}>
        <Button variant="outline" onClick={() => pdf('view')} busy={pdfBusy === 'view'}>เปิด PDF</Button>
        <Button onClick={() => pdf('save')} busy={pdfBusy === 'save'}>ดาวน์โหลด PDF</Button>
      </PageHead>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-line bg-white" role="tablist" aria-label="ช่วงเวลา">
          {PERIODS.map((p) => (
            <button key={p.k} role="tab" aria-selected={period === p.k} onClick={() => setPeriod(p.k)} className={`px-4 py-2 text-sm transition-colors ${period === p.k ? 'bg-baize text-white' : 'hover:bg-mist'}`}>
              {p.t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          {period === 'day' ? 'วันที่' : period === 'week' ? 'สัปดาห์ที่มีวันที่' : 'เดือนที่มีวันที่'}
          <input type="date" className="field w-auto py-1.5" value={date} max={todayLocal()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>

      {!s ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : (
        <div className="space-y-6">
          <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
            <Stat t="รายรับสุทธิ" v={baht(s.total)} sub={s.changePct == null ? 'ไม่มีข้อมูลช่วงก่อนให้เทียบ' : `${s.changePct >= 0 ? '+' : ''}${s.changePct}% จากช่วงก่อน (${baht(s.previousTotal)})`} big />
            <Stat t="เปิดโต๊ะ" v={`${s.sessions.count} ครั้ง`} sub={`รวม ${(s.sessions.minutes / 60).toFixed(1)} ชั่วโมง`} />
            <Stat t="การจอง" v={`${s.bookings.total} รายการ`} sub={`มา ${s.bookings.checkedIn}, ไม่มา ${s.bookings.noShow}, ยกเลิก ${s.bookings.cancelled}`} />
            <Stat t="มัดจำที่ยึด" v={baht(s.bookings.forfeited)} sub="จากลูกค้าที่ไม่มาหรือสายเกินกำหนด" />
          </section>

          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-semibold">{period === 'day' ? 'รายรับรายชั่วโมง' : 'รายรับรายวัน'}</h2>
            <BarChart label={`รายรับ ${s.label}`} data={s.series.map((x) => ({ key: x.key, label: x.label, value: x.amount }))} format={baht} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-line bg-white">
              <h2 className="px-5 pt-4 font-semibold">สรุปตามประเภทและช่องทาง</h2>
              <table className="data-table mt-2">
                <thead><tr><th>ประเภท</th><th className="text-right">จำนวนเงิน</th></tr></thead>
                <tbody>
                  {Object.entries(s.byType).filter(([, v]) => v !== 0).map(([k, v]) => (
                    <tr key={k}><td>{TYPE_LABEL[k]}</td><td className="num text-right">{baht(v)}</td></tr>
                  ))}
                  {Object.entries(s.byMethod).map(([k, v]) => (
                    <tr key={k} className="text-ink-soft"><td className="pl-6">ชำระด้วย{METHOD[k] ?? k}</td><td className="num text-right">{baht(v)}</td></tr>
                  ))}
                  <tr><td className="font-medium">รวม</td><td className="num text-right font-medium">{baht(s.total)}</td></tr>
                </tbody>
              </table>
            </section>
            <section className="rounded-2xl border border-line bg-white">
              <h2 className="px-5 pt-4 font-semibold">แต่ละโต๊ะ</h2>
              <div className="overflow-x-auto">
                <table className="data-table mt-2">
                  <thead><tr><th>โต๊ะ</th><th className="text-right">ครั้ง</th><th className="text-right">ชั่วโมง</th><th className="text-right">ใช้งาน</th><th className="text-right">ค่าโต๊ะ</th></tr></thead>
                  <tbody>
                    {s.perTable.map((t) => (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td className="num text-right">{t.sessions}</td>
                        <td className="num text-right">{(t.minutes / 60).toFixed(1)}</td>
                        <td className="num text-right">{t.utilization}%</td>
                        <td className="num text-right">{baht(t.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-line bg-white">
            <div className="flex items-baseline justify-between px-5 pt-4">
              <h2 className="font-semibold">รายการรับเงิน ({s.payments.length})</h2>
              {s.payments.length > 15 && (
                <button className="text-sm text-baize hover:underline" onClick={() => setShowAll((v) => !v)}>{showAll ? 'แสดงล่าสุด 15 รายการ' : 'แสดงทั้งหมด'}</button>
              )}
            </div>
            {s.payments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-mute">ช่วงนี้ยังไม่มีรายการรับเงิน</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table mt-2">
                  <thead><tr><th>เวลา</th><th>ประเภท</th><th>ช่องทาง</th><th>หมายเหตุ</th><th className="text-right">จำนวน</th></tr></thead>
                  <tbody>
                    {[...(payments ?? [])].reverse().map((p) => (
                      <tr key={p.id}>
                        <td className="num whitespace-nowrap">{thDateTime(p.at)}</td>
                        <td>{TYPE_LABEL[p.type]}</td>
                        <td>{METHOD[p.method]}</td>
                        <td className="text-ink-soft">{p.note}</td>
                        <td className={`num text-right ${p.amount < 0 ? 'text-ball-red' : ''}`}>{baht(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Stat({ t, v, sub, big }: { t: string; v: string; sub: string; big?: boolean }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-sm text-ink-soft">{t}</p>
      <p className={`num mt-1 ${big ? 'text-3xl text-baize-deep' : 'text-2xl'}`}>{v}</p>
      <p className="mt-1 text-xs text-ink-mute">{sub}</p>
    </div>
  );
}
