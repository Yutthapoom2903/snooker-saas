'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { CustomerBooking } from '@/lib/booking';
import { hhmm, thDay } from '@/lib/format';
import { Button, ShopMark } from '@/components/ui';

type Phase = 'loading' | 'linking' | 'ready' | 'error';

/**
 * Opened inside LINE (LIFF) right after the web form. Logs the customer in with
 * LINE (no typing), then takes the deposit slip. In mock mode it runs in any browser.
 */
export function LiffFlow() {
  const params = useSearchParams();
  const token = params.get('b') ?? '';
  const [phase, setPhase] = useState<Phase>('loading');
  const [b, setB] = useState<CustomerBooking | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const v = await api<CustomerBooking>(`/public/bookings/${token}`);
    setB(v);
    return v;
  }, [token]);

  useEffect(() => {
    if (!token) {
      setErr('ลิงก์ไม่ครบ กรุณาจองใหม่จากหน้าเว็บร้าน');
      setPhase('error');
      return;
    }
    (async () => {
      try {
        const v = await load();
        if (v.lineLinked) return setPhase('ready');
        setPhase('linking');
        let body: { idToken?: string; mock?: boolean } = { mock: true };
        if (v.shop.live && v.shop.liffId) {
          const liff = (await import('@line/liff')).default;
          await liff.init({ liffId: v.shop.liffId });
          if (!liff.isLoggedIn()) {
            liff.login({ redirectUri: location.href });
            return;
          }
          body = { idToken: liff.getIDToken() ?? undefined };
        } else {
          await new Promise((r) => setTimeout(r, 700)); // let the mock step be seen
        }
        setB(await api<CustomerBooking>(`/public/bookings/${token}/link-line`, { method: 'POST', json: body }));
        setPhase('ready');
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : 'เชื่อมต่อ LINE ไม่สำเร็จ');
        setPhase('error');
      }
    })();
  }, [token, load]);

  // Waiting for the shop: poll until confirmed/rejected.
  useEffect(() => {
    if (b?.status !== 'DEPOSIT_SUBMITTED') return;
    const t = setInterval(() => load().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, [b?.status, load]);

  async function upload(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setB(await api<CustomerBooking>(`/public/bookings/${token}/slip`, { method: 'POST', body: fd }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'อัปโหลดสลิปไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  const step = !b ? 1 : b.status === 'PENDING_DEPOSIT' ? 2 : b.status === 'DEPOSIT_SUBMITTED' ? 3 : b.status === 'CONFIRMED' ? 4 : 2;

  return (
    <div className="room min-h-dvh px-4 py-6">
      <div className="mx-auto max-w-md">
        {b && (
          <div className="mb-5 flex items-center gap-3">
            <ShopMark name={b.shop.name} logoUrl={b.shop.logoUrl} size={36} />
            <p className="font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{b.shop.name}</p>
          </div>
        )}

        {(phase === 'loading' || phase === 'linking') && (
          <div className="rounded-2xl border border-line bg-white p-6 text-center">
            <span className="mx-auto block size-8 animate-spin rounded-full border-[3px] border-felt border-r-transparent" aria-hidden />
            <p className="mt-4 font-medium">{phase === 'linking' ? 'กำลังยืนยันตัวตนกับ LINE' : 'กำลังโหลดการจอง'}</p>
            {b && !b.shop.live && <p className="mt-1 text-sm text-ink-mute">โหมดทดลอง: จำลองการล็อกอิน LINE</p>}
          </div>
        )}

        {phase === 'error' && (
          <div role="alert" className="rounded-2xl border border-ball-red/30 bg-white p-6">
            <p className="font-medium text-ball-red">{err}</p>
            {b && <Link href={`/s/${b.shop.slug}`} className="mt-3 inline-block text-sm text-baize underline">กลับไปหน้าจอง</Link>}
          </div>
        )}

        {phase === 'ready' && b && (
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <div className="bg-baize px-5 py-4 text-white">
              <p className="text-sm text-white/75">รหัสการจอง</p>
              <p className="num text-2xl tracking-wider">{b.code}</p>
              <p className="mt-1 text-sm text-white/90">
                {thDay(b.startAt)} <span className="num">{hhmm(b.startAt)}–{hhmm(b.endAt)}</span> น. {b.table}
              </p>
            </div>
            <ol className="flex border-b border-line text-xs">
              {['LINE', 'มัดจำ', 'ร้านยืนยัน', 'QR'].map((s, i) => (
                <li key={s} className={`flex-1 py-2 text-center ${i + 1 < step ? 'text-baize' : i + 1 === step ? 'bg-mist font-medium text-baize-deep' : 'text-ink-mute'}`}>
                  {i + 1 < step ? '✓ ' : ''}{s}
                </li>
              ))}
            </ol>

            <div className="p-5">
              {b.status === 'PENDING_DEPOSIT' && (
                <>
                  <h1 className="text-lg font-semibold">โอนมัดจำ {b.depositAmount} บาท</h1>
                  <p className="mt-1 text-sm text-ink-soft">สแกนด้วยแอปธนาคาร แล้วแนบสลิปด้านล่าง ร้านจะยืนยันและส่ง QR ให้ทาง LINE</p>
                  {b.promptpayQr ? (
                    <figure className="mx-auto mt-4 w-56">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.promptpayQr} alt={`QR พร้อมเพย์ ${b.depositAmount} บาท`} className="w-full rounded-lg border border-line" />
                      <figcaption className="num mt-1 text-center text-xs text-ink-mute">พร้อมเพย์ {b.promptpayId}</figcaption>
                    </figure>
                  ) : (
                    <p className="mt-4 rounded-lg bg-mist p-3 text-sm">ร้านยังไม่ได้ตั้งค่าพร้อมเพย์ กรุณาติดต่อร้าน{b.shop.phone ? ` ${b.shop.phone}` : ''}</p>
                  )}
                  <p className="mt-4 rounded-lg bg-[#fbf1dc] px-3 py-2 text-sm text-[#7a560e]">
                    หากไม่มาหรือมาสายเกิน {b.shop.lateGraceMin} นาที ร้านขอสงวนสิทธิ์ไม่คืนมัดจำ
                  </p>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  <Button size="lg" className="mt-4 w-full" busy={uploading} onClick={() => fileRef.current?.click()}>
                    แนบสลิปการโอน
                  </Button>
                </>
              )}

              {b.status === 'DEPOSIT_SUBMITTED' && b.slipCheck?.verdict === 'fail' && (
                <div className="mb-4 rounded-lg bg-[#f8e3e1] px-3 py-2 text-sm text-ball-red" role="alert">
                  <p className="font-medium">สลิปไม่ผ่านการตรวจกับธนาคาร</p>
                  <ul className="mt-1 list-disc pl-5">{b.slipCheck.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  <p className="mt-1">ถ้าแนบผิดรูป แนบสลิปที่ถูกต้องได้อีกครั้ง หรือรอร้านตรวจ</p>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  <Button variant="outline" className="mt-2" busy={uploading} onClick={() => fileRef.current?.click()}>แนบสลิปใหม่</Button>
                </div>
              )}
              {b.status === 'DEPOSIT_SUBMITTED' && (
                <div className="py-2 text-center">
                  <span className="wait-dot mx-auto block size-3 rounded-full bg-ball-yellow" aria-hidden />
                  <h1 className="mt-3 text-lg font-semibold">ส่งสลิปแล้ว รอร้านยืนยัน</h1>
                  <p className="mt-1 text-sm text-ink-soft">ปิดหน้านี้ได้เลย เมื่อร้านยืนยัน QR การจองจะส่งไปที่แชท LINE ของคุณ</p>
                </div>
              )}

              {b.status === 'CONFIRMED' && (
                <div className="text-center">
                  <h1 className="text-lg font-semibold text-baize">ยืนยันการจองแล้ว</h1>
                  <Link href={`/s/${b.shop.slug}/b/${token}`} className="mt-3 inline-flex rounded-lg bg-baize px-5 py-2.5 font-medium text-white">
                    เปิด QR การจอง
                  </Link>
                </div>
              )}

              {['REJECTED', 'EXPIRED', 'CANCELLED', 'NO_SHOW', 'CHECKED_IN'].includes(b.status) && (
                <div>
                  <h1 className="text-lg font-semibold">
                    {b.status === 'REJECTED' ? 'ร้านไม่ได้ยืนยันการจองนี้' : b.status === 'EXPIRED' ? 'การจองนี้หมดเวลาแล้ว' : b.status === 'CHECKED_IN' ? 'เช็คอินแล้ว ขอให้สนุกกับเกม' : b.status === 'NO_SHOW' ? 'QR หมดอายุแล้ว' : 'การจองถูกยกเลิก'}
                  </h1>
                  {b.rejectReason && <p className="mt-1 text-sm text-ink-soft">เหตุผล: {b.rejectReason}</p>}
                  <Link href={`/s/${b.shop.slug}`} className="mt-3 inline-block text-sm text-baize underline">จองใหม่</Link>
                </div>
              )}
              {err && <p role="alert" className="mt-3 text-sm text-ball-red">{err}</p>}
            </div>
          </div>
        )}
        {b && !b.shop.live && phase === 'ready' && (
          <p className="mt-4 text-center text-xs text-ink-mute">โหมดทดลอง: ข้อความ LINE ทั้งหมดดูได้ที่ หลังร้าน → กล่อง LINE</p>
        )}
      </div>
    </div>
  );
}
