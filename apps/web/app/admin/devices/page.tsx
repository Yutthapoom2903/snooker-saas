'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { hhmm, thDateTime } from '@/lib/format';
import { useLive } from '@/lib/live';
import { useToast } from '@/components/toast';
import { Button, Empty, Field, Modal, PageHead } from '@/components/ui';

interface Device {
  id: string;
  name: string;
  tableId: string | null;
  table: { name: string } | null;
  online: boolean;
  lastSeenAt: string | null;
  fwVersion: string | null;
  ip: string | null;
  rssi: number | null;
}
interface TableOpt { id: string; name: string; active: boolean }
interface LogLine { at: number; msg: string }
interface Creds { id: string; secret: string; rotated: boolean }

const MQTT_PORT = 1883;

/** When the admin opened the app by LAN IP, that's the host the boards need too. */
function guessLanHost() {
  if (typeof window === 'undefined') return null;
  const h = window.location.hostname;
  return /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h) ? h : null;
}

function CopyRow({ label, value, mono = true, canCopy = true }: { label: string; value: string; mono?: boolean; canCopy?: boolean }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast(`คัดลอก${label}แล้ว`);
    } catch {
      toast('คัดลอกไม่ได้ ให้เลือกข้อความแล้วคัดลอกเอง', 'error');
    }
  }
  return (
    <div className="flex items-center gap-2 border-b border-line/70 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-mute">{label}</p>
        <p className={`break-all select-all ${mono ? 'num' : ''}`}>{value}</p>
      </div>
      {canCopy && <Button type="button" variant="outline" size="sm" className="min-h-9 shrink-0" onClick={copy}>คัดลอก</Button>}
    </div>
  );
}

