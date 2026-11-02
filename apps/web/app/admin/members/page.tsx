'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { baht, METHOD, thDate } from '@/lib/format';
import { isOwner, useMe } from '@/lib/session';
import { useToast } from '@/components/toast';
import { Badge, Button, Empty, Field, Modal, PageHead, Toggle } from '@/components/ui';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  lineName: string | null;
  membership: { plan: string; discountPercent: number; startsAt: string; endsAt: string } | null;
}
interface Plan { id: string; name: string; price: number; durationDays: number; discountPercent: number; active: boolean }
interface PlanForm { id?: string; name: string; price: string; durationDays: string; discountPercent: string; active: boolean }

const DAY = 86400000;

function daysLeft(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);
}

export default function MembersPage() {
  const me = useMe();
  const owner = isOwner(me);
  const toast = useToast();

  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [adding, setAdding] = useState<{ name: string; phone: string } | null>(null);
  const [selling, setSelling] = useState<{ c: Customer; planId: string; method: string } | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((term: string) => {
    api<Customer[]>(`/customers${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ''}`)
      .then(setRows)
      .catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);
  const loadPlans = useCallback(() => {
    api<Plan[]>('/plans').then(setPlans).catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);
  useEffect(loadPlans, [loadPlans]);

  const activePlans = plans.filter((p) => p.active);

  async function addCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!adding) return;
    setBusy(true);
    try {
      await api('/customers', { method: 'POST', json: adding });
      toast('เพิ่มลูกค้าแล้ว');
      setAdding(null);
      load(q);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sell(e: React.FormEvent) {
    e.preventDefault();
    if (!selling) return;
    setBusy(true);
    try {
      const m = await api<{ endsAt: string }>(`/customers/${selling.c.id}/memberships`, { method: 'POST', json: { planId: selling.planId, method: selling.method } });
      toast(`ขายสมาชิกแล้ว ใช้ได้ถึง ${thDate(m.endsAt)}`);
      setSelling(null);
      load(q);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function savePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!planForm) return;
    setBusy(true);
    const body = {
      name: planForm.name,
      price: Number(planForm.price),
      durationDays: Number(planForm.durationDays),
      discountPercent: Number(planForm.discountPercent),
      active: planForm.active,
    };
    try {
      if (planForm.id) await api(`/plans/${planForm.id}`, { method: 'PATCH', json: body });
      else await api('/plans', { method: 'POST', json: body });
      toast(planForm.id ? 'บันทึกแล้ว' : 'เพิ่มแพ็กแล้ว');
      setPlanForm(null);
      loadPlans();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const sellPlan = selling ? plans.find((p) => p.id === selling.planId) : undefined;
  const renewFrom = selling?.c.membership ? new Date(selling.c.membership.endsAt) : null;
  const sellEnds = sellPlan ? new Date((renewFrom ?? new Date()).getTime() + sellPlan.durationDays * DAY) : null;

  return (
    <div className="max-w-5xl">
      <PageHead title="สมาชิก" sub="ลูกค้าที่ถือแพ็กสมาชิกได้ส่วนลดค่าโต๊ะตามแพ็ก">
        <Button onClick={() => setAdding({ name: '', phone: '' })}>เพิ่มลูกค้า</Button>
      </PageHead>

      <div className="mb-3 max-w-sm">
        <label htmlFor="member-search" className="label">ค้นหาลูกค้า</label>
        <input id="member-search" className="field" type="search" placeholder="ชื่อหรือเบอร์โทร" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!rows ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : rows.length === 0 ? (
        <Empty title={q ? 'ไม่พบลูกค้า' : 'ยังไม่มีลูกค้า'}>{q ? 'ลองค้นด้วยชื่อหรือเบอร์อื่น' : 'ลูกค้าที่จองผ่าน LINE จะเข้ามาเอง หรือกดเพิ่มลูกค้า'}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="data-table min-w-[600px]">
            <thead>
              <tr>
                <th>ลูกค้า</th>
                <th>เบอร์โทร</th>
                <th>สมาชิก</th>
                <th>หมดอายุ</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const left = c.membership ? daysLeft(c.membership.endsAt) : 0;
                return (
                  <tr key={c.id}>
                    <td>
                      <p className="font-medium">{c.name}</p>
                      {c.lineName && c.lineName !== c.name && <p className="text-xs text-ink-mute">LINE: {c.lineName}</p>}
                    </td>
                    <td className="num">{c.phone ?? '–'}</td>
                    <td>
                      {c.membership ? (
                        <Badge tone="green">{c.membership.plan} ลด <span className="num ml-0.5">{c.membership.discountPercent}%</span></Badge>
                      ) : (
                        <span className="text-ink-mute">ไม่มี</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {c.membership ? (
                        <>
                          <span className="num">{thDate(c.membership.endsAt)}</span>
                          <span className={`ml-1.5 text-xs ${left <= 7 ? 'text-[#8a6210]' : 'text-ink-mute'}`}>อีก <span className="num">{left}</span> วัน</span>
                        </>
                      ) : '–'}
                    </td>
                    <td>
                      <Button
                        variant="quiet"
                        size="sm"
                        className="min-h-9 whitespace-nowrap"
                        disabled={!activePlans.length}
                        onClick={() => setSelling({ c, planId: activePlans[0]?.id ?? '', method: 'CASH' })}
                      >
                        {c.membership ? 'ต่ออายุ' : 'ขายสมาชิก'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length >= 100 && <p className="mt-2 text-xs text-ink-mute">แสดง 100 รายการล่าสุด ค้นหาเพื่อดูรายอื่น</p>}

      {owner && (
        <section className="mt-10">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">แพ็กสมาชิก</h2>
              <p className="text-sm text-ink-soft">แก้ราคาแล้วมีผลกับการขายครั้งถัดไป สมาชิกที่ซื้อไปแล้วไม่เปลี่ยน</p>
            </div>
            <Button variant="outline" onClick={() => setPlanForm({ name: '', price: '', durationDays: '30', discountPercent: '10', active: true })}>เพิ่มแพ็ก</Button>
          </div>
          {plans.length === 0 ? (
            <Empty title="ยังไม่มีแพ็กสมาชิก" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-white">
              <table className="data-table min-w-[520px]">
                <thead>
                  <tr>
                    <th>ชื่อแพ็ก</th>
                    <th className="text-right">ราคา</th>
                    <th className="text-right">จำนวนวัน</th>
                    <th className="text-right">ส่วนลดค่าโต๊ะ</th>
                    <th>สถานะ</th>
                    <th className="w-px" />
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className={p.active ? '' : 'text-ink-mute'}>
                      <td className="font-medium">{p.name}</td>
                      <td className="num text-right">{baht(p.price)}</td>
                      <td className="num text-right">{p.durationDays}</td>
                      <td className="num text-right">{p.discountPercent}%</td>
                      <td>{p.active ? <Badge tone="green">เปิดขาย</Badge> : <Badge>ปิดขาย</Badge>}</td>
                      <td>
                        <Button
                          variant="quiet"
                          size="sm"
                          className="min-h-9"
                          onClick={() => setPlanForm({ id: p.id, name: p.name, price: String(p.price), durationDays: String(p.durationDays), discountPercent: String(p.discountPercent), active: p.active })}
                        >
                          แก้ไข
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <Modal open={!!adding} onClose={() => setAdding(null)} title="เพิ่มลูกค้า">
        {adding && (
          <form onSubmit={addCustomer} className="space-y-4">
            <Field label="ชื่อลูกค้า">
              <input className="field" required maxLength={80} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
            </Field>
            <Field label="เบอร์โทร" hint="ไม่บังคับ ใช้ค้นหาตอนลูกค้ามาที่ร้าน">
              <input className="field num" type="tel" inputMode="tel" value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAdding(null)}>ยกเลิก</Button>
              <Button type="submit" busy={busy}>เพิ่มลูกค้า</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!selling} onClose={() => setSelling(null)} title={selling?.c.membership ? `ต่ออายุสมาชิก ${selling.c.name}` : `ขายสมาชิกให้ ${selling?.c.name ?? ''}`}>
        {selling && (
          <form onSubmit={sell} className="space-y-4">
            <Field label="แพ็กสมาชิก">
              <select className="field" required value={selling.planId} onChange={(e) => setSelling({ ...selling, planId: e.target.value })}>
                {activePlans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {baht(p.price)} · {p.durationDays} วัน · ลด {p.discountPercent}%</option>
                ))}
              </select>
            </Field>
            <Field label="ชำระด้วย">
              <select className="field" value={selling.method} onChange={(e) => setSelling({ ...selling, method: e.target.value })}>
                {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {sellPlan && sellEnds && (
              <div className="rounded-lg bg-mist px-3 py-2 text-sm">
                {renewFrom ? (
                  <p>ต่ออายุนับต่อจากวันหมดอายุเดิม <span className="num">{thDate(renewFrom)}</span> ไม่เสียวันที่เหลือ</p>
                ) : (
                  <p>เริ่มใช้ได้ทันที</p>
                )}
                <p>ใช้ได้ถึง <span className="num font-medium">{thDate(sellEnds)}</span> · เก็บเงิน <span className="num font-medium">{baht(sellPlan.price)}</span></p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setSelling(null)}>ยกเลิก</Button>
              <Button type="submit" busy={busy} disabled={!selling.planId}>{selling.c.membership ? 'ต่ออายุ' : 'ขายสมาชิก'}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!planForm} onClose={() => setPlanForm(null)} title={planForm?.id ? 'แก้ไขแพ็กสมาชิก' : 'เพิ่มแพ็กสมาชิก'}>
        {planForm && (
          <form onSubmit={savePlan} className="space-y-4">
            <Field label="ชื่อแพ็ก">
              <input className="field" required maxLength={60} value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} placeholder="เช่น รายเดือน" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="ราคา (บาท)">
                <input className="field num" type="number" inputMode="numeric" min={0} step={1} required value={planForm.price} onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })} />
              </Field>
              <Field label="จำนวนวัน">
                <input className="field num" type="number" inputMode="numeric" min={1} max={3660} step={1} required value={planForm.durationDays} onChange={(e) => setPlanForm({ ...planForm, durationDays: e.target.value })} />
              </Field>
              <Field label="ส่วนลด %">
                <input className="field num" type="number" inputMode="numeric" min={0} max={100} step={1} required value={planForm.discountPercent} onChange={(e) => setPlanForm({ ...planForm, discountPercent: e.target.value })} />
              </Field>
            </div>
            <Toggle checked={planForm.active} onChange={(v) => setPlanForm({ ...planForm, active: v })} label="เปิดขาย" />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPlanForm(null)}>ยกเลิก</Button>
              <Button type="submit" busy={busy}>{planForm.id ? 'บันทึก' : 'เพิ่มแพ็ก'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
