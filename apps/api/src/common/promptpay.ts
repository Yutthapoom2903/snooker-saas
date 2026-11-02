import generatePayload from 'promptpay-qr';
import { toDataURL } from 'qrcode';

/** PromptPay QR (data URL) that pre-fills the amount in the payer's banking app. */
export function promptpayQr(promptpayId: string, amount: number) {
  return toDataURL(generatePayload(promptpayId, { amount }), { margin: 1, width: 320 });
}

export function maskPromptpay(id: string) {
  const d = id.replace(/\D/g, '');
  return d.length <= 4 ? d : `${'x'.repeat(d.length - 4)}${d.slice(-4)}`;
}
