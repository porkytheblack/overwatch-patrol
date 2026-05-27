/**
 * Telegram bot service.
 *
 * Token is loaded from `bot_configs.telegram` in SQLite (set via the dashboard).
 * Bridge events drive outbound notifications; inbound messages drive the agent.
 *
 * First-run linking (spec §11 extension):
 *   - Operator opens dashboard → Settings → Telegram, sees the claim-code
 *     instructions. They send `/start` to the bot; we mint a 6-char code
 *     and reply with it. They paste it into the dashboard's claim form,
 *     which POSTs to /api/subscribers/claim.
 */
import { createServer } from 'node:http';
import TelegramBot from 'node-telegram-bot-api';
import { eq } from 'drizzle-orm';
import { schema, newId, nowIso, signDeepLink } from '@overwatch/shared-ts';
import { ENV } from './env.js';
import { log } from './log.js';
import { ConfigWatcher } from './config-watcher.js';
import { BridgeWs } from './bridge-ws.js';
import { onIncidentOpened, onClipReady, onRobotStateChanged, setBot } from './notifications.js';
import { handleMessage } from './agent.js';
import { issueClaimCode, purgeExpiredCodes } from './claim.js';
import { db } from './db.js';

let bot: TelegramBot | null = null;
let pollingHandle: TelegramBot | null = null;

function stop() {
  if (pollingHandle) {
    pollingHandle.stopPolling().catch(() => undefined);
    pollingHandle = null;
  }
  bot = null;
  setBot(null);
}

/** Acknowledge an incident through the robot's MCP server (spec §7.7 line 745). */
async function ackViaMcp(incidentId: string, userHandle: string): Promise<boolean> {
  try {
    const res = await fetch(ENV.MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: newId(),
        method: 'tools/call',
        params: {
          name: 'acknowledge_incident',
          arguments: { incident_id: incidentId, user_handle: userHandle },
        },
      }),
    });
    return res.ok;
  } catch (e) {
    log.error('tg.ack_mcp_error', { error: String(e) });
    return false;
  }
}

/** Persist the bot's @username back into bot_configs so the dashboard
 *  can render "search @YourBotUsername" in the claim instructions. */
async function persistBotIdentity(b: TelegramBot): Promise<void> {
  try {
    const me = await b.getMe();
    if (!me.username) return;
    const row = db
      .select()
      .from(schema.botConfigs)
      .where(eq(schema.botConfigs.channel, 'telegram'))
      .get();
    if (!row) return;
    const cfg = JSON.parse(row.config) as Record<string, unknown>;
    if (cfg.bot_username === me.username) return;
    cfg.bot_username = me.username;
    db.update(schema.botConfigs)
      .set({ config: JSON.stringify(cfg) })
      .where(eq(schema.botConfigs.channel, 'telegram'))
      .run();
    log.info('tg.username_persisted', { username: me.username });
  } catch (e) {
    log.warn('tg.username_persist_failed', { error: String(e) });
  }
}

function isStartCommand(text: string): boolean {
  // `/start` or `/start anything-after`. Telegram also passes `/start@MyBot`
  // when the user is in a group — accept either.
  return /^\/start(@\S+)?(\s|$)/i.test(text);
}

/**
 * Run `fn` while pulsing the Telegram "typing…" chat action so the operator
 * sees the bot is doing work rather than staring at an unanswered message.
 *
 * Telegram's typing indicator auto-expires ~5s after the last `sendChatAction`,
 * so we fire one immediately and then again every 4s until `fn` resolves or
 * throws. Failures from `sendChatAction` (rate limit, network blip) are
 * swallowed — the indicator is cosmetic; we don't want to mask the real
 * error from `fn`.
 */
async function withTyping<T>(
  b: TelegramBot,
  chat_id: string,
  fn: () => Promise<T>,
): Promise<T> {
  const send = () =>
    b.sendChatAction(chat_id, 'typing').catch(() => undefined);
  void send();
  const interval = setInterval(send, 4000);
  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}

