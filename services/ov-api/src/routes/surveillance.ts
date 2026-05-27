/**
 * Surveillance control routes.
 *
 * Thin proxies over the robot's dimos MCP server. The dashboard uses
 * these for the START/STOP/PAUSE/RESUME patrol buttons (spec DoD
 * step 5). The Telegram agent has its own MCP path; this duplication is
 * intentional — keeping ov-api as the single source of truth for the
 * browser means no MCP creds or URLs leak to the client.
 */
import { Hono } from 'hono';
import { newId } from '@overwatch/shared-ts';
import { ENV } from '../env.js';
import { requireAuth } from '../middleware.js';
import { log } from '../log.js';

const app = new Hono();

interface McpToolCallResult {
  result?: { content?: Array<{ text?: string }>; isError?: boolean };
  error?: { message?: string };
}

async function callMcp(name: string, args: Record<string, unknown> = {}): Promise<{
  ok: boolean;
  text: string;
  status: number;
}> {
  let res: Response;
  try {
    res = await fetch(ENV.MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: newId(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
  } catch (e) {
    log.warn('mcp.unreachable', { name, err: String(e) });
    return { ok: false, text: 'robot unreachable', status: 502 };
  }
  if (!res.ok) {
    return { ok: false, text: `mcp ${res.status}`, status: 502 };
  }
  const body = (await res.json()) as McpToolCallResult;
  if (body.error?.message) {
    return { ok: false, text: body.error.message, status: 502 };
  }
  const text =
    body.result?.content
      ?.map((c) => c.text)
      .filter(Boolean)
      .join(' ') ?? 'ok';
  return { ok: !body.result?.isError, text: text.slice(0, 400), status: 200 };
}

async function handleAction(c: any, name: string) {
  const r = await callMcp(name);
  if (!r.ok) return c.json({ error: r.text }, r.status as 200 | 502);
  return c.json({ ok: true, message: r.text });
}

app.post('/start', requireAuth, (c) => handleAction(c, 'start_surveillance'));
app.post('/stop', requireAuth, (c) => handleAction(c, 'stop_surveillance'));
app.post('/pause', requireAuth, (c) => handleAction(c, 'pause_patrol'));
app.post('/resume', requireAuth, (c) => handleAction(c, 'resume_patrol'));

app.get('/state', requireAuth, async (c) => {
  const r = await callMcp('get_robot_state');
  if (!r.ok) return c.json({ error: r.text }, r.status as 200 | 502);
  // The skill returns a JSON string; pass it through as-is so the client
  // can render whatever the robot reports today.
  try {
    return c.json(JSON.parse(r.text));
  } catch {
    return c.json({ raw: r.text });
  }
});

export default app;
