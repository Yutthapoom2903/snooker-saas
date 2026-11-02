'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ROLE, thDate } from '@/lib/format';
import { useMe } from '@/lib/session';
import { useToast } from '@/components/toast';
import { Badge, Button, Empty, Field, Modal, PageHead, Toggle } from '@/components/ui';

interface User { id: string; email: string; name: string; role: 'SHOP_OWNER' | 'SHOP_STAFF'; active: boolean; createdAt: string }
type ShopRole = User['role'];

export default function UsersPage() {
  const me = useMe();
  const toast = useToast();
  const [rows, setRows] = useState<User[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [adding, setAdding] = useState<{ email: string; name: string; password: string; role: ShopRole } | null>(null);
  const [resetting, setResetting] = useState<{ u: User; password: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<User[]>('/shop/users')
      .then(setRows)
      .catch((e: ApiError) => (e.status === 403 ? setDenied(true) : toast(e.message, 'error')));
  }, [toast]);
  useEffect(load, [load]);

  async function patch(u: User, body: Partial<{ active: boolean; role: ShopRole; password: string }>, done: string) {
    setBusy(u.id);
    try {
      await api(`/shop/users/${u.id}`, { method: 'PATCH', json: body });
      toast(done);
      load();
      return true;
    } catch (err) {
      toast((err as Error).message, 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding) return;
    if (adding.password.length < 8) return toast('รหัสผ่านอย่างน้อย 8 ตัว', 'error');
    setBusy('add');
    try {
      await api('/shop/users', { method: 'POST', json: adding });
      toast('เพิ่มผู้ใช้แล้ว');
      setAdding(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetting) return;
    if (resetting.password.length < 8) return toast('รหัสผ่านอย่างน้อย 8 ตัว', 'error');
    if (await patch(resetting.u, { password: resetting.password }, 'ตั้งรหัสผ่านใหม่แล้ว')) setResetting(null);
  }

  if (denied) return <Empty title="ไม่มีสิทธิ์ใช้งานส่วนนี้">เฉพาะเจ้าของร้านจัดการผู้ใช้งานได้</Empty>;

  return (
    <div className="max-w-4xl">
      <PageHead title="ผู้ใช้งาน" sub="พนักงานใช้หน้าโต๊ะ การจอง เช็คอิน และสมาชิกได้ เจ้าของร้านเข้าได้ทุกหน้า">
        <Button onClick={() => setAdding({ email: '', name: '', password: '', role: 'SHOP_STAFF' })}>เพิ่มผู้ใช้</Button>
      </PageHead>

      {!rows ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : rows.length === 0 ? (
        <Empty title="ยังไม่มีผู้ใช้" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>สิทธิ์</th>
                <th>เปิดใช้งาน</th>
                <th>เพิ่มเมื่อ</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id} className={u.active ? '' : 'text-ink-mute'}>
                    <td>
                      <p className="font-medium">
                        {u.name}
                        {self && <span className="ml-1.5"><Badge tone="green">คุณ</Badge></span>}
                      </p>
                      <p className="text-xs text-ink-mute break-all">{u.email}</p>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`role-${u.id}`}>สิทธิ์ของ {u.name}</label>
                      <select
                        id={`role-${u.id}`}
                        className="field min-w-[8rem] py-1.5"
                        value={u.role}
                        disabled={self || busy === u.id}
                        title={self ? 'เปลี่ยนสิทธิ์ของตัวเองไม่ได้' : undefined}
                        onChange={(e) => patch(u, { role: e.target.value as ShopRole }, 'เปลี่ยนสิทธิ์แล้ว')}
                      >
                        <option value="SHOP_STAFF">{ROLE.SHOP_STAFF}</option>
                        <option value="SHOP_OWNER">{ROLE.SHOP_OWNER}</option>
                      </select>
                    </td>
                    <td>
                      {self ? (
                        <span className="text-xs text-ink-mute">ปิดบัญชีตัวเองไม่ได้</span>
                      ) : (
                        <Toggle checked={u.active} onChange={(v) => patch(u, { active: v }, v ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว')} label={u.active ? 'เปิด' : 'ปิด'} />
                      )}
                    </td>
                    <td className="num whitespace-nowrap">{thDate(u.createdAt)}</td>
                    <td>
                      <Button variant="quiet" size="sm" className="min-h-9 whitespace-nowrap" onClick={() => setResetting({ u, password: '' })}>ตั้งรหัสผ่านใหม่</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!adding} onClose={() => setAdding(null)} title="เพิ่มผู้ใช้">
        {adding && (
          <form onSubmit={add} className="space-y-4">
            <Field label="ชื่อ">
              <input className="field" required value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
            </Field>
            <Field label="อีเมล" hint="ใช้เข้าสู่ระบบ">
              <input className="field" type="email" required autoComplete="off" value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} />
            </Field>
            <Field label="รหัสผ่าน" hint="อย่างน้อย 8 ตัว แจ้งผู้ใช้ให้เปลี่ยนเองภายหลังได้">
              <input className="field" type="text" required minLength={8} autoComplete="new-password" value={adding.password} onChange={(e) => setAdding({ ...adding, password: e.target.value })} />
            </Field>
            <Field label="สิทธิ์">
              <select className="field" value={adding.role} onChange={(e) => setAdding({ ...adding, role: e.target.value as ShopRole })}>
                <option value="SHOP_STAFF">{ROLE.SHOP_STAFF}</option>
                <option value="SHOP_OWNER">{ROLE.SHOP_OWNER}</option>
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAdding(null)}>ยกเลิก</Button>
              <Button type="submit" busy={busy === 'add'}>เพิ่มผู้ใช้</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!resetting} onClose={() => setResetting(null)} title={`ตั้งรหัสผ่านใหม่ให้ ${resetting?.u.name ?? ''}`}>
        {resetting && (
          <form onSubmit={reset} className="space-y-4">
            <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัว รหัสเดิมจะใช้ไม่ได้ทันที">
              <input className="field" type="text" required minLength={8} autoComplete="new-password" value={resetting.password} onChange={(e) => setResetting({ ...resetting, password: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setResetting(null)}>ยกเลิก</Button>
              <Button type="submit" busy={busy === resetting.u.id}>ตั้งรหัสผ่านใหม่</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
