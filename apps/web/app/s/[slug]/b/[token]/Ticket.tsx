'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { CustomerBooking } from '@/lib/booking';
import { clock, hhmm, thDay } from '@/lib/format';
import { useTick } from '@/lib/live';
import { ShopMark } from '@/components/ui';

/** The customer's ticket. The QR "self-destructs" once the late window passes. */
export function Ticket({ token }: { token: string }) {
  const [b, setB] = useState<CustomerBooking | null>(null);
  const [missing, setMissing] = useState(false);
  useTick(1000);

  useEffect(() => {
    const load = () => api<CustomerBooking>(`/public/bookings/${token}`).then(setB).catch(() => setMissing(true));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [token]);

  if (missing) return <Shell><p className="p-6 text-center">ไม่พบการจองนี้</p></Shell>;
  if (!b) return <Shell><p className="p-6 text-center text-ink-mute">กำลังโหลด</p></Shell>;

  const now = Date.now();
  const start = Date.parse(b.startAt);
  const from = Date.parse(b.checkinFrom);
  const until = Date.parse(b.expiresAt);
  const dead = b.status === 'NO_SHOW' || (b.status === 'CONFIRMED' && now > until);
  const live = b.status === 'CONFIRMED' && !dead;
  const window = now < from ? 'early' : now <= start ? 'open' : 'late';

  return (
    <Shell>
      <div className="flex items-center gap-3 border-b border-dashed border-line px-5 py-4">
        <ShopMark name={b.shop.name} logoUrl={b.shop.logoUrl} size={36} />
        <div className="min-w-0">
          <p className="truncate font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{b.shop.name}</p>
          <p className="text-sm text-ink-soft">{b.name} {b.partySize} คน</p>
        </div>
      </div>

      <div className="px-5 py-5 text-center">
        <div className={`qr-wrap relative mx-auto w-60 ${dead ? 'qr-dead' : ''}`}>
          {b.bookingQr && !dead ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.bookingQr} alt={`QR เช็คอิน ${b.code}`} className="w-full" />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-mist text-sm text-ink-mute">
              {dead ? 'QR หมดอายุ' : b.status === 'CHECKED_IN' ? 'เช็คอินแล้ว' : 'QR จะแสดงเมื่อร้านยืนยัน'}
            </div>
          )}
        </div>
        <p className="num mt-3 text-3xl tracking-[0.12em] text-baize-deep">{b.code}</p>
      </div>

      <dl className="grid grid-cols-3 border-t border-line text-center text-sm">
        <div className="px-2 py-3">
          <dt className="text-ink-mute">วันที่</dt>
          <dd className="font-medium">{thDay(b.startAt)}</dd>
        </div>
        <div className="border-x border-line px-2 py-3">
          <dt className="text-ink-mute">เวลา</dt>
          <dd className="num font-medium">{hhmm(b.startAt)}–{hhmm(b.endAt)}</dd>
        </div>
        <div className="px-2 py-3">
          <dt className="text-ink-mute">โต๊ะ</dt>
          <dd className="font-medium">{b.table}</dd>
        </div>
      </dl>

      <div className={`px-5 py-4 text-center text-sm ${dead ? 'bg-[#f8e3e1] text-ball-red' : window === 'late' && live ? 'bg-[#fbf1dc] text-[#7a560e]' : 'bg-mist text-baize-deep'}`} aria-live="polite">
        {dead && <>QR หมดอายุแล้ว (สายเกิน {b.shop.lateGraceMin} นาที) ร้านไม่คืนมัดจำ</>}
        {live && window === 'early' && <>เช็คอินได้ตั้งแต่ <span className="num">{hhmm(b.checkinFrom)}</span> น.</>}
        {live && window === 'open' && <>แสดง QR นี้ที่เคาน์เตอร์ได้เลย</>}
        {live && window === 'late' && (
          <>
            เลยเวลาแล้ว QR จะหมดอายุใน <span className="num text-base">{clock(until - now)}</span>
          </>
        )}
        {b.status === 'CHECKED_IN' && <>เช็คอินเรียบร้อย ขอให้สนุกกับเกม</>}
        {!live && !dead && b.status !== 'CHECKED_IN' && <>สถานะ: รอร้านยืนยัน</>}
      </div>
      <p className="px-5 pt-3 pb-5 text-center text-xs text-ink-mute">
        มัดจำ {b.depositAmount} บาทหักจากค่าโต๊ะตอนจ่ายเงิน <Link className="underline" href={`/s/${b.shop.slug}`}>หน้าร้าน</Link>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="room flex min-h-dvh items-start justify-center px-4 py-8 sm:items-center">
      <div className="ticket w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_60px_-30px_rgba(10,79,50,0.45)]">{children}</div>
    </div>
  );
}
