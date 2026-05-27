export const API_BASE =
  typeof window === 'undefined'
    ? (process.env.OV_API_URL ?? 'http://ov-api:3000')
    : '';

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
