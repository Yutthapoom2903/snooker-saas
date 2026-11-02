/* Demo data: one platform admin, one shop with 6 tables, a month of history. */
import { BookingStatus, PaymentMethod, PaymentType, PrismaClient, Role, SessionStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();
const PASSWORD = 'demo1234';
const DEVICE_SECRET = 'demo-device-secret';

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
const pick = <T,>(a: T[]) => a[rand(0, a.length - 1)];
const token = () => randomBytes(18).toString('base64url');

async function main() {
  const pw = await hash(PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: 'admin@snooker.local' },
    create: { email: 'admin@snooker.local', name: 'Platform Admin', role: Role.PLATFORM_ADMIN, passwordHash: pw },
    update: {},
  });

  const shop = await prisma.shop.create({
    data: {
      slug: 'demo-snooker',
      name: 'Green Baize Snooker Club',
      phone: '0812345678',
      address: '99 ถ.สุขุมวิท กรุงเทพฯ',
      openTime: '10:00',
      closeTime: '02:00',
      promptpayId: '0812345678',
      users: {
        create: [
          { email: 'owner@demo.local', name: 'คุณสมชาย (เจ้าของ)', role: Role.SHOP_OWNER, passwordHash: pw },
          { email: 'staff@demo.local', name: 'น้องแนน (แคชเชียร์)', role: Role.SHOP_STAFF, passwordHash: pw },
        ],
      },
    },
  });

  const tables = [];
  for (let i = 1; i <= 6; i++) {
    tables.push(
      await prisma.snookerTable.create({
        data: { shopId: shop.id, name: i === 6 ? 'โต๊ะ VIP' : `โต๊ะ ${i}`, label: i === 6 ? 'VIP' : `T${i}`, sortOrder: i, pricePerHour: i === 6 ? 200 : 120 },
      }),
    );
  }

  await prisma.device.create({
    data: { id: 'snk-demo-t1', shopId: shop.id, name: 'บอร์ดโต๊ะ 1', tableId: tables[0].id, secretHash: await hash(DEVICE_SECRET, 10) },
  });

  const plans = await Promise.all([
    prisma.membershipPlan.create({ data: { shopId: shop.id, name: 'รายเดือน', price: 300, durationDays: 30, discountPercent: 10 } }),
    prisma.membershipPlan.create({ data: { shopId: shop.id, name: 'ราย 3 เดือน', price: 800, durationDays: 90, discountPercent: 15 } }),
    prisma.membershipPlan.create({ data: { shopId: shop.id, name: 'รายปี', price: 2500, durationDays: 365, discountPercent: 20 } }),
  ]);

  const now = new Date();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1) - 7 * 3600000);
  const yearEnd = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59) - 7 * 3600000);
  await prisma.campaign.createMany({
    data: [
      { shopId: shop.id, name: 'Happy Hour บ่าย', description: 'จันทร์–ศุกร์ 13:00–17:00 ลด 20%', type: 'PERCENT', value: 20, startDate: yearStart, endDate: yearEnd, daysOfWeek: '1,2,3,4,5', timeFrom: '13:00', timeTo: '17:00' },
      { shopId: shop.id, name: 'Late Night สมาชิก', description: 'สมาชิกเล่นหลัง 23:00 ลดชั่วโมงละ 30 บาท', type: 'FIXED', value: 30, startDate: yearStart, endDate: yearEnd, timeFrom: '23:00', timeTo: '02:00', membersOnly: true },
    ],
  });

  const names = ['เอก', 'บอย', 'ต้น', 'ปอนด์', 'กอล์ฟ', 'บิ๊ก', 'โจ้', 'เบียร์', 'แบงค์', 'ตั้ม', 'นัท', 'ฟลุ๊ค'];
  const customers = [];
  for (const [i, n] of names.entries()) {
    customers.push(await prisma.customer.create({ data: { shopId: shop.id, name: `คุณ${n}`, phone: `08${String(10000000 + i * 7919).slice(0, 8)}` } }));
  }
  for (const c of customers.slice(0, 5)) {
    const plan = pick(plans);
    const startsAt = new Date(now.getTime() - rand(1, 25) * 86400000);
    const m = await prisma.membership.create({ data: { shopId: shop.id, customerId: c.id, planId: plan.id, startsAt, endsAt: new Date(startsAt.getTime() + plan.durationDays * 86400000), pricePaid: plan.price } });
    await prisma.payment.create({ data: { shopId: shop.id, type: PaymentType.MEMBERSHIP, method: PaymentMethod.CASH, amount: plan.price, membershipId: m.id, createdAt: startsAt, note: `${plan.name} — ${c.name}` } });
  }

  // 35 days of closed sessions, busier in the evening and on weekends.
  const hours = [11, 13, 14, 15, 16, 17, 18, 19, 19, 20, 20, 20, 21, 21, 21, 22, 22, 23, 0];
  for (let d = 35; d >= 1; d--) {
    const day = new Date(now.getTime() - d * 86400000);
    const dow = new Date(day.getTime() + 7 * 3600000).getUTCDay();
    const count = rand(6, 12) + (dow === 5 || dow === 6 ? 6 : 0);
    for (let k = 0; k < count; k++) {
      const t = pick(tables);
      const h = pick(hours);
      const localMidnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - 7 * 3600000;
      const startedAt = new Date(localMidnight + (h < 6 ? h + 24 : h) * 3600000 + rand(0, 50) * 60000);
      const minutes = rand(35, 180);
      const billed = Math.max(30, Math.ceil(minutes / 15) * 15);
      const gross = Math.ceil((billed * t.pricePerHour) / 60);
      const discount = Math.random() < 0.25 ? Math.round(gross * 0.1) : 0;
      const net = gross - discount;
      const method = pick([PaymentMethod.CASH, PaymentMethod.CASH, PaymentMethod.PROMPTPAY, PaymentMethod.PROMPTPAY, PaymentMethod.TRANSFER]);
      const endedAt = new Date(startedAt.getTime() + minutes * 60000);
      const s = await prisma.tableSession.create({
        data: {
          shopId: shop.id, tableId: t.id, customerName: Math.random() < 0.4 ? `คุณ${pick(names)}` : null,
          status: SessionStatus.CLOSED, startedAt, endedAt, pricePerHour: t.pricePerHour,
          billedMinutes: billed, grossAmount: gross, discountAmount: discount, discountLabel: discount ? 'สมาชิก 10%' : null,
          depositApplied: 0, netAmount: net, paymentMethod: method,
        },
      });
      await prisma.payment.create({ data: { shopId: shop.id, type: PaymentType.TABLE, method, amount: net, sessionId: s.id, createdAt: endedAt } });
    }
    // A few bookings per day, some no-shows (forfeited deposit).
    for (let k = 0; k < rand(1, 3); k++) {
      const t = pick(tables);
      const startAt = new Date(day.getTime() - (day.getTime() % 3600000));
      const noShow = Math.random() < 0.2;
      const b = await prisma.booking.create({
        data: {
          shopId: shop.id, code: randomBytes(4).toString('hex').slice(0, 6).toUpperCase(), publicToken: token(), tableId: t.id,
          name: `คุณ${pick(names)}`, phone: '0899999999', startAt, endAt: new Date(startAt.getTime() + 2 * 3600000),
          status: noShow ? BookingStatus.NO_SHOW : BookingStatus.CHECKED_IN, depositAmount: 50, depositForfeited: noShow,
          confirmedAt: new Date(startAt.getTime() - 3 * 3600000), checkedInAt: noShow ? null : startAt,
        },
      });
      await prisma.payment.create({ data: { shopId: shop.id, type: PaymentType.DEPOSIT, method: PaymentMethod.PROMPTPAY, amount: 50, bookingId: b.id, createdAt: b.confirmedAt!, note: `มัดจำ ${b.code}` } });
    }
  }

  // Live floor right now: two tables playing, one confirmed booking coming up.
  await prisma.tableSession.create({ data: { shopId: shop.id, tableId: tables[1].id, customerName: 'คุณเอก', startedAt: new Date(now.getTime() - 47 * 60000), pricePerHour: 120 } });
  await prisma.tableSession.create({ data: { shopId: shop.id, tableId: tables[5].id, customerId: customers[0].id, startedAt: new Date(now.getTime() - 95 * 60000), pricePerHour: 200, discountsJson: JSON.stringify([{ kind: 'MEMBER', label: 'สมาชิก (10%)', type: 'PERCENT', value: 10 }]) } });
  const soon = new Date(Math.ceil((now.getTime() + 40 * 60000) / (15 * 60000)) * 15 * 60000);
  const confirmedAt = new Date();
  const upcoming = await prisma.booking.create({
    data: {
      shopId: shop.id, code: 'DEMO01', publicToken: 'demo-ticket', tableId: tables[2].id, customerId: customers[1].id,
      name: customers[1].name, phone: customers[1].phone ?? '', partySize: 2, startAt: soon, endAt: new Date(soon.getTime() + 2 * 3600000),
      status: BookingStatus.CONFIRMED, depositAmount: 50, confirmedAt, lineUserId: 'mock-demo',
    },
  });
  await prisma.payment.create({ data: { shopId: shop.id, type: PaymentType.DEPOSIT, method: PaymentMethod.PROMPTPAY, amount: 50, bookingId: upcoming.id, createdAt: confirmedAt, note: 'มัดจำ DEMO01' } });

  console.log(`
Seeded. Password for every account: ${PASSWORD}
  platform admin  admin@snooker.local
  shop owner      owner@demo.local
  shop staff      staff@demo.local
Customer page     http://localhost:3000/s/demo-snooker
Demo ticket       http://localhost:3000/s/demo-snooker/b/demo-ticket
Simulator         npm run sim -- --id snk-demo-t1 --secret ${DEVICE_SECRET}
`);
}

main().finally(() => prisma.$disconnect());
