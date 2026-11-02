'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setActingShop } from '@/lib/api';
import { MeCtx } from '@/lib/session';
import type { Me } from '@/lib/types';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>('/auth/me')
      .then((m) => (m.role === 'PLATFORM_ADMIN' ? setMe(m) : router.replace('/admin')))
      // api() doesn't auto-redirect /auth/* calls, so send everyone without a session to login.
      .catch(() => router.replace('/login?next=/platform'));
  }, [router]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setActingShop(null);
    router.replace('/login');
  }

  if (!me) return <div className="flex min-h-dvh items-center justify-center text-ink-mute">กำลังโหลด</div>;

  return (
    <MeCtx.Provider value={me}>
      <div className="min-h-dvh bg-[#f6faf7]">
        <header className="bg-baize-deep text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
            <p className="font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Cue · ผู้ดูแลระบบ</p>
            <div className="flex items-center gap-4 text-sm">
              <span className="hidden truncate text-white/70 sm:inline">{me.name}</span>
              <button onClick={logout} className="min-h-9 rounded-md px-2 text-white/80 hover:text-white">ออกจากระบบ</button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </MeCtx.Provider>
  );
}
