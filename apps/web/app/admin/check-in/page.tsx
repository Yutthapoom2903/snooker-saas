'use client';
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { api, ApiError } from '@/lib/api';
import { Button, PageHead } from '@/components/ui';
import { useToast } from '@/components/toast';

interface StartInfo { id: string; code: string; name: string; partySize: number; table: string; tableId: string; tableFree: boolean; started: boolean }
type Result = { ok: true; b: StartInfo } | { ok: false; message: string };
interface FreeTable { id: string; name: string }

/**
 * Front desk check-in. Works three ways: phone/tablet camera, a USB/Bluetooth
 * barcode scanner (types the QR text + Enter into the box), or typing it.
 */
export default function CheckInPage() {
  const [camera, setCamera] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [freeTables, setFreeTables] = useState<FreeTable[]>([]);
  const [moveTo, setMoveTo] = useState('');
  const toast = useToast();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lastText = useRef<{ t: string; at: number }>({ t: '', at: 0 });
  const input = useRef<HTMLInputElement>(null);

  async function submit(text: string) {
    const qr = text.trim();
    if (!qr || busy) return;
    setBusy(true);
    try {
      const r = await api<{ booking: StartInfo }>('/bookings/check-in', { method: 'POST', json: { qr } });
      setResult({ ok: true, b: r.booking });
      setMoveTo('');
      if (!r.booking.tableFree) {
        const board = await api<{ id: string; name: string; session: unknown }[]>('/board');
        setFreeTables(board.filter((t) => !t.session).map((t) => ({ id: t.id, name: t.name })));
      }
      navigator.vibrate?.(60);
    } catch (e) {
      setResult({ ok: false, message: e instanceof ApiError ? e.message : 'เช็คอินไม่สำเร็จ' });
      navigator.vibrate?.([80, 60, 80]);
    } finally {
      setBusy(false);
      setManual('');
      input.current?.focus();
    }
  }

  async function start() {
    if (!result?.ok) return;
    const tableId = result.b.tableFree ? undefined : moveTo;
    if (!result.b.tableFree && !tableId) return;
    setStarting(true);
    try {
      await api(`/bookings/${result.b.id}/start`, { method: 'POST', json: { tableId } });
      const tableName = tableId ? freeTables.find((t) => t.id === tableId)?.name : result.b.table;
      toast(`เริ่มจับเวลา${tableName}แล้ว`);
      setResult({ ok: true, b: { ...result.b, started: true, table: tableName ?? result.b.table } });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'เริ่มจับเวลาไม่สำเร็จ', 'error');
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (stopped) return;
          const c = canvas.current!;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            // Ignore the same code for 4 s so one QR in view doesn't fire repeatedly.
            if (code?.data && (code.data !== lastText.current.t || Date.now() - lastText.current.at > 4000)) {
              lastText.current = { t: code.data, at: Date.now() };
              submit(code.data);
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setCamErr(
          (e as Error).message === 'insecure'
            ? 'เบราว์เซอร์อนุญาตกล้องเฉพาะ https หรือ localhost ใช้เครื่องสแกนบาร์โค้ดหรือพิมพ์รหัสแทนได้'
            : 'เปิดกล้องไม่ได้ ตรวจสอบสิทธิ์การใช้กล้องของเบราว์เซอร์',
        );
        setCamera(false);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  return (
    <>
      <PageHead title="สแกน QR เช็คอิน" sub="สแกนแล้วลูกค้าจะถูกบันทึกว่ามาถึง (ไม่ถูกยึดมัดจำ) จากนั้นกดเริ่มจับเวลาเมื่อพร้อมเล่น" />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5">
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-baize-deep">
            <video ref={video} className={`h-full w-full object-cover ${camera ? '' : 'hidden'}`} muted playsInline />
            <canvas ref={canvas} className="hidden" />
            {camera ? (
              <div className="scan-frame pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80" aria-hidden />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/85">
                <p>ใช้กล้องของเครื่องนี้สแกน QR จากมือถือลูกค้า</p>
                <Button variant="outline" onClick={() => { setCamErr(null); setCamera(true); }}>เปิดกล้อง</Button>
              </div>
            )}
          </div>
          {camera && <Button variant="quiet" className="mt-3" onClick={() => setCamera(false)}>ปิดกล้อง</Button>}
          {camErr && <p className="mt-3 text-sm text-ball-red">{camErr}</p>}

          <form className="mt-5" onSubmit={(e) => { e.preventDefault(); submit(manual); }}>
            <label className="label" htmlFor="qr-text">เครื่องสแกนหรือพิมพ์ข้อความใน QR</label>
            <div className="flex gap-2">
              <input id="qr-text" ref={input} className="field num" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="SNK1.…" autoComplete="off" autoFocus />
              <Button type="submit" busy={busy}>เช็คอิน</Button>
            </div>
          </form>
        </section>

        <section aria-live="assertive" className="flex min-h-[260px] items-center justify-center rounded-2xl border border-line bg-white p-6 text-center">
          {!result ? (
            <p className="text-ink-mute">ผลการสแกนจะแสดงที่นี่</p>
          ) : result.ok ? (
            <div key={result.b.code} className="result-in w-full max-w-sm">
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-felt text-white">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12.5l4.5 4.5L19 7.5" className="check-draw" /></svg>
              </div>
              <p className="mt-4 text-xl font-semibold text-baize-deep">{result.b.started ? `เริ่มจับเวลา${result.b.table}แล้ว` : 'เช็คอินแล้ว'}</p>
              <p className="mt-1 text-ink-soft">{result.b.name} {result.b.partySize} คน <span className="num">({result.b.code})</span></p>
              {!result.b.started && (
                result.b.tableFree ? (
                  <Button size="lg" className="mt-5 w-full" busy={starting} onClick={start}>เริ่มจับเวลา{result.b.table}</Button>
                ) : (
                  <div className="mt-5 text-left">
                    <p className="rounded-lg bg-[#fbf1dc] px-3 py-2 text-sm text-[#7a560e]">{result.b.table} ยังมีคนเล่นอยู่ เลือกโต๊ะว่างให้ลูกค้า หรือรอให้โต๊ะเดิมว่างแล้วเริ่มจากหน้า โต๊ะในร้าน</p>
                    <label className="mt-3 block">
                      <span className="label">ย้ายไปโต๊ะ</span>
                      <select className="field" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                        <option value="">{freeTables.length ? 'เลือกโต๊ะว่าง' : 'ตอนนี้ไม่มีโต๊ะว่าง'}</option>
                        {freeTables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                    <Button size="lg" className="mt-3 w-full" busy={starting} disabled={!moveTo} onClick={start}>เริ่มจับเวลาที่โต๊ะที่เลือก</Button>
                  </div>
                )
              )}
            </div>
          ) : (
            <div key={result.message} className="result-in">
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-ball-red text-white">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 7l10 10M17 7L7 17" /></svg>
              </div>
              <p className="mt-4 text-lg font-semibold text-ball-red">{result.message}</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
