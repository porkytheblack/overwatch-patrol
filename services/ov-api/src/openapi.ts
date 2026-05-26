/** Hand-written OpenAPI 3.1 doc covering every route in §7.6.
 *
 * Kept in sync with the route files by integration tests (see
 * services/ov-api/src/routes/*.test.ts).
 */
export const openapi = {
  openapi: '3.1.0',
  info: { title: 'Overwatch Patrol API', version: '0.1.0' },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer' },
      cookie: { type: 'apiKey', in: 'cookie', name: 'ov_session' },
    },
  },
  security: [{ bearer: [] }, { cookie: [] }],
  paths: {
    '/health': { get: { summary: 'Health probe', security: [] } },
    '/openapi.json': { get: { summary: 'This document', security: [] } },
    '/api/auth/needs-setup': {
      get: { summary: 'First-boot wizard check', security: [] },
    },
    '/api/auth/bootstrap': {
      post: { summary: 'Create the initial operator (one-shot)', security: [] },
    },
    '/api/auth/login': {
      post: { summary: 'Login (username + password)', security: [] },
    },
    '/api/auth/logout': { post: { summary: 'Logout' } },
    '/api/auth/me': { get: { summary: 'Current user' } },
    '/api/waypoints': {
      get: { summary: 'List waypoints' },
      post: { summary: 'Create waypoint (pose captured by robot via MCP)' },
    },
    '/api/waypoints/{id}': {
      patch: { summary: 'Update waypoint' },
      delete: { summary: 'Delete waypoint' },
    },
    '/api/waypoints/reorder': { post: { summary: 'Reorder waypoints' } },
    '/api/incidents': {
      get: {
        summary: 'List incidents',
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'waypoint_id', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
      },
    },
    '/api/incidents/{id}': { get: { summary: 'Incident detail' } },
    '/api/incidents/{id}/acknowledge': { post: { summary: 'Acknowledge incident' } },
    '/api/incidents/{id}/clip': {
      get: { summary: 'Stream incident MP4', security: [] },
    },
    '/api/incidents/{id}/poster': {
      get: { summary: 'Stream incident poster JPEG', security: [] },
    },
    '/api/incidents/{id}/playback': {
      get: {
        summary: 'Signed deep-link playback metadata',
        security: [],
        parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
      },
    },
    '/api/subscribers': {
      get: { summary: 'List subscribers' },
      post: { summary: 'Add a subscriber (telegram chat_id)' },
    },
    '/api/subscribers/{id}': { delete: { summary: 'Remove subscriber' } },
    '/api/bot-configs/{channel}': {
      get: { summary: 'Get a channel bot config' },
      put: { summary: 'Set a channel bot config (e.g. telegram bot_token)' },
    },
    '/api/system/status': {
      get: {
        summary: 'Aggregate system status (robot, bridge connection, last LCM event)',
      },
    },
    '/ws': {
      get: { summary: 'WebSocket event firehose (mirrors `/events` for compatibility)' },
    },
    '/events': {
      get: { summary: 'WebSocket event firehose (spec §7.6 alias)' },
    },
  },
} as const;
