export const API_BASE =
  typeof window === 'undefined'
    ? (process.env.OV_API_URL ?? 'http://ov-api:3000')
    : '';

/**
 * Browser-side URL for direct connections to ov-api (WebSocket and
 * other long-lived streams that Next.js's `rewrites()` proxy buffers
 * or can't upgrade).
 *
 * Resolves at runtime in the browser; falls back to the same hostname
 * on port 3000, which matches the dev-host + docker-compose defaults
 * documented in .env.example. Override with `NEXT_PUBLIC_OV_API_URL`
 * for production behind Caddy.
 */
export function browserApiBase(): string {
  if (typeof window === 'undefined') return '';
  const fromEnv = process.env.NEXT_PUBLIC_OV_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

/** WebSocket URL for the events firehose. */
export function eventsWsUrl(path = '/ws'): string {
  if (typeof window === 'undefined') return '';
  const base = browserApiBase();
  // http(s) → ws(s)
  return base.replace(/^http/, 'ws') + path;
}

/**
 * Fetch wrapper that works in both browser and Server Components.
 *
 * In the browser, `credentials: 'include'` sends the session cookie
 * directly. In a Server Component we have to *forward* the inbound
 * request cookies into the outbound fetch — `credentials: 'include'`
 * alone has no effect server-side because there's no cookie jar.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isServer = typeof window === 'undefined';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  if (isServer) {
    // Dynamic import keeps this file usable from Client Components too —
    // `next/headers` only resolves inside the Server Component runtime.
    try {
      const { cookies } = await import('next/headers');
      const store = cookies();
      const all = store.getAll();
      if (all.length > 0 && !headers['Cookie']) {
        headers['Cookie'] = all.map((c) => `${c.name}=${c.value}`).join('; ');
      }
    } catch {
      // Outside a Server Component (e.g. plain Node) — nothing to forward.
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`api ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}
