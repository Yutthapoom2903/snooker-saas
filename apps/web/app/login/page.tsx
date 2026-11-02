'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, setActingShop } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button, Field } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const me = await api<Me>('/auth/login', { method: 'POST', json: { email, password } });
      if (me.role === 'PLATFORM_ADMIN') {
        setActingShop(null);
        router.replace('/platform');
      } else {
        router.replace(next?.startsWith('/admin') ? next : '/admin');
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'เข้าสู่ระบบไม่สำเร็จ');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-[0_24px_60px_-30px_rgba(10,79,50,0.45)]">
      <h1 className="text-2xl font-semibold text-baize-deep">เข้าสู่ระบบหลังร้าน</h1>
      <p className="mt-1 text-sm text-ink-soft">สำหรับเจ้าของร้านและพนักงาน</p>
      <Field label="อีเมล" className="mt-5">
        <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </Field>
      <Field label="รหัสผ่าน" className="mt-3">
        <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {err && <p role="alert" className="mt-3 text-sm text-ball-red">{err}</p>}
      <Button type="submit" size="lg" className="mt-5 w-full" busy={busy}>เข้าสู่ระบบ</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="room flex min-h-dvh items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
