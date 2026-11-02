import { Logger } from '@nestjs/common';
import type { VerifiedSlip } from './slip-rules';

export type ProviderResult =
  | { kind: 'ok'; slip: VerifiedSlip }
  | { kind: 'rejected'; reason: string } // the bank/provider says this slip is not valid
  | { kind: 'unavailable'; reason: string }; // couldn't check (network, quota, pending) → fall back to staff

const log = new Logger('SlipVerify');
const TIMEOUT_MS = 10000;

async function call(url: string, init: RequestInit) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/** EasySlip v1 — GET /v1/verify?payload=… (docs: document.easyslip.com/en/v1/verify/bank/payload) */
async function easyslip(apiKey: string, payload: string): Promise<ProviderResult> {
  try {
    const res = await call(`https://api.easyslip.com/v1/verify?payload=${encodeURIComponent(payload)}&checkDuplicate=true`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = (await res.json().catch(() => ({}))) as { status?: number; message?: string; data?: Record<string, any> };
    if (res.ok && body.data) {
      const d = body.data;
      const recv = d.receiver?.account ?? {};
      return {
        kind: 'ok',
        slip: {
          transRef: String(d.transRef ?? ''),
          amount: Number(d.amount?.amount ?? 0),
          paidAt: d.date ? new Date(d.date) : null,
          receiverValues: [recv.bank?.account, recv.proxy?.account].filter(Boolean).map(String),
        },
      };
    }
    const msg = body.message ?? `HTTP ${res.status}`;
    if (msg === 'duplicate_slip') return { kind: 'rejected', reason: 'สลิปนี้เคยถูกใช้แล้ว' };
    if (msg === 'slip_not_found' || msg === 'invalid_payload') return { kind: 'rejected', reason: 'ธนาคารไม่พบรายการนี้ (สลิปอาจปลอม)' };
    return { kind: 'unavailable', reason: msg === 'slip_pending' ? 'ธนาคารยังไม่ยืนยันรายการ' : `ตรวจสลิปไม่ได้ (${msg})` };
  } catch (e) {
    log.warn(`easyslip: ${(e as Error).message}`);
    return { kind: 'unavailable', reason: 'ติดต่อบริการตรวจสลิปไม่ได้' };
  }
}

/** SlipOK — POST /api/line/apikey/<branchId> with x-authorization (SlipOK API guide v1.12). */
async function slipok(apiKey: string, branchId: string, payload: string): Promise<ProviderResult> {
  try {
    const res = await call(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(branchId)}`, {
      method: 'POST',
      headers: { 'x-authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: payload, log: true }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; code?: number; message?: string; data?: Record<string, any> };
    if (body.success && body.data) {
      const d = body.data;
      return {
        kind: 'ok',
        slip: {
          transRef: String(d.transRef ?? ''),
          amount: Number(d.amount ?? 0),
          paidAt: d.transTimestamp ? new Date(d.transTimestamp) : null,
          receiverValues: [d.receiver?.account?.value, d.receiver?.proxy?.value].filter(Boolean).map(String),
        },
      };
    }
    const code = body.code ?? 0;
    if (code === 1012) return { kind: 'rejected', reason: 'สลิปนี้เคยถูกใช้แล้ว' };
    if (code === 1014) return { kind: 'rejected', reason: 'บัญชีผู้รับไม่ใช่บัญชีของร้าน' };
    if (code === 1007 || code === 1008 || code === 1011) return { kind: 'rejected', reason: 'ธนาคารไม่พบรายการนี้ (สลิปอาจปลอมหรือหมดอายุ)' };
    return { kind: 'unavailable', reason: code === 1010 ? 'ธนาคารยังไม่ยืนยันรายการ' : `ตรวจสลิปไม่ได้ (${body.message ?? `HTTP ${res.status}`})` };
  } catch (e) {
    log.warn(`slipok: ${(e as Error).message}`);
    return { kind: 'unavailable', reason: 'ติดต่อบริการตรวจสลิปไม่ได้' };
  }
}

export function verifyWithProvider(
  shop: { slipProvider: string; slipApiKey: string | null; slipOkBranchId: string | null },
  payload: string,
): Promise<ProviderResult> | null {
  if (!shop.slipApiKey) return null;
  if (shop.slipProvider === 'easyslip') return easyslip(shop.slipApiKey, payload);
  if (shop.slipProvider === 'slipok' && shop.slipOkBranchId) return slipok(shop.slipApiKey, shop.slipOkBranchId, payload);
  return null;
}
