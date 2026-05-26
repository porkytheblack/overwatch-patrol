CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS waypoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  pose_x REAL NOT NULL,
  pose_y REAL NOT NULL,
  pose_yaw REAL NOT NULL,
  scene_description TEXT NOT NULL DEFAULT '',
  targets TEXT NOT NULL,
  detection_window TEXT NOT NULL DEFAULT '{"type":"always"}',
  linger_threshold_seconds INTEGER NOT NULL DEFAULT 5,
  inspection_dwell_seconds INTEGER NOT NULL DEFAULT 4,
  min_standoff_m REAL NOT NULL DEFAULT 1.5,
  order_index INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  waypoint_id TEXT NOT NULL REFERENCES waypoints(id),
  track_id TEXT,
  classes TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  inspection_pose_x REAL,
  inspection_pose_y REAL,
  clip_path TEXT,
  poster_path TEXT,
  clip_status TEXT NOT NULL DEFAULT 'pending',
  summary TEXT,
  acknowledged_by TEXT REFERENCES users(id),
  acknowledged_by_handle TEXT,
  acknowledged_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_incidents_opened ON incidents (opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status);

CREATE TABLE IF NOT EXISTS detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  class TEXT NOT NULL,
  confidence REAL NOT NULL,
  bbox TEXT NOT NULL,
  track_id TEXT,
  incident_id TEXT REFERENCES incidents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_detections_incident ON detections (incident_id);
CREATE INDEX IF NOT EXISTS idx_detections_ts ON detections (ts);

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  handle TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (channel, handle)
);

CREATE TABLE IF NOT EXISTS bot_configs (
  channel TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  handle TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  pending_confirmation TEXT,
  last_active TEXT NOT NULL,
  UNIQUE (channel, handle)
);

CREATE TABLE IF NOT EXISTS robot_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL,
  current_waypoint_id TEXT REFERENCES waypoints(id),
  patrol_cursor_index INTEGER,
  last_seen_at TEXT NOT NULL,
  pose_x REAL, pose_y REAL, pose_yaw REAL
);

CREATE TABLE IF NOT EXISTS retention_policies (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  retention_days INTEGER NOT NULL
);
