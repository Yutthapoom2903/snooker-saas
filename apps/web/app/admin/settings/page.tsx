'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { minutesText } from '@/lib/format';
import { isOwner, useMe } from '@/lib/session';
import { useToast } from '@/components/toast';
import { Badge, Button, Empty, Field, PageHead, ShopMark } from '@/components/ui';

interface Shop {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  openTime: string;
  closeTime: string;
  open24h: boolean;
  bookingHorizonDays: number;
  closedWeekdays: string;
  closedDates: string;
  promptpayId: string | null;
  depositAmount: number;
  lateGraceMin: number;
  earlyCheckinMin: number;
  roundingMin: number;
  minimumMin: number;
  lineChannelId: string | null;
  lineLoginChannelId: string | null;
  lineLiffId: string | null;
  lineOaBasicId: string | null;
  lineAdminTargetId: string | null;
  lineOwnerTargetId: string | null;
  slipProvider: 'none' | 'easyslip' | 'slipok';
  slipApiKeySet: boolean;
  slipOkBranchId: string | null;
  slipReceiverAccounts: string;
  lineLastSeenGroupId: string | null;
  lineChannelSecretSet: boolean;
  lineAccessTokenSet: boolean;
  lineLive: boolean;
  webhookPath: string;
}

const TEXT_KEYS = ['name', 'phone', 'address', 'openTime', 'closeTime', 'promptpayId', 'lineChannelId', 'lineLoginChannelId', 'lineLiffId', 'lineOaBasicId', 'lineAdminTargetId', 'lineOwnerTargetId', 'slipProvider', 'slipOkBranchId', 'slipReceiverAccounts'] as const;
const NUM_KEYS = ['depositAmount', 'lateGraceMin', 'earlyCheckinMin', 'roundingMin', 'minimumMin', 'bookingHorizonDays'] as const;
const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
const splitList = (v: string) => v.split(',').filter(Boolean);
type TextKey = (typeof TEXT_KEYS)[number];
type NumKey = (typeof NUM_KEYS)[number];
type Form = Record<TextKey | NumKey, string>;

/** Secret field: keep (untouched), replace with a new value, or clear. */
type Secret = { mode: 'keep' | 'set' | 'clear'; value: string };

const MAX_LOGO = 5 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const EXAMPLE_PLAYED = 37;

function toForm(s: Shop): Form {
  const f = {} as Form;
  for (const k of TEXT_KEYS) f[k] = s[k] ?? '';
  for (const k of NUM_KEYS) f[k] = String(s[k]);
  return f;
}

function billed(played: number, rounding: number, minimum: number) {
  const step = Math.max(1, rounding || 1);
  return Math.max(minimum || 0, Math.ceil(played / step) * step);
}

