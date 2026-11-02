import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api';
import type { PublicShop } from '@/lib/types';
import { ShopMark } from '@/components/ui';
import { LiveFloor } from './LiveFloor';
import { BookingForm } from './BookingForm';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const shop = await serverApi<PublicShop>(`/public/shops/${slug}`);
  return { title: shop ? `จองโต๊ะ ${shop.name}` : 'ไม่พบร้าน' };
}

const DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export default async function ShopPage({ params }: Props) {
  const { slug } = await params;
  const shop = await serverApi<PublicShop>(`/public/shops/${slug}`);
  if (!shop) notFound();

  return (
    <div className="room min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-5 pb-2 sm:px-6">
        <ShopMark name={shop.name} logoUrl={shop.logoUrl} size={44} />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>{shop.name}</p>
          <p className="truncate text-sm text-ink-soft">
            {shop.open24h ? 'เปิด 24 ชั่วโมง' : `เปิด ${shop.openTime}–${shop.closeTime} น.`}{shop.phone && <> · <a className="underline-offset-2 hover:underline" href={`tel:${shop.phone}`}>{shop.phone}</a></>}
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 pt-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10">
        <section aria-labelledby="floor-title" className="order-2 min-w-0 lg:order-1">
          <h1 id="floor-title" className="text-[clamp(1.75rem,4vw,2.6rem)] font-semibold text-baize-deep">
            ตอนนี้ในร้าน
          </h1>
          <LiveFloor slug={shop.slug} initial={shop.tables} />

          {(shop.campaigns.length > 0 || shop.plans.length > 0) && (
            <div className="mt-10 grid gap-8 sm:grid-cols-2">
              {shop.campaigns.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold">โปรโมชันตอนนี้</h2>
                  <ul className="mt-3 divide-y divide-line border-y border-line">
                    {shop.campaigns.map((c) => (
                      <li key={c.id} className="flex items-baseline justify-between gap-4 py-3">
                        <div>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-sm text-ink-soft">
                            {c.description ?? `${c.daysOfWeek.split(',').map((d) => DAYS[+d]).join(' ')}${c.timeFrom ? ` ${c.timeFrom}–${c.timeTo}` : ''}`}
                            {c.membersOnly && ' (เฉพาะสมาชิก)'}
                          </p>
                        </div>
                        <span className="num shrink-0 text-lg text-baize">{c.type === 'PERCENT' ? `-${c.value}%` : `-${c.value}฿`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {shop.plans.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold">สมัครสมาชิก</h2>
                  <ul className="mt-3 divide-y divide-line border-y border-line">
                    {shop.plans.map((p) => (
                      <li key={p.id} className="flex items-baseline justify-between gap-4 py-3">
                        <div>
                          <p className="font-medium">{p.name}</p>
                          <p className="text-sm text-ink-soft">ลดค่าโต๊ะ {p.discountPercent}% ทุกครั้ง · {p.durationDays} วัน</p>
                        </div>
                        <span className="num shrink-0 text-lg">{p.price.toLocaleString('th-TH')}฿</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm text-ink-mute">สมัครได้ที่เคาน์เตอร์ร้าน</p>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="order-1 min-w-0 lg:order-2">
          <div className="lg:sticky lg:top-6">
            <BookingForm shop={shop} />
          </div>
        </aside>
      </main>

      <footer className="border-t border-line/70 py-6 text-center text-xs text-ink-mute">
        {shop.address && <p>{shop.address}</p>}
        <p className="mt-1">ระบบจองโดย Cue</p>
      </footer>
    </div>
  );
}
