'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, getActingShop, setActingShop } from '@/lib/api';
import { useLive } from '@/lib/live';
import { isOwner, MeCtx } from '@/lib/session';
import type { Me } from '@/lib/types';
import { ShopMark } from '@/components/ui';

interface NavItem { href: string; label: string; owner?: boolean; icon: string }
const NAV: NavItem[] = [
  { href: '/admin', label: 'ภาพรวม', icon: 'M3 12h4v8H3zM10 4h4v16h-4zM17 9h4v11h-4z', owner: true },
  { href: '/admin/floor', label: 'โต๊ะในร้าน', icon: 'M3 6h18v12H3zM3 6l2 2M21 6l-2 2M3 18l2-2M21 18l-2-2' },
  { href: '/admin/bookings', label: 'การจอง', icon: 'M5 4h14v17H5zM9 2v4M15 2v4M5 9h14' },
  { href: '/admin/check-in', label: 'สแกน QR เช็คอิน', icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2' },
  { href: '/admin/members', label: 'สมาชิก', icon: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 100-6M22 20c0-3-2-5-5-5' },
  { href: '/admin/reports', label: 'รายงาน', icon: 'M6 2h9l5 5v15H6zM14 2v6h6M9 14h8M9 18h5', owner: true },
  { href: '/admin/campaigns', label: 'แคมเปญ', icon: 'M20 12l-8 8-9-9V3h8zM7.5 7.5h.01', owner: true },
  { href: '/admin/tables', label: 'โต๊ะและราคา', icon: 'M4 7h16v10H4zM8 17v3M16 17v3', owner: true },
  { href: '/admin/devices', label: 'บอร์ด ESP', icon: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4', owner: true },
  { href: '/admin/line', label: 'ข้อความ LINE', icon: 'M4 5h16v11H9l-5 4z' },
  { href: '/admin/users', label: 'ผู้ใช้งาน', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6', owner: true },
  { href: '/admin/settings', label: 'ตั้งค่าร้าน', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .3-1.5-1.5L17 5l-3-1-1 2h-2L10 4 7 5l.5 2L6 8.5 4 8 3 11l2 1v2l-2 1 1 3 2-.3 1.5 1.5L7 20l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z', owner: true },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [platformShop, setPlatformShop] = useState<{ name: string; logoUrl: string | null } | null>(null);
  const path = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const lastPending = useRef(0);

  // Slips waiting for a human: badge on the menu, and a short chime when a new one arrives.
  const loadPending = useCallback(() => {
    api<{ count: number }>('/bookings/pending-count')
      .then(({ count }) => {
        if (count > lastPending.current) chime();
        lastPending.current = count;
        setPending(count);
      })
      .catch(() => undefined);
  }, []);
  useLive(['bookings'], loadPending, 30000);

  useEffect(() => {
    api<Me>('/auth/me')
      .then(async (m) => {
        if (m.role === 'PLATFORM_ADMIN') {
          if (!getActingShop()) return router.replace('/platform');
          const s = await api<{ name: string; logoUrl: string | null }>('/shop');
          setPlatformShop(s);
        }
        setMe(m);
        api<{ count: number }>('/bookings/pending-count').then(({ count }) => {
          lastPending.current = count; // no chime for slips that were already waiting
          setPending(count);
        }).catch(() => undefined);
      })
      .catch(() => router.replace(`/login?next=${encodeURIComponent(path)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setNavOpen(false), [path]);

  if (!me) {
    return <div className="flex min-h-dvh items-center justify-center text-ink-mute">กำลังโหลด</div>;
  }

  const owner = isOwner(me);
  const shop = me.shop ?? (platformShop ? { ...platformShop, slug: '' } : null);
  const items = NAV.filter((n) => owner || !n.owner);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setActingShop(null);
    router.replace('/login');
  }

  return (
    <MeCtx.Provider value={me}>
      <div className="min-h-dvh bg-[#f6faf7] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex items-center justify-between bg-baize-deep px-4 py-3 text-white lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            {shop && <ShopMark name={shop.name} logoUrl={shop.logoUrl} size={28} />}
            <span className="truncate font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{shop?.name}</span>
          </div>
          {pending > 0 && <Link href="/admin/bookings" className="num mr-2 rounded-full bg-ball-yellow px-2 text-xs leading-6 text-ink" aria-label={`${pending} สลิปรอตรวจ`}>{pending}</Link>}
          <button onClick={() => setNavOpen((v) => !v)} aria-expanded={navOpen} aria-controls="admin-nav" className="rounded-md p-1.5" aria-label="เมนู">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={navOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
          </button>
        </div>

        <nav
          id="admin-nav"
          className={`sidebar fixed inset-y-0 left-0 z-40 w-[260px] -translate-x-full overflow-y-auto px-3 py-5 text-white drawer lg:sticky lg:top-0 lg:h-dvh lg:w-auto lg:translate-x-0 ${navOpen ? 'translate-x-0' : ''}`}
        >
          <div className="mb-6 flex items-center gap-3 px-2">
            {shop && <ShopMark name={shop.name} logoUrl={shop.logoUrl} size={40} />}
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>{shop?.name}</p>
              {me.shop?.slug && (
                <a href={`/s/${me.shop.slug}`} target="_blank" className="text-xs text-white/60 hover:text-white">ดูหน้าจองของร้าน</a>
              )}
            </div>
          </div>
          <ul className="space-y-0.5">
            {items.map((n) => {
              const active = n.href === '/admin' ? path === '/admin' : path.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-white text-baize-deep' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden><path d={n.icon} /></svg>
                    <span className="flex-1">{n.label}</span>
                    {n.href === '/admin/bookings' && pending > 0 && (
                      <span className={`num min-w-5 rounded-full px-1.5 text-center text-xs leading-5 ${active ? 'bg-baize text-white' : 'bg-ball-yellow text-ink'}`} aria-label={`${pending} สลิปรอตรวจ`}>{pending}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-8 border-t border-white/15 px-2 pt-4 text-sm">
            <p className="truncate">{me.name}</p>
            <p className="text-xs text-white/60">{me.role === 'SHOP_OWNER' ? 'เจ้าของร้าน' : me.role === 'SHOP_STAFF' ? 'พนักงาน' : 'ผู้ดูแลระบบ'}</p>
            <div className="mt-3 flex gap-3 text-xs">
              {me.role === 'PLATFORM_ADMIN' && <Link href="/platform" className="text-white/70 hover:text-white">เปลี่ยนร้าน</Link>}
              <button onClick={logout} className="text-white/70 hover:text-white">ออกจากระบบ</button>
            </div>
          </div>
        </nav>
        {navOpen && <button className="fixed inset-0 z-30 bg-ink/40 lg:hidden" aria-label="ปิดเมนู" onClick={() => setNavOpen(false)} />}

        <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </MeCtx.Provider>
  );
}

/** Two soft notes via Web Audio (no asset). Browsers allow it after the user has interacted with the page. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* audio blocked: the badge still shows */
  }
}
