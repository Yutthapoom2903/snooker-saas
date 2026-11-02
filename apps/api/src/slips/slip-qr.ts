import { readFileSync } from 'fs';
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/**
 * Thai bank slips carry a "mini QR" (EMVCo-style TLV), e.g.
 *   00 41 [00 06 000001][01 03 004][02 20 <transRef>]  51 02 TH  91 04 <crc>
 * Tag 00 holds the API id, sending bank code (01) and transaction ref (02).
 */
export interface SlipQr {
  payload: string;
  transRef: string | null;
  bankCode: string | null;
}

function tlv(s: string): Map<string, string> | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) return null;
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || i + 4 + len > s.length) return null;
    out.set(tag, s.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

export function parseSlipPayload(payload: string): SlipQr {
  const top = tlv(payload.trim());
  const inner = top?.get('00') ? tlv(top.get('00')!) : null;
  return {
    payload: payload.trim(),
    transRef: inner?.get('02')?.trim() || null,
    bankCode: inner?.get('01') ?? null,
  };
}

/** Decode the QR in a slip image (PNG/JPEG). Returns null when there is none or the format isn't supported. */
export function readSlipQr(filePath: string): SlipQr | null {
  try {
    const buf = readFileSync(filePath);
    let img: { width: number; height: number; data: Uint8Array | Buffer };
    if (buf[0] === 0x89 && buf[1] === 0x50) img = PNG.sync.read(buf);
    else if (buf[0] === 0xff && buf[1] === 0xd8) img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256, maxResolutionInMP: 60 });
    else return null; // WEBP etc.: staff check by eye
    const code = jsQR(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height);
    return code?.data ? parseSlipPayload(code.data) : null;
  } catch {
    return null;
  }
}