async function handleStart(b: TelegramBot, chat_id: string, chat_handle: string | null) {
  // Best-effort GC so the table stays small.
  try {
    purgeExpiredCodes();
  } catch (e) {
    log.warn('claim.purge_failed', { error: String(e) });
  }
  const issued = issueClaimCode(chat_id, chat_handle ?? undefined);
  const expiresMins = Math.max(
    1,
    Math.round((new Date(issued.expires_at).getTime() - Date.now()) / 60_000),
  );
  const body =
    `OVERWATCH PATROL · LINKING\n\n` +
    `Your claim code: ${issued.code}\n` +
    `Expires in ~${expiresMins} min\n\n` +
    `Paste this into the dashboard:\n` +
    `Settings → Subscribers → "I have a claim code"\n` +
    `Once linked, this chat will receive incident alerts and accept commands.`;
  await b.sendMessage(chat_id, body);
  log.info('tg.claim_issued', { chat_id, code: issued.code, reused: issued.reused });
}

function start(token: string) {
  stop();
  bot = new TelegramBot(token, { polling: true });
  pollingHandle = bot;
  setBot(bot);

  // Fire-and-forget: cache the @username back in bot_configs.
  persistBotIdentity(bot).catch((e) =>
    log.warn('tg.persist_identity_failed', { error: String(e) }),
  );

  bot.on('message', async (msg) => {
    if (!msg.text || !msg.chat?.id) return;
    const chat_id = String(msg.chat.id);
    const chat_handle = msg.from?.username ?? null;

    if (isStartCommand(msg.text)) {
      try {
        await withTyping(bot!, chat_id, () =>
          handleStart(bot!, chat_id, chat_handle),
        );
      } catch (e) {
        log.error('tg.start_error', { error: String(e) });
        await bot!
          .sendMessage(chat_id, 'error · could not generate claim code')
          .catch(() => undefined);
      }
      return;
    }

    log.info('tg.message', { chat_id, text: msg.text.slice(0, 120) });
    try {
      // Pulse "typing…" the whole time the agent is composing — LLM round-
      // trips + MCP tool calls can take several seconds.
      const reply = await withTyping(bot!, chat_id, () =>
        handleMessage(chat_id, msg.text!),
      );
      await bot!.sendMessage(chat_id, reply);
    } catch (e) {
      log.error('tg.error', { error: String(e) });
      await bot!.sendMessage(chat_id, 'error · agent failed').catch(() => undefined);
    }
  });

  bot.on('callback_query', async (q) => {
    if (!q.data || !q.message) return;
    const [action, incidentId] = q.data.split(':');
    if (action === 'ack' && incidentId) {
      const handle = q.from.username ? `@${q.from.username}` : String(q.from.id);
      const ok = await ackViaMcp(incidentId, handle);
      if (ok) {
        await bot!.answerCallbackQuery(q.id, { text: `ACK'D by ${handle}` });
        await bot!
          .editMessageCaption(
            `${q.message.caption ?? ''}\n\nACK'D by ${handle} at ${nowIso()}`,
            { chat_id: q.message.chat.id, message_id: q.message.message_id },
          )
          .catch(() => undefined);
      } else {
        await bot!.answerCallbackQuery(q.id, { text: 'ack failed' });
      }
    } else if (action === 'view' && incidentId) {
      const token = signDeepLink(incidentId, ENV.DEEP_LINK_SECRET, ENV.DEEP_LINK_TTL_HOURS);
      await bot!.answerCallbackQuery(q.id, {
        url: `${ENV.DASHBOARD_BASE_URL}/incidents/${incidentId}/playback?token=${encodeURIComponent(token)}`,
      });
    }
  });

  bot.on('polling_error', (e) => log.warn('tg.polling_error', { error: String(e) }));
  log.info('tg.started');
}

const watcher = new ConfigWatcher();
watcher.onChange((token, enabled) => {
  if (enabled && token) start(token);
  else stop();
});
watcher.start();

const bridge = new BridgeWs(ENV.BRIDGE_WS_URL);
bridge.on((evt) => {
  if (evt.type === 'incident.opened') onIncidentOpened(evt);
  else if (evt.type === 'clip.ready') onClipReady(evt);
  else if (evt.type === 'robot.state_changed') onRobotStateChanged(evt);
});
bridge.start();

// Health probe (spec §15 DoD: "All services have /health")
const healthPort = Number(process.env.HEALTH_PORT ?? 7100);
createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', telegram_active: !!bot }));
  } else {
    res.writeHead(404).end();
  }
}).listen(healthPort, () => log.info('telegram.health_ready', { port: healthPort }));

process.on('SIGTERM', () => {
  watcher.stop();
  stop();
  process.exit(0);
});
process.on('SIGINT', () => {
  watcher.stop();
  stop();
  process.exit(0);
});

log.info('telegram.ready');
