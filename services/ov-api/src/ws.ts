import WebSocket, { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import { lucia } from './auth.js';
import { ENV } from './env.js';
import { log } from './log.js';

type Client = WebSocket;

class WsFanout {
  private clients = new Set<Client>();
  private upstream: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _upstreamConnected = false;
  private _lastEventAt: string | null = null;

  constructor(private upstreamUrl: string) {}

  start() {
    this.connectUpstream();
  }

  get connected(): boolean {
    return this._upstreamConnected;
  }

  get lastEventAt(): string | null {
    return this._lastEventAt;
  }

  private connectUpstream() {
    if (this.upstream) return;
    const ws = new WebSocket(this.upstreamUrl);
    ws.on('open', () => {
      this._upstreamConnected = true;
      log.info('bridge_ws.connected', { url: this.upstreamUrl });
    });
    ws.on('message', (data) => {
      this._lastEventAt = new Date().toISOString();
      const text = data.toString();
      for (const c of this.clients) {
        if (c.readyState === WebSocket.OPEN) c.send(text);
      }
    });
    const reconnect = () => {
      this._upstreamConnected = false;
      this.upstream = null;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connectUpstream(), 2000);
    };
    ws.on('close', reconnect);
    ws.on('error', () => ws.close());
    this.upstream = ws;
  }

  attach(server: import('http').Server) {
    const wss = new WebSocketServer({ noServer: true });
    // Accept several path aliases — spec §7.6 names `WS /events`, but the
    // dashboard uses `/ws` and `/api/ws` historically.
    const allowed = new Set(['/ws', '/api/ws', '/events', '/api/events']);
    server.on('upgrade', async (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!allowed.has(url.pathname)) {
        socket.destroy();
        return;
      }
      // Auth: cookie or ?token=
      const token =
        url.searchParams.get('token') ??
        (req.headers.cookie ?? '')
          .split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith(`${lucia.sessionCookieName}=`))
          ?.split('=')[1];
      if (!token) {
        socket.destroy();
        return;
      }
      const v = await lucia.validateSession(token);
      if (!v.session) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
      });
    });
  }
}

export const fanout = new WsFanout(ENV.BRIDGE_WS_URL);
