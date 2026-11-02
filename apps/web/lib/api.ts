/** Same-origin API client: Next rewrites /api → NestJS, so the session cookie just works. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

const SHOP_KEY = 'cue.platformShopId';

/** Platform admins act on one shop at a time (sent as x-shop-id). */
export function getActingShop(): string | null {
  try {
    return localStorage.getItem(SHOP_KEY);
  } catch {
    return null;
  }
}
export function setActingShop(id: string | null) {
  try {
    if (id) localStorage.setItem(SHOP_KEY, id);
    else localStorage.removeItem(SHOP_KEY);
  } catch {
    /* storage blocked: admin will be asked to pick again */
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const shop = typeof window !== 'undefined' ? getActingShop() : null;
  if (shop && !headers.has('x-shop-id')) headers.set('x-shop-id', shop);
  const res = await fetch(`/api${path}`, { ...init, headers, body, credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) {
    let msg = `เกิดข้อผิดพลาด (${res.status})`;
    let data: unknown;
    try {
      const j = await res.json();
      data = j;
      msg = Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? msg);
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/') && !path.startsWith('/public/')) {
      window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }
    throw new ApiError(res.status, msg, data);
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : (res.text() as unknown)) as Promise<T>;
}

/** Server components fetch the API directly. */
export async function serverApi<T>(path: string): Promise<T | null> {
  const origin = process.env.API_ORIGIN ?? 'http://localhost:3001';
  const res = await fetch(`${origin}/api${path}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}
