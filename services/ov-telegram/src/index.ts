/**
 * Telegram bot service.
 *
 * Token is loaded from `bot_configs.telegram` in SQLite (set via the dashboard).
 * Bridge events drive outbound notifications; inbound messages drive the agent.
 */
import TelegramBot from 'node-telegram-bot-api';
import { eq } from 'drizzle-orm';
import { schema, nowIso, signDeepLink } from '@overwatch/shared-ts';
import { db } from './db.js';
import { ENV } from './env.js';
import { log } from './log.js';
import { ConfigWatcher } from './config-watcher.js';
import { BridgeWs } from './bridge-ws.js';
import { onIncidentOpened, onClipReady, setBot } from './notifications.js';
import { handleMessage } from './agent.js';

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

function start(token: string) {
  stop();
  bot = new TelegramBot(token, { polling: true });
  pollingHandle = bot;
  setBot(bot);

  bot.on('message', async (msg) => {
    if (!msg.text || !msg.chat?.id) return;
    const handle = String(msg.chat.id);
    log.info('tg.message', { handle, text: msg.text.slice(0, 120) });
    try {
      const reply = await handleMessage(handle, msg.text);
      await bot!.sendMessage(handle, reply);
    } catch (e) {
      log.error('tg.error', { error: String(e) });
      await bot!.sendMessage(handle, 'error · agent failed').catch(() => undefined);
    }
  });

  bot.on('callback_query', async (q) => {
    if (!q.data || !q.message) return;
    const [action, incidentId] = q.data.split(':');
    if (action === 'ack' && incidentId) {
      try {
        const handle = q.from.username ? `@${q.from.username}` : String(q.from.id);
        db.update(schema.incidents)
          .set({
            status: 'acknowledged',
            acknowledged_at: nowIso(),
            acknowledged_by_handle: handle,
          })
          .where(eq(schema.incidents.id, incidentId))
          .run();
        await bot!.answerCallbackQuery(q.id, { text: `ACK'D by ${handle}` });
        await bot!
          .editMessageCaption(`${q.message.caption ?? ''}\n\nACK'D by ${handle} at ${nowIso()}`, {
            chat_id: q.message.chat.id,
            message_id: q.message.message_id,
          })
          .catch(() => undefined);
      } catch (e) {
        log.error('tg.ack_error', { error: String(e) });
        await bot!.answerCallbackQuery(q.id, { text: 'ack failed' });
      }
    } else if (action === 'view') {
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
});
bridge.start();

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
