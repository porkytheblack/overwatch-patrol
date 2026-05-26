import { eq } from 'drizzle-orm';
import { schema } from '@overwatch/shared-ts';
import { db } from './db.js';
import { log } from './log.js';

/** Tail bot_configs.telegram, hot-reload when the token changes. */
export class ConfigWatcher {
  private lastToken: string | null = null;
  private enabled = false;
  private timer: NodeJS.Timeout | null = null;
  private listeners: Array<(token: string | null, enabled: boolean) => void> = [];

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 5000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  onChange(fn: (token: string | null, enabled: boolean) => void) {
    this.listeners.push(fn);
  }

  private tick() {
    const row = db
      .select()
      .from(schema.botConfigs)
      .where(eq(schema.botConfigs.channel, 'telegram'))
      .get();
    const token = row && row.config ? (JSON.parse(row.config) as { bot_token?: string }).bot_token ?? null : null;
    const enabled = !!(row?.enabled && token);
    if (token !== this.lastToken || enabled !== this.enabled) {
      this.lastToken = token;
      this.enabled = enabled;
      log.info('config.changed', { enabled, has_token: !!token });
      for (const fn of this.listeners) fn(token, enabled);
    }
  }
}
