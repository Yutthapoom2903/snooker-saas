import Link from 'next/link';
import { serverApi } from '@/lib/api';
import { ShopMark } from '@/components/ui';
import { TableArt } from '@/components/TableArt';

interface ShopCard { slug: string; name: string; logoUrl: string | null; address: string | null }

export default async function Home() {
  const shops = (await serverApi<ShopCard[]>('/public/shops')) ?? [];
  return (
    <div className="room min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="text-xl font-semibold text-baize-deep" style={{ fontFamily: 'var(--font-display)' }}>Cue</span>
        <Link href="/login" className="rounded-lg border border-line bg-white px-4 py-2 text-sm hover:border-felt">เข้าสู่ระบบร้าน</Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-20 sm:px-6">
        <div className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 className="text-[clamp(2rem,5vw,3.25rem)] font-semibold text-baize-deep">จองโต๊ะสนุ๊กเกอร์ได้ในไม่กี่แตะ</h1>
            <p className="mt-3 max-w-[48ch] text-lg text-ink-soft">ดูว่าโต๊ะไหนว่างตอนนี้ จองล่วงหน้าผ่าน LINE แล้วสแกน QR ที่หน้าร้าน ไม่ต้องโทรถาม</p>
          </div>
          <div className="mx-auto w-full max-w-sm">
            <TableArt state="playing" title="โต๊ะสนุ๊กเกอร์" />
          </div>
        </div>

        <h2 className="mt-16 text-xl font-semibold">ร้านที่ใช้ Cue</h2>
        {shops.length === 0 ? (
          <p className="mt-3 text-ink-soft">ยังไม่มีร้านเปิดให้จอง</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {shops.map((s) => (
              <li key={s.slug}>
                <Link href={`/s/${s.slug}`} className="flex items-center gap-4 py-4 hover:bg-white/60">
                  <ShopMark name={s.name} logoUrl={s.logoUrl} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.name}</p>
                    {s.address && <p className="truncate text-sm text-ink-soft">{s.address}</p>}
                  </div>
                  <span className="text-sm text-baize">จองโต๊ะ</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