function Section({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <div className="mt-0.5 text-sm text-ink-soft">{sub}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SecretInput({ label, isSet, state, onChange, disabled }: { label: string; isSet: boolean; state: Secret; onChange: (s: Secret) => void; disabled: boolean }) {
  const id = label.replace(/\s/g, '-');
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="label">{label}</label>
        {state.mode === 'clear' ? <Badge tone="red">จะลบเมื่อบันทึก</Badge> : isSet ? <Badge tone="green">ตั้งค่าแล้ว</Badge> : <Badge>ยังไม่ได้ตั้ง</Badge>}
      </div>
      <div className="flex gap-2">
        <input
          id={id}
          className="field num"
          type="password"
          autoComplete="off"
          disabled={disabled || state.mode === 'clear'}
          placeholder={isSet ? 'ใส่ค่าใหม่เพื่อแทนที่ค่าเดิม' : 'วางค่าจาก LINE Developers'}
          value={state.value}
          onChange={(e) => onChange({ mode: e.target.value ? 'set' : 'keep', value: e.target.value })}
        />
        {isSet && (
          state.mode === 'clear' ? (
            <Button type="button" variant="outline" className="shrink-0" onClick={() => onChange({ mode: 'keep', value: '' })} disabled={disabled}>ยกเลิกการลบ</Button>
          ) : (
            <Button type="button" variant="danger" className="shrink-0" onClick={() => onChange({ mode: 'clear', value: '' })} disabled={disabled}>ลบค่า</Button>
          )
        )}
      </div>
    </div>
  );
}

function CopyLine({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2">
      <code className="num min-w-0 flex-1 rounded-lg bg-mist px-3 py-2 text-sm break-all text-ink">{value}</code>
      <Button
        type="button"
        variant="outline"
        className="shrink-0"
        aria-label={`คัดลอก${label}`}
        onClick={() =>
          navigator.clipboard.writeText(value).then(
            () => toast(`คัดลอก${label}แล้ว`),
            () => toast('คัดลอกไม่ได้ ให้เลือกข้อความแล้วคัดลอกเอง', 'error'),
          )
        }
      >
        คัดลอก
      </Button>
    </div>
  );
}

export default function SettingsPage() {
  const me = useMe();
  const owner = isOwner(me);
  const toast = useToast();
  const [shop, setShop] = useState<Shop | null>(null);
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [secret, setSecret] = useState<Secret>({ mode: 'keep', value: '' });
  const [token, setToken] = useState<Secret>({ mode: 'keep', value: '' });
  const [slipKey, setSlipKey] = useState<Secret>({ mode: 'keep', value: '' });
  const [publicUrl, setPublicUrl] = useState('');
  const [busy, setBusy] = useState<'save' | 'logo' | 'logo-rm' | null>(null);
  const [open24h, setOpen24h] = useState(false);
  const [closedDays, setClosedDays] = useState<string[]>([]);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((s: Shop) => {
    setShop(s);
    setForm(toForm(s));
    setOpen24h(s.open24h);
    setClosedDays(splitList(s.closedWeekdays));
    setHolidays(splitList(s.closedDates));
    setSecret({ mode: 'keep', value: '' });
    setToken({ mode: 'keep', value: '' });
    setSlipKey({ mode: 'keep', value: '' });
  }, []);

  useEffect(() => {
    api<Shop>('/shop')
      .then(apply)
      .catch((e: ApiError) => (e.status === 403 ? setDenied(true) : toast(e.message, 'error')));
    try {
      setPublicUrl(localStorage.getItem('cue.publicUrl') || window.location.origin);
    } catch {
      setPublicUrl(window.location.origin);
    }
  }, [apply, toast]);

  function updatePublicUrl(v: string) {
    setPublicUrl(v);
    try {
      localStorage.setItem('cue.publicUrl', v);
    } catch {
      /* per-browser convenience only */
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy('save');
    const body: Record<string, unknown> = {};
    for (const k of TEXT_KEYS) body[k] = form[k].trim();
    for (const k of NUM_KEYS) body[k] = Number(form[k]);
    body.open24h = open24h;
    body.closedWeekdays = closedDays.join(',');
    body.closedDates = holidays.join(',');
    if (secret.mode !== 'keep') body.lineChannelSecret = secret.mode === 'clear' ? '' : secret.value;
    if (token.mode !== 'keep') body.lineAccessToken = token.mode === 'clear' ? '' : token.value;
    if (slipKey.mode !== 'keep') body.slipApiKey = slipKey.mode === 'clear' ? '' : slipKey.value;
    try {
      apply(await api<Shop>('/shop', { method: 'PATCH', json: body }));
      toast('บันทึกแล้ว');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function uploadLogo(file: File) {
    if (!LOGO_TYPES.includes(file.type)) return toast('รองรับเฉพาะ PNG, JPG, WEBP', 'error');
    if (file.size > MAX_LOGO) return toast('ไฟล์ใหญ่เกิน 5MB', 'error');
    setBusy('logo');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const s = await api<Shop>('/shop/logo', { method: 'POST', body: fd });
      setShop((x) => (x ? { ...x, logoUrl: s.logoUrl } : s));
      toast('อัปโหลดโลโก้แล้ว');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    setBusy('logo-rm');
    try {
      await api<Shop>('/shop/logo', { method: 'DELETE' });
      setShop((x) => (x ? { ...x, logoUrl: null } : x));
      toast('ลบโลโก้แล้ว');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (denied) return <Empty title="ไม่มีสิทธิ์ใช้งานส่วนนี้">เฉพาะเจ้าของร้านแก้ตั้งค่าร้านได้</Empty>;
  if (!shop || !form) return <p className="text-ink-mute">กำลังโหลด</p>;

  const set = (k: TextKey | NumKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const ro = !owner;
  const base = publicUrl.replace(/\/+$/, '');
  const webhook = `${base}${shop.webhookPath}`;
  const liffEndpoint = `${base}/s/${shop.slug}/liff`;
  const isLocal = /localhost|127\.0\.0\.1|^https?:\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(base);
  const overnight = !open24h && form.closeTime && form.openTime && form.closeTime <= form.openTime;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const upcomingHolidays = holidays.filter((d) => d >= today);
  const thDateLong = (d: string) => new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const exBilled = billed(EXAMPLE_PLAYED, Number(form.roundingMin), Number(form.minimumMin));
  const exShort = billed(10, Number(form.roundingMin), Number(form.minimumMin));

  return (
    <form onSubmit={save} className="max-w-3xl space-y-5">
      <PageHead title="ตั้งค่าร้าน" sub={owner ? undefined : 'ดูได้อย่างเดียว เฉพาะเจ้าของร้านแก้ไขได้'} />

      <Section title="ข้อมูลร้าน">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ชื่อร้าน" className="sm:col-span-2">
            <input className="field" required disabled={ro} value={form.name} onChange={set('name')} />
          </Field>
          <Field label="เบอร์โทรร้าน">
            <input className="field num" type="tel" inputMode="tel" disabled={ro} value={form.phone} onChange={set('phone')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="เปิด">
              <input className="field num" type="time" required={!open24h} disabled={ro || open24h} value={open24h ? '00:00' : form.openTime} onChange={set('openTime')} />
            </Field>
            <Field label="ปิด">
              <input className="field num" type="time" required={!open24h} disabled={ro || open24h} value={open24h ? '00:00' : form.closeTime} onChange={set('closeTime')} />
            </Field>
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 sm:-mt-1">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[#0e6b43]" checked={open24h} disabled={ro} onChange={(e) => setOpen24h(e.target.checked)} />
              เปิด 24 ชั่วโมง
            </label>
            {open24h ? (
              <p className="text-xs text-ink-mute">ลูกค้าจองได้ทุกเวลา และเล่นข้ามเที่ยงคืนได้</p>
            ) : overnight ? (
              <p className="text-xs text-ink-mute">ปิดหลังเที่ยงคืน คือปิด <span className="num">{form.closeTime}</span> ของวันถัดไป</p>
            ) : null}
          </div>
          <Field label="ที่อยู่" className="sm:col-span-2">
            <textarea className="field" rows={2} disabled={ro} value={form.address} onChange={set('address')} />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-line pt-5">
          <ShopMark name={form.name || shop.name} logoUrl={shop.logoUrl} size={64} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">โลโก้ร้าน</p>
            <p className="text-xs text-ink-mute">PNG, JPG หรือ WEBP ไม่เกิน 5MB ภาพสี่เหลี่ยมจัตุรัสจะดูดีที่สุด</p>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} id="logo-file" type="file" accept={LOGO_TYPES.join(',')} className="sr-only" disabled={ro} onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
            <Button type="button" variant="outline" busy={busy === 'logo'} disabled={ro} onClick={() => fileRef.current?.click()}>
              {shop.logoUrl ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'}
            </Button>
            {shop.logoUrl && <Button type="button" variant="quiet" busy={busy === 'logo-rm'} disabled={ro} onClick={removeLogo}>ลบโลโก้</Button>}
          </div>
        </div>
      </Section>

      <Section title="การจอง">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="มัดจำ (บาท)" hint="0 = ไม่เก็บมัดจำ">
            <input className="field num" type="number" inputMode="numeric" min={0} max={1000} step={1} required disabled={ro} value={form.depositAmount} onChange={set('depositAmount')} />
          </Field>
          <Field label="เช็คอินก่อนเวลาได้ (นาที)">
            <input className="field num" type="number" inputMode="numeric" min={0} max={1000} step={1} required disabled={ro} value={form.earlyCheckinMin} onChange={set('earlyCheckinMin')} />
          </Field>
          <Field label="มาสายได้ไม่เกิน (นาที)" hint="เลยจากนี้ QR ใช้ไม่ได้ และยึดมัดจำ">
            <input className="field num" type="number" inputMode="numeric" min={0} max={1000} step={1} required disabled={ro} value={form.lateGraceMin} onChange={set('lateGraceMin')} />
          </Field>
          <Field label="เลขพร้อมเพย์ของร้าน" hint="เบอร์มือถือหรือเลขบัตรประชาชน ใช้กับ QR มัดจำและ QR ตอนปิดโต๊ะ" className="sm:col-span-3">
            <input className="field num" inputMode="numeric" disabled={ro} value={form.promptpayId} onChange={set('promptpayId')} />
          </Field>
        </div>

        <div className="mt-5 grid gap-5 border-t border-line pt-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <Field label="จองล่วงหน้าได้ (วัน)" hint="0 = จองได้เฉพาะวันนี้ สูงสุด 60">
            <input className="field num" type="number" inputMode="numeric" min={0} max={60} step={1} required disabled={ro} value={form.bookingHorizonDays} onChange={set('bookingHorizonDays')} />
          </Field>
          <fieldset>
            <legend className="label">หยุดประจำทุกสัปดาห์</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w, i) => {
                const on = closedDays.includes(String(i));
                return (
                  <button
                    key={w}
                    type="button"
                    disabled={ro}
                    aria-pressed={on}
                    onClick={() => setClosedDays((d) => (on ? d.filter((x) => x !== String(i)) : [...d, String(i)].sort()))}
                    className={`press min-h-9 rounded-lg border px-3 text-sm transition-colors ${on ? 'border-ball-red/40 bg-[#f8e3e1] text-ball-red' : 'border-line bg-white hover:border-felt'}`}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-ink-mute">{closedDays.length ? `ปิดทุกวัน${closedDays.map((d) => WEEKDAYS[+d]).join(', ')}` : 'เปิดทุกวัน'}</p>
          </fieldset>
        </div>

        <fieldset className="mt-5 border-t border-line pt-5">
          <legend className="label">วันหยุดพิเศษ</legend>
          <div className="flex flex-wrap gap-2">
            <input className="field num w-auto" type="date" min={today} disabled={ro} value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label="วันที่หยุด" />
            <Button
              type="button"
              variant="outline"
              disabled={ro || !newHoliday || holidays.includes(newHoliday)}
              onClick={() => {
                setHolidays((h) => [...h, newHoliday].sort());
                setNewHoliday('');
              }}
            >
              เพิ่มวันหยุด
            </Button>
          </div>
          {upcomingHolidays.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {upcomingHolidays.map((d) => (
                <li key={d} className="inline-flex items-center gap-1 rounded-full bg-mist py-1 pr-1 pl-3 text-sm">
                  {thDateLong(d)}
                  <button type="button" disabled={ro} onClick={() => setHolidays((h) => h.filter((x) => x !== d))} className="rounded-full p-1 text-ink-mute hover:bg-white hover:text-ball-red" aria-label={`ลบวันหยุด ${thDateLong(d)}`}>
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l10 10M15 5L5 15" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-mute">ยังไม่มีวันหยุดพิเศษ วันที่เพิ่มจะจองไม่ได้ในหน้าลูกค้า</p>
          )}
        </fieldset>
      </Section>

      <Section title="การคิดเงินค่าโต๊ะ">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ปัดเวลาขึ้นทีละ (นาที)">
            <input className="field num" type="number" inputMode="numeric" min={1} max={1000} step={1} required disabled={ro} value={form.roundingMin} onChange={set('roundingMin')} />
          </Field>
          <Field label="คิดขั้นต่ำ (นาที)">
            <input className="field num" type="number" inputMode="numeric" min={0} max={1000} step={1} required disabled={ro} value={form.minimumMin} onChange={set('minimumMin')} />
          </Field>
        </div>
        <div className="mt-4 rounded-lg bg-mist px-3 py-2 text-sm" aria-live="polite">
          <p>เล่น <span className="num">{EXAMPLE_PLAYED}</span> นาที คิด <span className="num font-medium">{exBilled}</span> นาที ({minutesText(exBilled)})</p>
          <p>เล่น <span className="num">10</span> นาที คิด <span className="num font-medium">{exShort}</span> นาที</p>
        </div>
      </Section>

      <Section
        title="LINE OA"
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            {shop.lineLive ? <Badge tone="green">เชื่อม LINE แล้ว</Badge> : <Badge tone="yellow">โหมดทดลอง (ยังไม่เชื่อม LINE)</Badge>}
            {!shop.lineLive && <span>ข้อความทั้งหมดไปอยู่ในกล่อง LINE ของระบบแทน ใส่ Channel secret และ access token เพื่อเชื่อมจริง</span>}
          </span>
        }
      >
        <details className="mb-5 rounded-lg border border-line px-4 py-3 text-sm text-ink-soft">
          <summary className="cursor-pointer font-medium text-ink">ขั้นตอนเชื่อม LINE</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li>ถ้ารันระบบในเครื่อง ให้เปิด tunnel ก่อน เช่น <code className="num text-ink">cloudflared tunnel --url http://localhost:3000</code> แล้วใส่ URL https ที่ได้ในช่องที่อยู่สาธารณะด้านล่าง</li>
            <li>ใน LINE Developers สร้าง Messaging API channel ของร้าน คัดลอก Channel ID, Channel secret และออก Channel access token (long-lived) มาใส่ที่นี่</li>
            <li>ในแท็บ Messaging API วาง Webhook URL ด้านล่าง เปิด Use webhook แล้วกด Verify</li>
            <li>สร้าง LINE Login channel ใน provider เดียวกัน เพิ่ม LIFF app ขนาด Full ตั้ง Endpoint URL เป็นลิงก์ LIFF ด้านล่าง เลือก scope openid และ profile แล้วนำ LIFF ID มาใส่</li>
            <li>เชิญบอท OA เข้ากลุ่ม LINE ของพนักงาน พิมพ์ <span className="text-ink">ไอดี</span> ในกลุ่ม แล้วนำไอดีกลุ่มมาใส่ช่องผู้รับแจ้งเตือน</li>
          </ol>
        </details>

        <div className="space-y-4">
          <Field label="ที่อยู่สาธารณะของระบบ (PUBLIC URL)" hint={isLocal ? 'LINE เรียก localhost หรือ IP ในวง LAN ไม่ได้ ต้องใช้ URL https จาก tunnel' : 'จำไว้ในเบราว์เซอร์นี้ ใช้สร้างลิงก์ด้านล่างเท่านั้น'}>
            <input className="field num" type="url" value={publicUrl} onChange={(e) => updatePublicUrl(e.target.value)} placeholder="https://xxxx.trycloudflare.com" />
          </Field>
          <div>
            <p className="label">Webhook URL สำหรับ Messaging API</p>
            <CopyLine value={webhook} label=" Webhook URL" />
          </div>
          <div>
            <p className="label">Endpoint URL ของ LIFF</p>
            <CopyLine value={liffEndpoint} label=" LIFF endpoint" />
          </div>

          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <Field label="Messaging API Channel ID">
              <input className="field num" inputMode="numeric" disabled={ro} value={form.lineChannelId} onChange={set('lineChannelId')} />
            </Field>
            <Field label="LINE OA basic ID" hint="เช่น @123abcd ใช้ทำลิงก์เพิ่มเพื่อน">
              <input className="field num" disabled={ro} value={form.lineOaBasicId} onChange={set('lineOaBasicId')} />
            </Field>
            <div className="sm:col-span-2">
              <SecretInput label="Channel secret" isSet={shop.lineChannelSecretSet} state={secret} onChange={setSecret} disabled={ro} />
            </div>
            <div className="sm:col-span-2">
              <SecretInput label="Channel access token" isSet={shop.lineAccessTokenSet} state={token} onChange={setToken} disabled={ro} />
            </div>
            <Field label="LINE Login Channel ID">
              <input className="field num" inputMode="numeric" disabled={ro} value={form.lineLoginChannelId} onChange={set('lineLoginChannelId')} />
            </Field>
            <Field label="LIFF ID">
              <input className="field num" disabled={ro} value={form.lineLiffId} onChange={set('lineLiffId')} placeholder="1234567890-AbCdEfGh" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="ผู้รับแจ้งเตือนฝั่งร้าน (group ID หรือ user ID)" hint="เพิ่มบอทเข้ากลุ่ม LINE ของพนักงาน แล้วพิมพ์ ไอดี ในกลุ่ม บอทจะตอบไอดีกลุ่มกลับมา">
                <input className="field num" disabled={ro} value={form.lineAdminTargetId} onChange={set('lineAdminTargetId')} placeholder="C1234… หรือ U1234…" />
              </Field>
              {shop.lineLastSeenGroupId && shop.lineLastSeenGroupId !== form.lineAdminTargetId && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <span>พบกลุ่มที่บอทเพิ่งเข้าร่วม <code className="num text-ink">{shop.lineLastSeenGroupId}</code></span>
                  <Button type="button" variant="outline" size="sm" className="min-h-9" disabled={ro} onClick={() => setForm({ ...form, lineAdminTargetId: shop.lineLastSeenGroupId! })}>
                    ใช้กลุ่มนี้
                  </Button>
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <Field label="ผู้รับแจ้งเตือนเร่งด่วน: เจ้าของร้าน (user ID)" hint="ใช้เมื่อสลิปรอตรวจนานเกิน 10 นาที หรือการจองหมดเวลาโดยไม่มีใครตรวจ ให้เจ้าของร้านแชทกับบอทแล้วพิมพ์ ไอดี">
                <input className="field num" disabled={ro} value={form.lineOwnerTargetId} onChange={set('lineOwnerTargetId')} placeholder="U1234…" />
              </Field>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="ตรวจสลิปอัตโนมัติ"
        sub="ตรวจกับธนาคารว่าโอนเข้าบัญชีร้านจริง ยอดครบ และไม่ใช่สลิปเก่า ผ่านครบระบบยืนยันการจองและส่ง QR ให้ลูกค้าทันที ไม่ผ่านหรือตรวจไม่ได้จะส่งให้พนักงานตรวจพร้อมเหตุผล สลิปที่เคยใช้แล้วถูกปฏิเสธเสมอแม้ไม่ได้เปิดบริการนี้"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ผู้ให้บริการ">
            <select className="field" disabled={ro} value={form.slipProvider} onChange={(e) => setForm({ ...form, slipProvider: e.target.value })}>
              <option value="none">ไม่ใช้ (พนักงานตรวจเอง)</option>
              <option value="easyslip">EasySlip</option>
              <option value="slipok">SlipOK</option>
            </select>
          </Field>
          {form.slipProvider === 'slipok' && (
            <Field label="SlipOK Branch ID">
              <input className="field num" disabled={ro} value={form.slipOkBranchId} onChange={set('slipOkBranchId')} />
            </Field>
          )}
          {form.slipProvider !== 'none' && (
            <div className="sm:col-span-2">
              <SecretInput label="API key ของผู้ให้บริการ" isSet={shop.slipApiKeySet} state={slipKey} onChange={setSlipKey} disabled={ro} />
            </div>
          )}
          <Field label="เลขบัญชีธนาคารที่รับมัดจำ (ถ้ามี)" className="sm:col-span-2" hint={`ใช้เทียบบัญชีผู้รับในสลิป ร่วมกับพร้อมเพย์ ${form.promptpayId || '(ยังไม่ได้ตั้ง)'} คั่นหลายบัญชีด้วยจุลภาค`}>
            <input className="field num" disabled={ro} value={form.slipReceiverAccounts} onChange={set('slipReceiverAccounts')} placeholder="123-4-56789-0" />
          </Field>
        </div>
        {form.slipProvider !== 'none' && !shop.slipApiKeySet && slipKey.mode !== 'set' && (
          <p className="mt-3 rounded-lg bg-[#fbf1dc] px-3 py-2 text-sm text-[#7a560e]">ยังไม่มี API key ระบบจะส่งสลิปให้พนักงานตรวจเหมือนเดิม</p>
        )}
      </Section>

      {owner && (
        <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <Button type="submit" busy={busy === 'save'}>บันทึก</Button>
        </div>
      )}
    </form>
  );
}
