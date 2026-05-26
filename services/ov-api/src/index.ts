import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { ENV } from './env.js';
import authRoutes from './routes/auth.js';
import waypointRoutes from './routes/waypoints.js';
import incidentRoutes from './routes/incidents.js';
import subscriberRoutes from './routes/subscribers.js';
import botConfigRoutes from './routes/bot-configs.js';
import systemRoutes from './routes/system.js';
import { fanout } from './ws.js';

const app = new Hono();

app.use('*', cors({ origin: ENV.DASHBOARD_BASE_URL, credentials: true }));
app.use('*', logger());

app.get('/', (c) => c.json({ name: 'overwatch-patrol/api', version: '0.1.0' }));
app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/api/auth', authRoutes);
app.route('/api/waypoints', waypointRoutes);
app.route('/api/incidents', incidentRoutes);
app.route('/api/subscribers', subscriberRoutes);
app.route('/api/bot-configs', botConfigRoutes);
app.route('/api/system', systemRoutes);

app.get('/openapi.json', (c) =>
  c.json({
    openapi: '3.1.0',
    info: { title: 'Overwatch Patrol API', version: '0.1.0' },
    paths: {
      '/api/auth/login': { post: { summary: 'Login' } },
      '/api/auth/logout': { post: { summary: 'Logout' } },
      '/api/auth/me': { get: { summary: 'Current user' } },
      '/api/waypoints': { get: {}, post: {} },
      '/api/incidents': { get: {} },
      '/api/incidents/{id}': { get: {} },
      '/api/incidents/{id}/acknowledge': { post: {} },
      '/api/system/status': { get: {} },
    },
  }),
);

const server = serve({ fetch: app.fetch, port: ENV.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(JSON.stringify({ event: 'api.ready', port: info.port }));
});

fanout.attach(server as unknown as import('http').Server);
fanout.start();
