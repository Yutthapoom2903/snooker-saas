'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { baht, thDate, todayLocal } from '@/lib/format';
import { useToast } from '@/components/toast';
import { Badge, Button, Empty, Field, Modal, PageHead, Toggle } from '@/components/ui';

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  type: 'PERCENT' | 'FIXED';
  value: number;
  startDate: string;
  endDate: string;
  daysOfWeek: string;
  timeFrom: string | null;
  timeTo: string | null;
  tableIds: string | null;
  membersOnly: boolean;
  active: boolean;
}
interface TableOpt { id: string; name: string; active: boolean }
interface Form {
  id?: string;
  name: string;
  description: string;
  type: 'PERCENT' | 'FIXED';
  value: string;
  startDate: string;
  endDate: string;
  days: number[];
  timed: boolean;
  timeFrom: string;
  timeTo: string;
  allTables: boolean;
  tableIds: string[];
  membersOnly: boolean;
  active: boolean;
}

const DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const DAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const localDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(iso));

function daysText(s: string) {
  const d = s.split(',').filter(Boolean).map(Number);
  if (d.length === 7) return 'ทุกวัน';
  if (d.join() === '1,2,3,4,5') return 'จันทร์–ศุกร์';
  if (d.join() === '0,6') return 'เสาร์–อาทิตย์';
  return d.map((n) => DAYS[n]).join(' ');
}

function blank(): Form {
  return {
    name: '', description: '', type: 'PERCENT', value: '10', startDate: todayLocal(), endDate: todayLocal(30),
    days: [0, 1, 2, 3, 4, 5, 6], timed: false, timeFrom: '13:00', timeTo: '17:00', allTables: true, tableIds: [], membersOnly: false, active: true,
  };
}

