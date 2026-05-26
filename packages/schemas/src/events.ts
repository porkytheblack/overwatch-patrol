import { z } from 'zod';

export const Bbox = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type Bbox = z.infer<typeof Bbox>;

export const Detection = z.object({
  class: z.string(),
  confidence: z.number().min(0).max(1),
  bbox: Bbox,
  track_id: z.string().optional(),
});
export type Detection = z.infer<typeof Detection>;

export const FrameDetections = z.object({
  type: z.literal('frame.detections'),
  ts: z.string().datetime(),
  detections: z.array(Detection),
});
export type FrameDetections = z.infer<typeof FrameDetections>;

export const RobotState = z.enum([
  'IDLE',
  'PATROLLING',
  'INSPECTING',
  'COOLDOWN',
  'MANUAL_OVERRIDE',
  'OFFLINE',
]);
export type RobotState = z.infer<typeof RobotState>;

export const Pose = z.object({
  x: z.number(),
  y: z.number(),
  yaw: z.number(),
});
export type Pose = z.infer<typeof Pose>;

export const RobotStateChanged = z.object({
  type: z.literal('robot.state_changed'),
  ts: z.string().datetime(),
  state: RobotState,
  waypoint_id: z.string().uuid().optional(),
  pose: Pose.optional(),
});
export type RobotStateChanged = z.infer<typeof RobotStateChanged>;

export const IncidentOpened = z.object({
  type: z.literal('incident.opened'),
  incident_id: z.string().uuid(),
  waypoint_id: z.string().uuid(),
  classes: z.array(z.string()),
  opened_at: z.string().datetime(),
  track_id: z.string().optional(),
  inspection_pose: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type IncidentOpened = z.infer<typeof IncidentOpened>;

export const IncidentStatus = z.enum(['open', 'closed', 'suppressed', 'acknowledged']);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const IncidentClosed = z.object({
  type: z.literal('incident.closed'),
  incident_id: z.string().uuid(),
  closed_at: z.string().datetime(),
  status: z.enum(['closed', 'suppressed']),
  duration_ms: z.number(),
});
export type IncidentClosed = z.infer<typeof IncidentClosed>;

export const ClipReady = z.object({
  type: z.literal('clip.ready'),
  incident_id: z.string().uuid(),
  clip_path: z.string(),
  poster_path: z.string(),
  duration_ms: z.number(),
});
export type ClipReady = z.infer<typeof ClipReady>;

export const WaypointSync = z.object({
  type: z.literal('waypoint.sync'),
  waypoint_id: z.string().uuid(),
  name: z.string(),
  pose: Pose,
  action: z.enum(['upsert', 'delete']),
});
export type WaypointSync = z.infer<typeof WaypointSync>;

export const DetectionWindow = z.discriminatedUnion('type', [
  z.object({ type: z.literal('always') }),
  z.object({
    type: z.literal('time'),
    start: z.string(),
    end: z.string(),
    tz: z.string(),
    days: z.array(
      z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
    ),
  }),
]);
export type DetectionWindow = z.infer<typeof DetectionWindow>;

export const OverwatchEvent = z.discriminatedUnion('type', [
  FrameDetections,
  RobotStateChanged,
  IncidentOpened,
  IncidentClosed,
  ClipReady,
  WaypointSync,
]);
export type OverwatchEvent = z.infer<typeof OverwatchEvent>;

export const LCM_TOPICS = {
  detections: '/ow/detections',
  robot_state: '/ow/robot_state',
  incident_opened: '/ow/incident_opened',
  incident_closed: '/ow/incident_closed',
  clip_ready: '/ow/clip_ready',
  waypoint_sync: '/ow/waypoint_sync',
} as const;

export type LcmTopic = (typeof LCM_TOPICS)[keyof typeof LCM_TOPICS];
