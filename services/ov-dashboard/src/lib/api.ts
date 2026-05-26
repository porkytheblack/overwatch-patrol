export const API_BASE =
  typeof window === 'undefined'
    ? (process.env.OV_API_URL ?? 'http://ov-api:3000')
    : '';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`api ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}