export default function CampaignsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [tables, setTables] = useState<TableOpt[]>([]);
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [removing, setRemoving] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Campaign[]>('/campaigns')
      .then(setRows)
      .catch((e: ApiError) => (e.status === 403 ? setDenied(true) : toast(e.message, 'error')));
  }, [toast]);
  useEffect(() => {
    load();
    api<TableOpt[]>('/tables').then(setTables).catch(() => undefined);
  }, [load]);

  const tableName = (id: string) => tables.find((t) => t.id === id)?.name ?? 'โต๊ะที่ลบแล้ว';

  function openEdit(c: Campaign) {
    setForm({
      id: c.id,
      name: c.name,
      description: c.description ?? '',
      type: c.type,
      value: String(c.value),
      startDate: localDay(c.startDate),
      endDate: localDay(c.endDate),
      days: c.daysOfWeek.split(',').filter(Boolean).map(Number),
      timed: !!c.timeFrom,
      timeFrom: c.timeFrom ?? '13:00',
      timeTo: c.timeTo ?? '17:00',
      allTables: !c.tableIds,
      tableIds: c.tableIds?.split(',').filter(Boolean) ?? [],
      membersOnly: c.membersOnly,
      active: c.active,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.days.length) return toast('เลือกวันอย่างน้อย 1 วัน', 'error');
    if (!form.allTables && !form.tableIds.length) return toast('เลือกโต๊ะอย่างน้อย 1 โต๊ะ หรือเลือกใช้ได้ทุกโต๊ะ', 'error');
    setBusy(true);
    const body = {
      name: form.name,
      description: form.description,
      type: form.type,
      value: Number(form.value),
      startDate: form.startDate,
      endDate: form.endDate,
      daysOfWeek: form.days,
      timeFrom: form.timed ? form.timeFrom : '',
      timeTo: form.timed ? form.timeTo : '',
      tableIds: form.allTables ? [] : form.tableIds,
      membersOnly: form.membersOnly,
      active: form.active,
    };
    try {
      if (form.id) await api(`/campaigns/${form.id}`, { method: 'PATCH', json: body });
      else await api('/campaigns', { method: 'POST', json: body });
      toast(form.id ? 'บันทึกแล้ว' : 'เพิ่มแคมเปญแล้ว');
      setForm(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(c: Campaign, active: boolean) {
    try {
      await api(`/campaigns/${c.id}`, { method: 'PATCH', json: { active } });
      toast(active ? 'เปิดใช้แคมเปญแล้ว' : 'ปิดแคมเปญแล้ว');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/campaigns/${removing.id}`, { method: 'DELETE' });
      toast('ลบแคมเปญแล้ว');
      setRemoving(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (denied) return <Empty title="ไม่มีสิทธิ์ใช้งานส่วนนี้">เฉพาะเจ้าของร้านจัดการแคมเปญได้</Empty>;

  const today = todayLocal();
  const wraps = form?.timed && form.timeFrom && form.timeTo && form.timeTo <= form.timeFrom;

  return (
    <div className="max-w-5xl">
      <PageHead title="แคมเปญ" sub="ส่วนลดไม่ซ้อนกัน ตอนคิดเงินระบบเลือกส่วนลดที่คุ้มที่สุดให้ลูกค้าเพียงรายการเดียว รวมถึงส่วนลดสมาชิก">
        <Button onClick={() => setForm(blank())}>เพิ่มแคมเปญ</Button>
      </PageHead>

      {!rows ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : rows.length === 0 ? (
        <Empty title="ยังไม่มีแคมเปญ">เช่น ลด 20% ช่วงบ่ายวันธรรมดา</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>แคมเปญ</th>
                <th className="text-right">ส่วนลด</th>
                <th>ช่วงวันที่</th>
                <th>วันและเวลา</th>
                <th>เงื่อนไข</th>
                <th>เปิดใช้</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const expired = localDay(c.endDate) < today;
                const tids = c.tableIds?.split(',').filter(Boolean) ?? [];
                return (
                  <tr key={c.id} className={c.active && !expired ? '' : 'text-ink-mute'}>
                    <td>
                      <p className="font-medium">{c.name}</p>
                      {c.description && <p className="max-w-[18rem] text-xs text-ink-mute">{c.description}</p>}
                    </td>
                    <td className="num text-right whitespace-nowrap">{c.type === 'PERCENT' ? `${c.value}%` : baht(c.value)}</td>
                    <td className="whitespace-nowrap">
                      <span className="num">{thDate(c.startDate)}</span> – <span className="num">{thDate(c.endDate)}</span>
                      {expired && <span className="ml-1.5"><Badge>หมดเขต</Badge></span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {daysText(c.daysOfWeek)}
                      <span className="num ml-1.5">{c.timeFrom ? `${c.timeFrom}–${c.timeTo}` : 'ทั้งวัน'}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {c.membersOnly && <Badge tone="yellow">เฉพาะสมาชิก</Badge>}
                        {tids.length > 0 ? <Badge>{tids.length <= 2 ? tids.map(tableName).join(', ') : `${tids.length} โต๊ะ`}</Badge> : <Badge>ทุกโต๊ะ</Badge>}
                      </div>
                    </td>
                    <td><Toggle checked={c.active} onChange={(v) => toggleActive(c, v)} label={c.active ? 'เปิด' : 'ปิด'} /></td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button variant="quiet" size="sm" className="min-h-9" onClick={() => openEdit(c)}>แก้ไข</Button>
                        <Button variant="quiet" size="sm" className="min-h-9 text-ball-red hover:bg-[#f8e3e1]" onClick={() => setRemoving(c)}>ลบ</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'แก้ไขแคมเปญ' : 'เพิ่มแคมเปญ'} wide>
        {form && (
          <form onSubmit={save} className="space-y-4">
            <Field label="ชื่อแคมเปญ">
              <input className="field" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น Happy Hour บ่าย" />
            </Field>
            <Field label="รายละเอียด" hint="แสดงให้ลูกค้าเห็นในหน้าจอง">
              <textarea className="field" rows={2} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset>
                <legend className="label">ประเภทส่วนลด</legend>
                <div className="flex gap-2">
                  {(['PERCENT', 'FIXED'] as const).map((t) => (
                    <label key={t} className={`flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm ${form.type === t ? 'border-felt bg-mist text-baize-deep' : 'border-line'}`}>
                      <input type="radio" name="ctype" className="sr-only" checked={form.type === t} onChange={() => setForm({ ...form, type: t })} />
                      {t === 'PERCENT' ? 'ลดเป็น %' : 'ลดเป็นบาท'}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label={form.type === 'PERCENT' ? 'ลดกี่ %' : 'ลดกี่บาทต่อบิล'}>
                <input className="field num" type="number" inputMode="numeric" required min={1} max={form.type === 'PERCENT' ? 100 : 100000} step={1} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="วันเริ่ม">
                <input className="field num" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </Field>
              <Field label="วันสิ้นสุด">
                <input className="field num" type="date" required min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </Field>
            </div>

            <fieldset>
              <legend className="label">วันที่ใช้ได้</legend>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = form.days.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      aria-label={DAY_NAMES[i]}
                      onClick={() => setForm({ ...form, days: on ? form.days.filter((x) => x !== i) : [...form.days, i].sort() })}
                      className={`min-h-10 min-w-11 rounded-full border px-3 text-sm transition-colors ${on ? 'border-felt bg-baize text-white' : 'border-line bg-white text-ink-soft hover:border-felt'}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div>
              <Toggle checked={form.timed} onChange={(v) => setForm({ ...form, timed: v })} label="เฉพาะช่วงเวลา" />
              {form.timed && (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Field label="ตั้งแต่">
                    <input className="field num" type="time" required value={form.timeFrom} onChange={(e) => setForm({ ...form, timeFrom: e.target.value })} />
                  </Field>
                  <Field label="ถึง">
                    <input className="field num" type="time" required value={form.timeTo} onChange={(e) => setForm({ ...form, timeTo: e.target.value })} />
                  </Field>
                  {wraps && <p className="col-span-2 text-xs text-ink-mute">ช่วงนี้ข้ามเที่ยงคืน เช่น <span className="num">{form.timeFrom}</span> ถึง <span className="num">{form.timeTo}</span> ของวันถัดไป</p>}
                </div>
              )}
            </div>

            <div>
              <Toggle checked={!form.allTables} onChange={(v) => setForm({ ...form, allTables: !v })} label="เฉพาะบางโต๊ะ" />
              {!form.allTables && (
                <fieldset className="mt-2">
                  <legend className="sr-only">เลือกโต๊ะ</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {tables.filter((t) => t.active || form.tableIds.includes(t.id)).map((t) => {
                      const on = form.tableIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setForm({ ...form, tableIds: on ? form.tableIds.filter((x) => x !== t.id) : [...form.tableIds, t.id] })}
                          className={`min-h-10 rounded-full border px-3 text-sm transition-colors ${on ? 'border-felt bg-baize text-white' : 'border-line bg-white text-ink-soft hover:border-felt'}`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Toggle checked={form.membersOnly} onChange={(v) => setForm({ ...form, membersOnly: v })} label="เฉพาะสมาชิก" />
              <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="เปิดใช้" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setForm(null)}>ยกเลิก</Button>
              <Button type="submit" busy={busy}>{form.id ? 'บันทึก' : 'เพิ่มแคมเปญ'}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title="ลบแคมเปญ">
        <p className="text-sm text-ink-soft">ลบ “{removing?.name}” ออกถาวร บิลที่คิดไปแล้วไม่เปลี่ยน ถ้าแค่อยากหยุดชั่วคราวให้ปิดใช้แทน</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRemoving(null)}>ยกเลิก</Button>
          <Button variant="danger" busy={busy} onClick={remove}>ลบ</Button>
        </div>
      </Modal>
    </div>
  );
}
