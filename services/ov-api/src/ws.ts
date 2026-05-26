import WebSocket, { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import { lucia } from './auth.js';
import { ENV } from './env.js';

type Client = WebSocket;

class WsFanout {
  private clients = new Set<Client>();
  private upstream: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private upstreamUrl: string) {}

  start() {
    this.connectUpstream();
  }

  private connectUpstream() {
    if (this.upstream) return;
    const ws = new WebSocket(this.upstreamUrl);
    ws.on('open', () => {
      console.log(JSON.stringify({ event: 'bridge_ws.connected', url: this.upstreamUrl }));
    });
    ws.on('message', (data) => {
      const text = data.toString();
      for (const c of this.clients) {
        if (c.readyState === WebSocket.OPEN) c.send(text);
      }
    });
    const reconnect = () => {
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
    server.on('upgrade', async (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws' && url.pathname !== '/api/ws') {
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