export default function DevicesPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Device[] | null>(null);
  const [tables, setTables] = useState<TableOpt[]>([]);
  const [denied, setDenied] = useState(false);
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [adding, setAdding] = useState<{ name: string; tableId: string } | null>(null);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [testing, setTesting] = useState<Device | null>(null);
  const [testText, setTestText] = useState('HELLO');
  const [confirm, setConfirm] = useState<{ kind: 'rotate' | 'delete'; d: Device } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lanHost, setLanHost] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Device[]>('/devices')
      .then(setRows)
      .catch((e: ApiError) => (e.status === 403 ? setDenied(true) : toast(e.message, 'error')));
  }, [toast]);
  const loadTables = useCallback(() => {
    api<TableOpt[]>('/tables').then(setTables).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    loadTables();
    setLanHost(guessLanHost());
  }, [load, loadTables]);

  useLive(['devices'], (_kind, data) => {
    const d = data as { deviceId?: string; log?: string } | undefined;
    if (d?.deviceId && d.log) {
      const { deviceId, log } = d;
      setLogs((x) => ({ ...x, [deviceId]: [{ at: Date.now(), msg: log }, ...(x[deviceId] ?? [])].slice(0, 4) }));
      return; // a log line doesn't change the device row
    }
    load();
  });

  const activeTables = tables.filter((t) => t.active);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!adding) return;
    setBusy('add');
    try {
      const r = await api<{ id: string; secret: string }>('/devices', { method: 'POST', json: { name: adding.name, tableId: adding.tableId || undefined } });
      toast('ลงทะเบียนบอร์ดแล้ว');
      setAdding(null);
      setCreds({ ...r, rotated: false });
      load();
      loadTables();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function link(d: Device, tableId: string) {
    setBusy(`link-${d.id}`);
    try {
      await api(`/devices/${d.id}`, { method: 'PATCH', json: { tableId: tableId || null } });
      toast(tableId ? 'ผูกโต๊ะแล้ว' : 'ปลดโต๊ะแล้ว');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function doConfirm() {
    if (!confirm) return;
    const { kind, d } = confirm;
    setBusy('confirm');
    try {
      if (kind === 'rotate') {
        const r = await api<{ id: string; secret: string }>(`/devices/${d.id}/rotate-secret`, { method: 'POST' });
        toast('เปลี่ยนรหัสลับแล้ว');
        setCreds({ ...r, rotated: true });
      } else {
        await api(`/devices/${d.id}`, { method: 'DELETE' });
        toast('ลบบอร์ดแล้ว');
        load();
      }
      setConfirm(null);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function sendTest(d: Device, action: 'blink' | 'relay' | 'text') {
    setBusy(`test-${action}`);
    try {
      const r = await api<{ sent: boolean; online: boolean }>(`/devices/${d.id}/test`, { method: 'POST', json: { action, text: testText } });
      toast(r.online ? 'ส่งคำสั่งแล้ว' : 'ส่งคำสั่งแล้ว แต่บอร์ดยังออฟไลน์อยู่', r.online ? 'ok' : 'error');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (denied) return <Empty title="ไม่มีสิทธิ์ใช้งานส่วนนี้">เฉพาะเจ้าของร้านจัดการบอร์ดได้</Empty>;

  const testLogs = testing ? logs[testing.id] ?? [] : [];

  return (
    <div className="max-w-5xl">
      <PageHead title="บอร์ด ESP" sub="บอร์ดประจำโต๊ะแสดงเวลาและคะแนน และเปิดปิดไฟโต๊ะ">
        <Button onClick={() => setAdding({ name: '', tableId: '' })}>ลงทะเบียนบอร์ด</Button>
      </PageHead>

      {!rows ? (
        <p className="text-ink-mute">กำลังโหลด</p>
      ) : rows.length === 0 ? (
        <Empty title="ยังไม่มีบอร์ด">ลงทะเบียนบอร์ดเพื่อรับรหัสไปตั้งค่าในตัวบอร์ด</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>บอร์ด</th>
                <th>สถานะ</th>
                <th>เฟิร์มแวร์</th>
                <th>IP</th>
                <th className="text-right">สัญญาณ</th>
                <th>โต๊ะที่ผูก</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>
                    <p className="font-medium">{d.name}</p>
                    <p className="num text-xs text-ink-mute">{d.id}</p>
                    {(logs[d.id] ?? []).slice(0, 2).map((l) => (
                      <p key={l.at} className="num mt-0.5 max-w-[16rem] truncate text-xs text-baize" title={l.msg}>
                        {hhmm(new Date(l.at))} {l.msg}
                      </p>
                    ))}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`size-2 rounded-full ${d.online ? 'bg-felt' : 'bg-ink-mute/40'}`} aria-hidden />
                      {d.online ? 'ออนไลน์' : 'ออฟไลน์'}
                    </span>
                    {d.lastSeenAt && <p className="text-xs text-ink-mute">ล่าสุด <span className="num">{thDateTime(d.lastSeenAt)}</span></p>}
                  </td>
                  <td className="num">{d.fwVersion ?? '–'}</td>
                  <td className="num">{d.ip ?? '–'}</td>
                  <td className="num text-right whitespace-nowrap">{d.rssi != null ? `${d.rssi} dBm` : '–'}</td>
                  <td>
                    <label className="sr-only" htmlFor={`tbl-${d.id}`}>โต๊ะที่ผูกกับ {d.name}</label>
                    <select
                      id={`tbl-${d.id}`}
                      className="field min-w-[8rem] py-1.5"
                      value={d.tableId ?? ''}
                      disabled={busy === `link-${d.id}`}
                      onChange={(e) => link(d, e.target.value)}
                    >
                      <option value="">ไม่ผูกโต๊ะ</option>
                      {activeTables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1 whitespace-nowrap">
                      <Button variant="quiet" size="sm" className="min-h-9" onClick={() => setTesting(d)}>ทดสอบ</Button>
                      <Button variant="quiet" size="sm" className="min-h-9" onClick={() => setConfirm({ kind: 'rotate', d })}>เปลี่ยนรหัสลับ</Button>
                      <Button variant="quiet" size="sm" className="min-h-9 text-ball-red hover:bg-[#f8e3e1]" onClick={() => setConfirm({ kind: 'delete', d })}>ลบ</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-6 rounded-xl border border-line bg-white p-5 text-sm text-ink-soft">
        <h2 className="text-base font-semibold text-ink">ยังไม่มีบอร์ดจริง</h2>
        <p className="mt-1">ลงทะเบียนบอร์ดแล้วใช้ตัวจำลองในเครื่องแทนได้ รันจากโฟลเดอร์โปรเจกต์</p>
        <pre className="num mt-2 overflow-x-auto rounded-lg bg-mist px-3 py-2 text-ink">npm run sim -- --id &lt;id&gt; --secret &lt;secret&gt;</pre>
        <p className="mt-2">วิธีต่อสาย แฟลชเฟิร์มแวร์ และเปิดไฟร์วอลล์พอร์ต <span className="num">{MQTT_PORT}</span> อยู่ใน <code className="num text-ink">hardware/README.md</code></p>
      </section>

      {/* Register */}
      <Modal open={!!adding} onClose={() => setAdding(null)} title="ลงทะเบียนบอร์ด">
        {adding && (
          <form onSubmit={register} className="space-y-4">
            <Field label="ชื่อบอร์ด" hint="เว้นว่างได้ ระบบจะใช้รหัสบอร์ดเป็นชื่อ">
              <input className="field" value={adding.name} maxLength={40} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="เช่น บอร์ดโต๊ะ 2" />
            </Field>
            <Field label="ผูกกับโต๊ะ" hint="ถ้าโต๊ะนั้นมีบอร์ดอยู่แล้ว บอร์ดเดิมจะถูกปลดออก">
              <select className="field" value={adding.tableId} onChange={(e) => setAdding({ ...adding, tableId: e.target.value })}>
                <option value="">ยังไม่ผูก</option>
                {activeTables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAdding(null)}>ยกเลิก</Button>
              <Button type="submit" busy={busy === 'add'}>ลงทะเบียนบอร์ด</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Credentials, shown once */}
      <Modal open={!!creds} onClose={() => setCreds(null)} title={creds?.rotated ? 'รหัสลับใหม่ของบอร์ด' : 'รหัสสำหรับตั้งค่าบอร์ด'} wide>
        {creds && (
          <div className="space-y-4 text-sm">
            <p className="rounded-lg border border-ball-yellow/40 bg-[#fbf1dc] px-3 py-2 text-[#8a6210]">
              รหัสลับจะแสดงครั้งเดียวเท่านั้น คัดลอกเก็บไว้ก่อนปิดหน้าต่างนี้ ถ้าทำหายต้องกดเปลี่ยนรหัสลับแล้วตั้งค่าบอร์ดใหม่
              {creds.rotated && ' รหัสเดิมใช้ไม่ได้แล้ว บอร์ดจะต่อไม่ติดจนกว่าจะใส่รหัสใหม่'}
            </p>
            <div>
              <p className="mb-1 text-ink-soft">กรอกค่าเหล่านี้ในหน้าตั้งค่าของบอร์ด (ต่อ WiFi ชื่อ SNK-Setup-xxxx แล้วเปิด 192.168.4.1)</p>
              <div className="rounded-lg border border-line px-3">
                <CopyRow label="MQTT host" value={lanHost ?? 'IP วง LAN ของเครื่อง PC ที่รันระบบ'} mono={!!lanHost} canCopy={!!lanHost} />
                <CopyRow label="MQTT port" value={String(MQTT_PORT)} />
                <CopyRow label="Device ID" value={creds.id} />
                <CopyRow label="Device secret" value={creds.secret} />
              </div>
              {!lanHost && <p className="mt-1 text-xs text-ink-mute">ดู IP ได้จาก ipconfig บน Windows ช่อง IPv4 ของการ์ด LAN หรือ WiFi</p>}
            </div>
            <div>
              <p className="mb-1 text-ink-soft">ทดสอบด้วยตัวจำลองแทนบอร์ดจริง</p>
              <pre className="num overflow-x-auto rounded-lg bg-mist px-3 py-2 text-ink">npm run sim -- --id {creds.id} --secret {creds.secret}</pre>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setCreds(null)}>เก็บรหัสแล้ว</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Test */}
      <Modal open={!!testing} onClose={() => setTesting(null)} title={`ทดสอบ${testing?.name ?? ''}`}>
        {testing && (
          <div className="space-y-4 text-sm">
            {!rows?.find((r) => r.id === testing.id)?.online && (
              <p className="text-ball-red">บอร์ดนี้ออฟไลน์ คำสั่งจะไม่ถึงบอร์ดจนกว่าจะต่อเข้ามา</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" busy={busy === 'test-blink'} onClick={() => sendTest(testing, 'blink')}>กะพริบจอ</Button>
              <Button variant="outline" busy={busy === 'test-relay'} onClick={() => sendTest(testing, 'relay')}>สลับรีเลย์ไฟโต๊ะ</Button>
            </div>
            <div className="flex items-end gap-2">
              <Field label="ข้อความบนจอ" className="flex-1">
                <input className="field num uppercase" value={testText} maxLength={32} onChange={(e) => setTestText(e.target.value)} />
              </Field>
              <Button variant="outline" busy={busy === 'test-text'} onClick={() => sendTest(testing, 'text')}>แสดงข้อความ</Button>
            </div>
            <div>
              <p className="mb-1 text-ink-soft">ข้อความตอบกลับจากบอร์ด</p>
              <div className="min-h-[4.5rem] rounded-lg border border-line bg-mist/50 px-3 py-2" aria-live="polite">
                {testLogs.length === 0 ? (
                  <p className="text-ink-mute">ยังไม่มีข้อความ</p>
                ) : (
                  testLogs.map((l) => (
                    <p key={l.at} className="num break-all">
                      <span className="text-ink-mute">{hhmm(new Date(l.at))}</span> {l.msg}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Rotate / delete confirm */}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.kind === 'rotate' ? 'เปลี่ยนรหัสลับ' : 'ลบบอร์ด'}>
        {confirm && (
          <>
            <p className="text-sm text-ink-soft">
              {confirm.kind === 'rotate'
                ? `รหัสลับเดิมของ ${confirm.d.name} จะใช้ไม่ได้ทันที ต้องนำรหัสใหม่ไปตั้งค่าในบอร์ดอีกครั้ง`
                : `ลบ ${confirm.d.name} ออกจากร้าน บอร์ดนี้จะต่อเข้าระบบไม่ได้อีก`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)}>ยกเลิก</Button>
              <Button variant={confirm.kind === 'delete' ? 'danger' : 'primary'} busy={busy === 'confirm'} onClick={doConfirm}>
                {confirm.kind === 'rotate' ? 'เปลี่ยนรหัสลับ' : 'ลบ'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
