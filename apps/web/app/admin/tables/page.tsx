'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { baht } from '@/lib/format';
import { useToast } from '@/components/toast';
import { Badge, Button, Empty, Field, Modal, PageHead, Toggle } from '@/components/ui';

interface Table {
  id: string;
  name: string;
  label: string;
  sortOrder: number;
  pricePerHour: number;
  bookable: boolean;
  active: boolean;
  device: { id: string; name: string; online: boolean } | null;
}

interface Form { id?: string; name: string; label: string; pricePerHour: string; sortOrder: string; bookable: boolean; active: boolean }
const BLANK: Form = { name: '', label: '', pricePerHour: '120', sortOrder: '', bookable: true, active: true };

export default function TablesPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Table[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Table | null>(null);

  const load = useCallback(() => {
    api<Table[]>('/tables')
      .then(setRows)
      .catch((e: ApiError) => (e.status === 403 ? setDenied(true) : toast(e.message, 'error')));
  }, [toast]);
  useEffect(load, [load]);

  function openNew() {
    const next = (rows?.length ?? 0) + 1;
    setForm({ ...BLANK, name: `โต๊ะ ${next}`, label: `T${next}`, sortOrder: String(next) });
  }
  function openEdit(t: Table) {
    setForm({ id: t.id, name: t.name, label: t.label, pricePerHour: String(t.pricePerHour), sortOrder: String(t.sortOrder), bookable: t.bookable, active: t.active });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    const body = {
      name: form.name,
      label: form.label,
      pricePerHour: Number(form.pricePerHour),
      sortOrder: Number(form.sortOrder) || 0,
      bookable: form.bookable,
      active: form.active,
    };
    try {
      if (form.id) await api(`/tables/${form.id}`, { method: 'PATCH', json: body });
      else await api('/tables', { method: 'POST', json: body });
      toast(form.id ? 'บันทึกแล้ว' : 'เพิ่มโต๊ะแล้ว');
      setForm(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      const r = await api<{ deleted?: boolean; deactivated?: boolean }>(`/tables/${removing.id}`, { method: 'DELETE' });
      toast(r.deactivated ? `${removing.name} มีประวัติการใช้งาน จึงปิดใช้งานแทนการลบ` : `ลบ${removing.name}แล้ว`);
      setRemoving(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (denied) return <Empty title="ไม่มีสิทธิ์ใช้งานส่วนนี้">เฉพาะเจ้าของร้านจัดการโต๊ะและราคาได้</Empty>;

  return (
    <div className="max-w-5xl">
      <PageHead title="โต๊ะและราคา" sub="เปลี่ยนราคาแล้วมีผลกับเกมที่เปิดหลังจากนี้ เกมที่เล่นอยู่ยังคิดราคาเดิม">
        <Button onClick={openNew}>เพิ่มโต๊ะ</Button>
      </PageHead>

      {!rows ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : rows.length === 0 ? (
        <Empty title="ยังไม่มีโต๊ะ">กดเพิ่มโต๊ะเพื่อเริ่มต้น</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>ชื่อโต๊ะ</th>
                <th>ป้ายบนจอ</th>
                <th className="text-right">ราคา/ชม.</th>
                <th>รับจอง</th>
                <th>สถานะ</th>
                <th>บอร์ด</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.active ? '' : 'text-ink-mute'}>
                  <td className="font-medium">{t.name}</td>
                  <td><span className="num rounded bg-mist px-1.5 py-0.5 text-baize-deep">{t.label}</span></td>
                  <td className="num text-right">{baht(t.pricePerHour)}</td>
                  <td>{t.bookable ? <Badge tone="green">รับจอง</Badge> : <Badge>ไม่รับจอง</Badge>}</td>
                  <td>{t.active ? <Badge tone="green">ใช้งาน</Badge> : <Badge>ปิดใช้งาน</Badge>}</td>
                  <td>
                    {t.device ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <span className={`size-2 rounded-full ${t.device.online ? 'bg-felt' : 'bg-ink-mute/40'}`} aria-hidden />
                        {t.device.name}
                        <span className="sr-only">{t.device.online ? 'ออนไลน์' : 'ออฟไลน์'}</span>
                      </span>
                    ) : (
                      <span className="text-ink-mute">ไม่มี</span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button variant="quiet" size="sm" className="min-h-9" onClick={() => openEdit(t)}>แก้ไข</Button>
                      <Button variant="quiet" size="sm" className="min-h-9 text-ball-red hover:bg-[#f8e3e1]" onClick={() => setRemoving(t)}>ลบ</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'แก้ไขโต๊ะ' : 'เพิ่มโต๊ะ'}>
        {form && (
          <form onSubmit={save} className="space-y-4">
            <Field label="ชื่อโต๊ะ">
              <input className="field" value={form.name} maxLength={40} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ป้ายบนจอบอร์ด" hint="A-Z หรือ 0-9 ไม่เกิน 4 ตัว">
                <input
                  className="field num uppercase"
                  value={form.label}
                  maxLength={4}
                  pattern="[A-Za-z0-9]{1,4}"
                  required
                  onChange={(e) => setForm({ ...form, label: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                />
              </Field>
              <Field label="ลำดับ">
                <input className="field num" type="number" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
              </Field>
            </div>
            <Field label="ราคาต่อชั่วโมง (บาท)" hint={form.id ? 'มีผลกับเกมที่เปิดหลังบันทึก' : undefined}>
              <input className="field num" type="number" inputMode="numeric" min={0} step={1} required value={form.pricePerHour} onChange={(e) => setForm({ ...form, pricePerHour: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-x-6 gap-y-3 pt-1">
              <Toggle checked={form.bookable} onChange={(v) => setForm({ ...form, bookable: v })} label="ให้ลูกค้าจองออนไลน์" />
              <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="ใช้งาน" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setForm(null)}>ยกเลิก</Button>
              <Button type="submit" busy={busy}>{form.id ? 'บันทึก' : 'เพิ่มโต๊ะ'}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={`ลบ${removing?.name ?? ''}`}>
        <p className="text-sm text-ink-soft">
          ถ้าโต๊ะนี้เคยมีเกมหรือการจอง ระบบจะปิดใช้งานแทนการลบ เพื่อให้รายงานย้อนหลังยังครบ และจะปลดบอร์ดที่ผูกไว้ออก
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRemoving(null)}>ยกเลิก</Button>
          <Button variant="danger" busy={busy} onClick={remove}>ลบ</Button>
        </div>
      </Modal>
    </div>
  );
}
