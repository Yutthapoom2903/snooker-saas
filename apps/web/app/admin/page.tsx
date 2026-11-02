'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { baht, thDay, todayLocal } from '@/lib/format';
import { useLive } from '@/lib/live';
import type { Summary } from '@/lib/report';
import { isOwner, useMe } from '@/lib/session';
import type { BoardTable } from '@/lib/types';
import { BarChart, Meter } from '@/components/BarChart';
import { PageHead } from '@/components/ui';

export default function Dashboard() {
  const me = useMe();
  const router = useRouter();
  const [day, setDay] = useState<Summary | null>(null);
  const [week, setWeek] = useState<Summary | null>(null);
  const [month, setMonth] = useState<Summary | null>(null);
  const [last30, setLast30] = useState<Summary | null>(null);
  const [board, setBoard] = useState<BoardTable[] | null>(null);

  useEffect(() => {
    if (!isOwner(me)) router.replace('/admin/floor');
  }, [me, router]);

  const load = useCallback(() => {
    const d = todayLocal();
    api<Summary>(`/reports/summary?period=day&date=${d}`).then(setDay).catch(() => undefined);
    api<Summary>(`/reports/summary?period=week&date=${d}`).then(setWeek).catch(() => undefined);
    api<Summary>(`/reports/summary?period=month&date=${d}`).then(setMonth).catch(() => undefined);
    api<Summary>(`/reports/summary?period=last30&date=${d}`).then(setLast30).catch(() => undefined);
    api<BoardTable[]>('/board').then(setBoard).catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  useLive(['tables', 'bookings'], load, 60000);

  if (!isOwner(me)) return null;
  const playing = board?.filter((t) => t.session).length ?? 0;
  const today = todayLocal();

  return (
    <>
      <PageHead title="ภาพรวมร้าน" sub={day?.label}>
        <Link href="/admin/reports" className="rounded-lg border border-line bg-white px-4 py-2 text-sm hover:border-felt">ออกรายงาน</Link>
      </PageHead>

      <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3" aria-label="รายรับ">
        {[
          { t: 'วันนี้', s: day },
          { t: 'สัปดาห์นี้', s: week },
          { t: 'เดือนนี้', s: month },
        ].map(({ t, s }) => (
          <div key={t} className="bg-white px-5 py-4">
            <p className="text-sm text-ink-soft">รายรับ{t}</p>
            <p className="num mt-1 text-3xl text-baize-deep">{s ? baht(s.total) : '—'}</p>
            <p className="mt-1 text-xs text-ink-mute">
              {s?.changePct == null ? 'ยังไม่มีข้อมูลช่วงก่อนหน้าให้เทียบ' : (
                <>
                  <span className={s.changePct >= 0 ? 'text-baize' : 'text-ball-red'}>{s.changePct >= 0 ? '▲' : '▼'} {Math.abs(s.changePct)}%</span> เทียบช่วงเวลาเดียวกัน{t === 'วันนี้' ? 'ของเมื่อวาน' : t === 'สัปดาห์นี้' ? 'สัปดาห์ก่อน' : 'เดือนก่อน'}
                </>
              )}
            </p>
          </div>
        ))}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-line bg-white p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">รายรับ 30 วันล่าสุด</h2>
            <span className="text-xs text-ink-mute">ชี้ที่แท่งเพื่อดูยอด</span>
          </div>
          {last30 ? (
            <BarChart
              label={`รายรับ 30 วันล่าสุด ${last30.label}`}
              data={last30.series.map((x) => ({ key: x.key, label: x.label, value: x.amount, tip: thDay(x.key) }))}
              format={baht}
              highlight={today}
              height={220}
            />
          ) : <div className="h-[220px]" />}
          {last30 && (
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm sm:grid-cols-4">
              <div><dt className="text-ink-mute">ค่าโต๊ะ</dt><dd className="num text-base">{baht(last30.byType.TABLE)}</dd></div>
              <div><dt className="text-ink-mute">มัดจำ</dt><dd className="num text-base">{baht(last30.byType.DEPOSIT)}</dd></div>
              <div><dt className="text-ink-mute">สมาชิก</dt><dd className="num text-base">{baht(last30.byType.MEMBERSHIP)}</dd></div>
              <div><dt className="text-ink-mute">ส่วนลดที่ให้ไป</dt><dd className="num text-base">{baht(last30.sessions.discount)}</dd></div>
            </dl>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">การใช้งานแต่ละโต๊ะ เดือนนี้</h2>
            <Link href="/admin/floor" className="text-sm text-baize hover:underline">เล่นอยู่ {playing} โต๊ะ</Link>
          </div>
          <ul className="mt-4 space-y-4">
            {month?.perTable.map((t) => {
              const live = board?.find((b) => b.id === t.id)?.session;
              return (
                <li key={t.id}>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span>
                      {t.name}
                      {live && <span className="ml-2 inline-block size-1.5 rounded-full bg-felt align-middle" aria-label="กำลังเล่น" />}
                    </span>
                    <span className="text-ink-mute">
                      <span className="num text-ink">{t.utilization}%</span> ของเวลาเปิดร้าน, {t.sessions} ครั้ง
                    </span>
                  </div>
                  <Meter value={t.utilization} label={`${t.name} ใช้งาน ${t.utilization}%`} />
                </li>
              );
            })}
          </ul>
          {month && (
            <p className="mt-5 border-t border-line pt-4 text-sm text-ink-soft">
              การจองเดือนนี้ <span className="num text-ink">{month.bookings.total}</span> รายการ ไม่มา <span className="num text-ink">{month.bookings.noShow}</span> ยึดมัดจำ <span className="num text-ink">{baht(month.bookings.forfeited)}</span>
            </p>
          )}
        </section>
      </div>
    </>
  );
}
