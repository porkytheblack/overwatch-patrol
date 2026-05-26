/**
 * Outbound flow: bridge `incident.opened` → wait up to 120s for `clip.ready`
 * → render the Telegram message and dispatch to every enabled subscriber.
 *
 * Implemented as Station signals so retries and visibility come for free.
 */
import TelegramBot from 'node-telegram-bot-api';
import { eq } from 'drizzle-orm';
import { schema, relativeTime, signDeepLink } from '@overwatch/shared-ts';
import { IncidentOpened, ClipReady } from '@overwatch/schemas';
import { db } from './db.js';
import { ENV } from './env.js';
import { log } from './log.js';

const CLIP_WAIT_MS = 120_000;

interface PendingNotice {
  incident_id: string;
  opened_at: string;
  classes: string[];
  waypoint_id: string;
  deadline: number;
}

const pending = new Map<string, PendingNotice>();

let bot: TelegramBot | null = null;

export function setBot(b: TelegramBot | null) {
  bot = b;
}

export function onIncidentOpened(evt: IncidentOpened) {
  pending.set(evt.incident_id, {
    incident_id: evt.incident_id,
    opened_at: evt.opened_at,
    classes: evt.classes,
    waypoint_id: evt.waypoint_id,
    deadline: Date.now() + CLIP_WAIT_MS,
  });
  // Fallback timer: if clip never arrives, dispatch anyway.
  setTimeout(() => {
    if (pending.has(evt.incident_id)) {
      log.info('notify.timeout', { incident_id: evt.incident_id });
      dispatch(evt.incident_id).catch((e) =>
        log.error('notify.timeout.error', { error: String(e) }),
      );
    }
  }, CLIP_WAIT_MS);
}

export function onClipReady(evt: ClipReady) {
  if (!pending.has(evt.incident_id)) return;
  log.info('notify.clip_ready', { incident_id: evt.incident_id });
  dispatch(evt.incident_id).catch((e) =>
    log.error('notify.dispatch.error', { error: String(e) }),
  );
}

async function dispatch(incident_id: string) {
  const notice = pending.get(incident_id);
  if (!notice) return;
  pending.delete(incident_id);
  if (!bot) {
    log.warn('notify.no_bot', { incident_id });
    return;
  }

  const incident = db
    .select({ i: schema.incidents, waypoint_name: schema.waypoints.name })
    .from(schema.incidents)
    .leftJoin(schema.waypoints, eq(schema.waypoints.id, schema.incidents.waypoint_id))
    .where(eq(schema.incidents.id, incident_id))
    .get();
  if (!incident) {
    log.warn('notify.no_incident', { incident_id });
    return;
  }

  const subs = db.select().from(schema.subscribers).where(eq(schema.subscribers.enabled, 1)).all();
  if (subs.length === 0) {
    log.info('notify.no_subscribers');
    return;
  }

  const token = signDeepLink(incident_id, ENV.DEEP_LINK_SECRET, ENV.DEEP_LINK_TTL_HOURS);
  const playback_url = `${ENV.DASHBOARD_BASE_URL}/incidents/${incident_id}/playback?token=${encodeURIComponent(token)}`;
  const wp = incident.waypoint_name ?? '—';
  const summary = incident.i.summary ?? (incident.i.clip_path ? '' : 'Recording…');
  const body =
    `[OVERWATCH PATROL] · ${wp}\n` +
    `${notice.classes.join(', ')} detected · ${relativeTime(notice.opened_at)}\n` +
    `${summary || ''}`.trimEnd();

  for (const sub of subs.filter((s) => s.channel === 'telegram')) {
    try {
      if (incident.i.poster_path) {
        await bot.sendPhoto(sub.handle, incident.i.poster_path, {
          caption: body,
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'View', url: playback_url },
                { text: 'Acknowledge', callback_data: `ack:${incident_id}` },
              ],
            ],
          },
        });
      } else {
        await bot.sendMessage(sub.handle, body, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'View', url: playback_url },
                { text: 'Acknowledge', callback_data: `ack:${incident_id}` },
              ],
            ],
          },
        });
      }
      log.info('notify.sent', { incident_id, handle: sub.handle });
    } catch (e) {
      log.error('notify.send_error', { incident_id, handle: sub.handle, error: String(e) });
    }
  }
}
