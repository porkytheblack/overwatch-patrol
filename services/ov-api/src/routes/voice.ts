/**
 * ElevenLabs short-lived voice token routes.
 *
 * The dashboard's push-to-talk panel needs a single-use token for the
 * browser-side WebSocket to ElevenLabs (so the operator's mic and the
 * playback voice never touch our backend). We mint the token here and
 * return it to the client; the long-lived xi-api-key never leaves the
 * server.
 *
 * Shape ported from glove-next's `createVoiceTokenHandler`
 * (`/tmp/glove-next-inspect/package/dist/index.js` lines ~351–435).
 */
import { Hono } from 'hono';
import { ENV } from '../env.js';
import { requireAuth } from '../middleware.js';
import { log } from '../log.js';

const app = new Hono();

type MintOk = { ok: true; token: string };
type MintErr = { ok: false; status: 502 | 503; error: string };

/**
 * Mint a single-use ElevenLabs token for either realtime STT or
 * websocket TTS. Returns a discriminated union the caller turns into a
 * JSON response.
 *
 * Status codes:
 *   503 — ELEVENLABS_API_KEY unset (operator hasn't configured voice).
 *   502 — ElevenLabs reachable but rejected the mint, or the call
 *         couldn't complete (network error, missing token in response).
 */
async function mintElevenLabsToken(
  type: 'stt' | 'tts',
): Promise<MintOk | MintErr> {
  if (!ENV.ELEVENLABS_API_KEY) {
    return {
      ok: false,
      status: 503,
      error: 'voice_offline · ELEVENLABS_API_KEY not set',
    };
  }
  const tokenType = type === 'stt' ? 'realtime_scribe' : 'tts_websocket';
  let res: Response;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/single-use-token/${tokenType}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': ENV.ELEVENLABS_API_KEY },
      },
    );
  } catch (e) {
    log.warn('voice.elevenlabs_unreachable', { type, err: String(e) });
    return { ok: false, status: 502, error: 'elevenlabs_unreachable' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.warn('voice.elevenlabs_error', {
      type,
      status: res.status,
      body: body.slice(0, 200),
    });
    return { ok: false, status: 502, error: `elevenlabs ${res.status}` };
  }
  let data: { token?: string };
  try {
    data = (await res.json()) as { token?: string };
  } catch (e) {
    log.warn('voice.elevenlabs_bad_json', { type, err: String(e) });
    return { ok: false, status: 502, error: 'elevenlabs_bad_response' };
  }
  if (!data.token) {
    return { ok: false, status: 502, error: 'elevenlabs_no_token' };
  }
  return { ok: true, token: data.token };
}

app.get('/stt-token', requireAuth, async (c) => {
  const r = await mintElevenLabsToken('stt');
  if (!r.ok) return c.json({ error: r.error }, r.status);
  return c.json({ token: r.token });
});

app.get('/tts-token', requireAuth, async (c) => {
  const r = await mintElevenLabsToken('tts');
  if (!r.ok) return c.json({ error: r.error }, r.status);
  // The voice id is non-secret and only the browser knows which voice
  // to instruct ElevenLabs to use — surfacing it here keeps the env var
  // server-only while still parameterising the client.
  return c.json({ token: r.token, voice_id: ENV.ELEVENLABS_VOICE_ID });
});

export default app;
