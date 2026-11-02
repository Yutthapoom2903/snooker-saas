import { createHmac, timingSafeEqual } from 'crypto';

/**
 * QR content for a booking: "SNK1.<bookingId>.<sig>". The signature binds the
 * booking id to the server secret so a QR cannot be forged or guessed; whether
 * it is still usable is decided by the booking's status and time window.
 */
const PREFIX = 'SNK1';

function sig(bookingId: string) {
  return createHmac('sha256', process.env.QR_SECRET ?? 'dev-qr-secret').update(bookingId).digest('base64url').slice(0, 22);
}

export function signBookingQr(bookingId: string) {
  return `${PREFIX}.${bookingId}.${sig(bookingId)}`;
}

export function verifyBookingQr(raw: string): string | null {
  const parts = raw.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, id, given] = parts;
  const expected = sig(id);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}
