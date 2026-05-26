-- Reverse of 0001_init.sql
DROP INDEX IF EXISTS idx_detections_ts;
DROP INDEX IF EXISTS idx_detections_incident;
DROP INDEX IF EXISTS idx_incidents_status;
DROP INDEX IF EXISTS idx_incidents_opened;

DROP TABLE IF EXISTS retention_policies;
DROP TABLE IF EXISTS robot_status;
DROP TABLE IF EXISTS agent_conversations;
DROP TABLE IF EXISTS bot_configs;
DROP TABLE IF EXISTS subscribers;
DROP TABLE IF EXISTS detections;
DROP TABLE IF EXISTS incidents;
DROP TABLE IF EXISTS waypoints;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
