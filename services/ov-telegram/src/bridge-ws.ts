import WebSocket from 'ws';
import { OverwatchEvent } from '@overwatch/schemas';
import { log } from './log.js';

export type EventHandler = (evt: OverwatchEvent) => void;

export class BridgeWs {
  private ws: WebSocket | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private handlers: EventHandler[] = [];

  constructor(private url: string) {}

  start() {
    this.connect();
  }

  on(fn: EventHandler) {
    this.handlers.push(fn);
  }

  private connect() {
    const ws = new WebSocket(this.url);
    ws.on('open', () => log.info('bridge.connected', { url: this.url }));
    ws.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch (e) {
        log.warn('bridge.bad_json');
        return;
      }
      const evt = OverwatchEvent.safeParse(parsed);
      if (!evt.success) {
        log.debug('bridge.unknown_event', { parsed });
        return;
      }
      for (const h of this.handlers) {
        try {
          h(evt.data);
        } catch (e) {
          log.error('bridge.handler_error', { error: String(e) });
        }
      }
    });
    const retry = () => {
      this.ws = null;
      if (this.reconnect) clearTimeout(this.reconnect);
      this.reconnect = setTimeout(() => this.connect(), 2000);
    };
    ws.on('close', retry);
    ws.on('error', () => ws.close());
    this.ws = ws;
  }
}
