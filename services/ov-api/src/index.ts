import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ENV } from './env.js';
import { httpLogger, log } from './log.js';
import { openapi } from './openapi.js';
import authRoutes from './routes/auth.js';
import waypointRoutes from './routes/waypoints.js';
import incidentRoutes from './routes/incidents.js';
import subscriberRoutes from './routes/subscribers.js';
import botConfigRoutes from './routes/bot-configs.js';
import systemRoutes from './routes/system.js';
import surveillanceRoutes from './routes/surveillance.js';
import agentRoutes from './routes/agent.js';
import voiceRoutes from './routes/voice.js';
import { fanout } from './ws.js';

const app = new Hono();

app.use('*', cors({ origin: ENV.DASHBOARD_BASE_URL, credentials: true }));
app.use('*', httpLogger);

app.get('/', (c) => c.json({ name: 'overwatch-patrol/api', version: '0.1.0' }));
app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/api/auth', authRoutes);
app.route('/api/waypoints', waypointRoutes);
app.route('/api/incidents', incidentRoutes);
app.route('/api/subscribers', subscriberRoutes);
app.route('/api/bot-configs', botConfigRoutes);
app.route('/api/system', systemRoutes);
app.route('/api/surveillance', surveillanceRoutes);
app.route('/api/agent', agentRoutes);
app.route('/api/voice', voiceRoutes);

app.get('/openapi.json', (c) => c.json(openapi));

const server = serve({ fetch: app.fetch, port: ENV.PORT, hostname: '0.0.0.0' }, (info) => {
  log.info('api.ready', { port: info.port });
});

fanout.attach(server as unknown as import('http').Server);
fanout.start();
