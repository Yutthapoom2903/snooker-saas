'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setActingShop } from '@/lib/api';
import { baht, thDate } from '@/lib/format';
import { useToast } from '@/components/toast';
import { Badge, Button, Empty, Field, Modal, PageHead, ShopMark, Toggle } from '@/components/ui';

interface ShopRow {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  active: boolean;
  createdAt: string;
  tables: number;
  users: number;
  revenue30d: number;
}
interface NewShop { name: string; slug: string; ownerEmail: string; ownerName: string; ownerPassword: string; tables: string; pricePerHour: string }
const BLANK: NewShop = { name: '', slug: '', ownerEmail: '', ownerName: '', ownerPassword: '', tables: '6', pricePerHour: '120' };
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export default function PlatformPage() {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<ShopRow[] | null>(null);
  const [form, setForm] = useState<NewShop | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ShopRow[]>('/platform/shops').then(setRows).catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);

  function manage(s: ShopRow) {
    setActingShop(s.id);
    router.push('/admin/floor');
  }

  async function toggle(s: ShopRow, active: boolean) {
    setBusy(s.id);
    try {
      await api(`/platform/shops/${s.id}`, { method: 'PATCH', json: { active } });
      toast(active ? `เปิดร้าน ${s.name} แล้ว` : `ปิดร้าน ${s.name} แล้ว`);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!SLUG.test(form.slug)) return toast('slug ใช้ a-z 0-9 และ - ยาว 3–40 ตัว ห้ามขึ้นต้นหรือลงท้ายด้วย -', 'error');
    if (form.ownerPassword.length < 8) return toast('รหัสผ่านอย่างน้อย 8 ตัว', 'error');
    setBusy('create');
    try {
      await api('/platform/shops', { method: 'POST', json: { ...form, tables: Number(form.tables), pricePerHour: Number(form.pricePerHour) } });
      toast('สร้างร้านแล้ว');
      setForm(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead title="ร้านทั้งหมด" sub="เลือกร้านเพื่อเข้าไปจัดการแทนเจ้าของร้าน">
        <Button onClick={() => setForm(BLANK)}>สร้างร้าน</Button>
      </PageHead>

      {!rows ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : rows.length === 0 ? (
        <Empty title="ยังไม่มีร้าน">กดสร้างร้านเพื่อเริ่มต้น</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>ร้าน</th>
                <th className="text-right">โต๊ะ</th>
                <th className="text-right">ผู้ใช้</th>
                <th className="text-right">รายได้ 30 วัน</th>
                <th>เปิดให้บริการ</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'text-ink-mute'}>
                  <td>
                    <div className="flex items-center gap-3">
                      <ShopMark name={s.name} logoUrl={s.logoUrl} size={36} />
                      <div className="min-w-0">
                        <p className="font-medium">
                          {s.name}
                          {!s.active && <span className="ml-1.5"><Badge>ปิดอยู่</Badge></span>}
                        </p>
                        <p className="text-xs text-ink-mute">
                          <a href={`/s/${s.slug}`} target="_blank" rel="noreferrer" className="num hover:text-baize hover:underline">/s/{s.slug}</a>
                          <span className="ml-2">สร้าง <span className="num">{thDate(s.createdAt)}</span></span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="num text-right">{s.tables}</td>
                  <td className="num text-right">{s.users}</td>
                  <td className="num text-right whitespace-nowrap">{baht(s.revenue30d)}</td>
                  <td>
                    <Toggle checked={s.active} onChange={(v) => busy !== s.id && toggle(s, v)} label={s.active ? 'เปิด' : 'ปิด'} />
                  </td>
                  <td>
                    <Button variant="outline" size="sm" className="min-h-9 whitespace-nowrap" onClick={() => manage(s)}>จัดการร้านนี้</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title="สร้างร้าน" wide>
        {form && (
          <form onSubmit={create} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ชื่อร้าน">
                <input className="field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="slug" hint={`ลิงก์หน้าจอง /s/${form.slug || 'ชื่อร้าน'} ใช้ a-z 0-9 -`}>
                <input
                  className="field num"
                  required
                  minLength={3}
                  maxLength={40}
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  placeholder="green-baize"
                />
              </Field>
            </div>
            <fieldset className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <legend className="sr-only">บัญชีเจ้าของร้าน</legend>
              <Field label="ชื่อเจ้าของร้าน">
                <input className="field" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
              </Field>
              <Field label="อีเมลเจ้าของร้าน" hint="ใช้เข้าสู่ระบบ">
                <input className="field" type="email" required autoComplete="off" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
              </Field>
              <Field label="รหัสผ่านเจ้าของร้าน" hint="อย่างน้อย 8 ตัว" className="sm:col-span-2">
                <input className="field" type="text" required minLength={8} autoComplete="new-password" value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} />
              </Field>
            </fieldset>
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-4">
              <Field label="จำนวนโต๊ะ" hint="0–50 แก้ทีหลังได้">
                <input className="field num" type="number" inputMode="numeric" min={0} max={50} step={1} value={form.tables} onChange={(e) => setForm({ ...form, tables: e.target.value })} />
              </Field>
              <Field label="ราคาต่อชั่วโมง (บาท)">
                <input className="field num" type="number" inputMode="numeric" min={0} step={1} value={form.pricePerHour} onChange={(e) => setForm({ ...form, pricePerHour: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setForm(null)}>ยกเลิก</Button>
              <Button type="submit" busy={busy === 'create'}>สร้างร้าน</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
