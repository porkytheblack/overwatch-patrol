/**
 * MJPEG passthrough.
 *
 * Next.js `rewrites()` buffers long-lived chunked responses in dev (and
 * in `output: 'standalone'` prod builds), so the dashboard's
 * `<img src="/api/system/mjpeg">` would hang until the upstream stream
 * closed. An explicit Route Handler with `runtime: 'nodejs'` keeps the
 * Response body as a streaming `ReadableStream` so frames reach the
 * browser as ov-api produces them.
 *
 * The browser hits this same-origin URL with its dashboard session
 * cookie; we forward the inbound `Cookie` header verbatim so ov-api's
 * `requireAuth` middleware sees the same session.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.OV_API_URL ?? 'http://ov-api:3000';

export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';
  const upstream = await fetch(`${API_BASE}/api/system/mjpeg`, {
    headers: cookie ? { Cookie: cookie } : {},
    // Don't let undici buffer the chunked response.
    cache: 'no-store',
    redirect: 'manual',
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'text/plain' },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type':
        upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  });
}
