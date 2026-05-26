import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  role: text('role').notNull().default('operator'),
  created_at: text('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires_at: text('expires_at').notNull(),
});

export const waypoints = sqliteTable('waypoints', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  pose_x: real('pose_x').notNull(),
  pose_y: real('pose_y').notNull(),
  pose_yaw: real('pose_yaw').notNull(),
  scene_description: text('scene_description').notNull().default(''),
  targets: text('targets').notNull(),
  detection_window: text('detection_window').notNull().default('{"type":"always"}'),
  linger_threshold_seconds: integer('linger_threshold_seconds').notNull().default(5),
  inspection_dwell_seconds: integer('inspection_dwell_seconds').notNull().default(4),
  min_standoff_m: real('min_standoff_m').notNull().default(1.5),
  order_index: integer('order_index').notNull(),
  enabled: integer('enabled').notNull().default(1),
  created_at: text('created_at').notNull(),
});

export const incidents = sqliteTable(
  'incidents',
  {
    id: text('id').primaryKey(),
    waypoint_id: text('waypoint_id')
      .notNull()
      .references(() => waypoints.id),
    track_id: text('track_id'),
    classes: text('classes').notNull(),
    opened_at: text('opened_at').notNull(),
    closed_at: text('closed_at'),
    status: text('status').notNull().default('open'),
    inspection_pose_x: real('inspection_pose_x'),
    inspection_pose_y: real('inspection_pose_y'),
    clip_path: text('clip_path'),
    poster_path: text('poster_path'),
    clip_status: text('clip_status').notNull().default('pending'),
    summary: text('summary'),
    acknowledged_by: text('acknowledged_by').references(() => users.id),
    acknowledged_by_handle: text('acknowledged_by_handle'),
    acknowledged_at: text('acknowledged_at'),
    metadata: text('metadata').notNull().default('{}'),
  },
  (t) => ({
    openedIdx: index('idx_incidents_opened').on(t.opened_at),
    statusIdx: index('idx_incidents_status').on(t.status),
  }),
);

export const detections = sqliteTable(
  'detections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: text('ts').notNull(),
    class: text('class').notNull(),
    confidence: real('confidence').notNull(),
    bbox: text('bbox').notNull(),
    track_id: text('track_id'),
    incident_id: text('incident_id').references(() => incidents.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    incidentIdx: index('idx_detections_incident').on(t.incident_id),
    tsIdx: index('idx_detections_ts').on(t.ts),
  }),
);

export const subscribers = sqliteTable(
  'subscribers',
  {
    id: text('id').primaryKey(),
    channel: text('channel').notNull(),
    handle: text('handle').notNull(),
    enabled: integer('enabled').notNull().default(1),
    created_at: text('created_at').notNull(),
  },
  (t) => ({
    unique: uniqueIndex('uq_subscribers_channel_handle').on(t.channel, t.handle),
  }),
);

export const botConfigs = sqliteTable('bot_configs', {
  channel: text('channel').primaryKey(),
  config: text('config').notNull(),
  enabled: integer('enabled').notNull().default(0),
});

export const agentConversations = sqliteTable(
  'agent_conversations',
  {
    id: text('id').primaryKey(),
    channel: text('channel').notNull(),
    handle: text('handle').notNull(),
    messages: text('messages').notNull().default('[]'),
    pending_confirmation: text('pending_confirmation'),
    last_active: text('last_active').notNull(),
  },
  (t) => ({
    unique: uniqueIndex('uq_agent_conversations_channel_handle').on(t.channel, t.handle),
  }),
);

export const robotStatus = sqliteTable('robot_status', {
  id: integer('id').primaryKey(),
  state: text('state').notNull(),
  current_waypoint_id: text('current_waypoint_id').references(() => waypoints.id),
  patrol_cursor_index: integer('patrol_cursor_index'),
  last_seen_at: text('last_seen_at').notNull(),
  pose_x: real('pose_x'),
  pose_y: real('pose_y'),
  pose_yaw: real('pose_yaw'),
});

export const retentionPolicies = sqliteTable('retention_policies', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  retention_days: integer('retention_days').notNull(),
});
