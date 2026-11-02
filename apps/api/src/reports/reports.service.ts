import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingStatus, PaymentType, SessionStatus } from '@prisma/client';
import { join } from 'path';
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { fromLocal, hm, local, thaiDate, thaiDateTime } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';

// pdfmake's Node printer is CommonJS-only.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake');

export type Period = 'day' | 'week' | 'month' | 'last30';

const FONT_DIR = join(process.cwd(), 'assets', 'fonts');
const TYPE_LABEL: Record<PaymentType, string> = { TABLE: 'ค่าโต๊ะ', DEPOSIT: 'มัดจำการจอง', MEMBERSHIP: 'สมาชิก', REFUND: 'คืนเงิน' };
const METHOD_LABEL: Record<string, string> = { CASH: 'เงินสด', PROMPTPAY: 'พร้อมเพย์', TRANSFER: 'โอน', CARD: 'บัตร' };

export function periodRange(period: Period, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date ต้องเป็น YYYY-MM-DD');
  const d = local(fromLocal(date));
  let start = d.startOf('day');
  let end = start.add(1, 'day');
  if (period === 'week') {
    start = start.subtract((start.day() + 6) % 7, 'day'); // Monday
    end = start.add(7, 'day');
  } else if (period === 'month') {
    start = start.startOf('month');
    end = start.add(1, 'month');
  } else if (period === 'last30') {
    end = start.add(1, 'day');
    start = start.subtract(29, 'day');
  }
  const len = end.diff(start, 'day');
  return {
    from: start.toDate(),
    to: end.toDate(),
    days: len,
    prevFrom: (period === 'month' ? start.subtract(1, 'month') : start.subtract(len, 'day')).toDate(),
  };
}

const baht = (n: number) => `${n.toLocaleString('th-TH')} ฿`;

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async summary(shopId: string, period: Period, date: string) {
    const r = periodRange(period, date);
    const shop = await this.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const [payments, prevAgg, sessions, bookings, tables] = await Promise.all([
      this.prisma.payment.findMany({ where: { shopId, createdAt: { gte: r.from, lt: r.to } }, orderBy: { createdAt: 'asc' } }),
      // Compare like with like: a period in progress is compared with the same elapsed span of the previous one.
      this.prisma.payment.aggregate({
        where: { shopId, createdAt: { gte: r.prevFrom, lt: new Date(r.prevFrom.getTime() + Math.max(0, Math.min(Date.now(), r.to.getTime()) - r.from.getTime())) } },
        _sum: { amount: true },
      }),
      this.prisma.tableSession.findMany({
        where: { shopId, status: SessionStatus.CLOSED, endedAt: { gte: r.from, lt: r.to } },
        include: { table: { select: { name: true } } },
      }),
      this.prisma.booking.findMany({ where: { shopId, startAt: { gte: r.from, lt: r.to } }, select: { status: true, depositAmount: true, depositForfeited: true } }),
      this.prisma.snookerTable.findMany({ where: { shopId, active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);

    const total = payments.reduce((s, p) => s + p.amount, 0);
    const byType = Object.fromEntries(Object.values(PaymentType).map((t) => [t, 0])) as Record<PaymentType, number>;
    const byMethod: Record<string, number> = {};
    for (const p of payments) {
      byType[p.type] += p.amount;
      byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    }

    // Series: hourly for a day, daily otherwise.
    const series: { key: string; label: string; amount: number }[] = [];
    if (period === 'day') {
      for (let h = 0; h < 24; h++) series.push({ key: String(h), label: `${String(h).padStart(2, '0')}:00`, amount: 0 });
      for (const p of payments) series[local(p.createdAt).hour()].amount += p.amount;
    } else {
      for (let i = 0; i < r.days; i++) {
        const d = local(r.from).add(i, 'day');
        series.push({ key: d.format('YYYY-MM-DD'), label: period === 'week' ? ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'][d.day()] : String(d.date()), amount: 0 });
      }
      for (const p of payments) {
        const idx = local(p.createdAt).startOf('day').diff(local(r.from), 'day');
        if (series[idx]) series[idx].amount += p.amount;
      }
    }

    // Table usage: played minutes vs opening minutes in the period.
    let openMin = shop.open24h ? 24 * 60 : hm(shop.closeTime) - hm(shop.openTime);
    if (openMin <= 0) openMin += 24 * 60;
    // Only count days that have started, so a month in progress isn't diluted by future days.
    const elapsedDays = Math.max(0, Math.min(r.days, Math.ceil((Date.now() - r.from.getTime()) / 86400000)));
    const capacity = openMin * elapsedDays;
    const perTable = tables.map((t) => {
      const mine = sessions.filter((s) => s.tableId === t.id);
      const minutes = mine.reduce((a, s) => a + playedMinutes(s), 0);
      const revenue = mine.reduce((a, s) => a + (s.netAmount ?? 0) + (s.depositApplied ?? 0), 0);
      return { id: t.id, name: t.name, sessions: mine.length, minutes, revenue, utilization: capacity ? Math.min(100, Math.round((minutes / capacity) * 100)) : 0 };
    });

    const hourly = Array.from({ length: 24 }, () => 0);
    for (const s of sessions) hourly[local(s.startedAt).hour()]++;

    const count = (st: BookingStatus) => bookings.filter((b) => b.status === st).length;
    const prev = prevAgg._sum.amount ?? 0;
    return {
      shop: { name: shop.name, logoUrl: shop.logoUrl },
      period,
      from: r.from,
      to: r.to,
      label: periodLabel(period, r.from, r.to),
      total,
      previousTotal: prev,
      changePct: prev ? Math.round(((total - prev) / Math.abs(prev)) * 1000) / 10 : null,
      byType,
      byMethod,
      series,
      sessions: {
        count: sessions.length,
        minutes: sessions.reduce((a, s) => a + playedMinutes(s), 0),
        discount: sessions.reduce((a, s) => a + (s.discountAmount ?? 0), 0),
      },
      perTable,
      startsByHour: hourly,
      bookings: {
        total: bookings.length,
        confirmed: count(BookingStatus.CONFIRMED),
        checkedIn: count(BookingStatus.CHECKED_IN),
        noShow: count(BookingStatus.NO_SHOW),
        cancelled: count(BookingStatus.CANCELLED) + count(BookingStatus.REJECTED),
        forfeited: bookings.filter((b) => b.depositForfeited).reduce((a, b) => a + b.depositAmount, 0),
      },
      payments: payments.map((p) => ({ id: p.id, at: p.createdAt, type: p.type, method: p.method, amount: p.amount, note: p.note })),
    };
  }

  async pdf(shopId: string, period: Period, date: string): Promise<Buffer> {
    const s = await this.summary(shopId, period, date);
    const printer = new PdfPrinter({
      Sarabun: { normal: join(FONT_DIR, 'Sarabun-Regular.ttf'), bold: join(FONT_DIR, 'Sarabun-Bold.ttf'), italics: join(FONT_DIR, 'Sarabun-Regular.ttf'), bolditalics: join(FONT_DIR, 'Sarabun-Bold.ttf') },
    });
    const green = '#0F7A4A';
    const head = (t: string) => ({ text: t, bold: true, color: '#FFFFFF', fillColor: green });
    const tableLayout = { hLineColor: '#D5E6DC', vLineColor: '#D5E6DC', hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 4, paddingBottom: () => 4 };

    const kpis: Content = {
      columns: [
        kpi('รายรับสุทธิ', baht(s.total), s.changePct === null ? 'ไม่มีข้อมูลช่วงก่อน' : `${s.changePct >= 0 ? '+' : ''}${s.changePct}% จากช่วงก่อน`),
        kpi('เปิดโต๊ะ', `${s.sessions.count} ครั้ง`, `${Math.round(s.sessions.minutes / 60)} ชั่วโมงรวม`),
        kpi('การจอง', `${s.bookings.total} รายการ`, `ไม่มา ${s.bookings.noShow} · ยึดมัดจำ ${baht(s.bookings.forfeited)}`),
      ],
      columnGap: 10,
      margin: [0, 6, 0, 14],
    };

    const doc: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [36, 40, 36, 44],
      defaultStyle: { font: 'Sarabun', fontSize: 10, color: '#1B2A22' },
      info: { title: `รายงานรายรับ ${s.shop.name} ${s.label}` },
      footer: (page, pages) => ({
        columns: [
          { text: `พิมพ์เมื่อ ${thaiDateTime(new Date())}`, color: '#6B7C72', fontSize: 8 },
          { text: `หน้า ${page}/${pages}`, alignment: 'right', color: '#6B7C72', fontSize: 8 },
        ],
        margin: [36, 12, 36, 0],
      }),
      content: [
        { text: s.shop.name, fontSize: 18, bold: true, color: green },
        { text: `รายงานรายรับ${period === 'day' ? 'รายวัน' : period === 'week' ? 'รายสัปดาห์' : period === 'month' ? 'รายเดือน' : '30 วันล่าสุด'} · ${s.label}`, fontSize: 12, margin: [0, 2, 0, 8] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, lineColor: green }] },
        kpis,
        { text: 'สรุปตามประเภท', bold: true, fontSize: 12, margin: [0, 0, 0, 4] },
        {
          table: {
            widths: ['*', 100],
            body: [
              [head('ประเภท'), { ...head('จำนวนเงิน'), alignment: 'right' }],
              ...Object.entries(s.byType).filter(([, v]) => v !== 0).map(([k, v]) => [TYPE_LABEL[k as PaymentType], { text: baht(v), alignment: 'right' }]),
              [{ text: 'รวม', bold: true }, { text: baht(s.total), bold: true, alignment: 'right' }],
            ],
          },
          layout: tableLayout,
        },
        { text: 'ตามช่องทางชำระ', bold: true, fontSize: 12, margin: [0, 12, 0, 4] },
        {
          table: {
            widths: ['*', 100],
            body: [[head('ช่องทาง'), { ...head('จำนวนเงิน'), alignment: 'right' }], ...Object.entries(s.byMethod).map(([k, v]) => [METHOD_LABEL[k] ?? k, { text: baht(v), alignment: 'right' }])],
          },
          layout: tableLayout,
        },
        { text: 'การใช้งานแต่ละโต๊ะ', bold: true, fontSize: 12, margin: [0, 12, 0, 4] },
        {
          table: {
            widths: ['*', 60, 70, 60, 90],
            body: [
              [head('โต๊ะ'), { ...head('ครั้ง'), alignment: 'right' }, { ...head('ชั่วโมง'), alignment: 'right' }, { ...head('ใช้งาน'), alignment: 'right' }, { ...head('ค่าโต๊ะ'), alignment: 'right' }],
              ...s.perTable.map((t) => [
                t.name,
                { text: String(t.sessions), alignment: 'right' },
                { text: (t.minutes / 60).toFixed(1), alignment: 'right' },
                { text: `${t.utilization}%`, alignment: 'right' },
                { text: baht(t.revenue), alignment: 'right' },
              ]),
            ],
          },
          layout: tableLayout,
        },
        { text: period === 'day' ? 'รายรับรายชั่วโมง' : 'รายรับรายวัน', bold: true, fontSize: 12, margin: [0, 12, 0, 4] },
        {
          table: {
            widths: ['*', 100],
            body: [
              [head(period === 'day' ? 'ชั่วโมง' : 'วันที่'), { ...head('จำนวนเงิน'), alignment: 'right' }],
              ...s.series.filter((x) => x.amount !== 0).map((x) => [period === 'day' ? x.label : thaiDate(fromLocal(x.key)), { text: baht(x.amount), alignment: 'right' }]),
            ],
          },
          layout: tableLayout,
        },
      ],
    };

    return new Promise((resolve, reject) => {
      const pdf = printer.createPdfKitDocument(doc);
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.end();
    });

    function kpi(title: string, value: string, sub: string): Content {
      return {
        table: { widths: ['*'], body: [[{ stack: [{ text: title, color: '#6B7C72', fontSize: 9 }, { text: value, fontSize: 16, bold: true, color: green }, { text: sub, fontSize: 8, color: '#6B7C72' }], margin: [6, 4, 6, 4] }]] },
        layout: { hLineColor: '#BFDCCB', vLineColor: '#BFDCCB', hLineWidth: () => 0.8, vLineWidth: () => 0.8 },
      };
    }
  }
}

function playedMinutes(s: { startedAt: Date; endedAt: Date | null; pausedMs: number }) {
  if (!s.endedAt) return 0;
  return Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime() - s.pausedMs) / 60000));
}

function periodLabel(period: Period, from: Date, to: Date) {
  if (period === 'day') return thaiDate(from);
  if (period === 'week' || period === 'last30') return `${thaiDate(from)} – ${thaiDate(new Date(to.getTime() - 1))}`;
  const l = local(from);
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return `${months[l.month()]} ${l.year() + 543}`;
}
