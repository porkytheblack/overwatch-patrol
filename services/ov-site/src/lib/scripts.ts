import type { CameraScene } from '@/components/CameraView';
import type { WaypointId } from '@/components/SiteMap';

// Scripted conversations for the "In action" demo. Message formats, state
// names and tool names mirror the production system (spec §12–13) so what the
// visitor sees is what an operator would get.

export type Channel = 'whatsapp' | 'telegram';
export type Mode = 'PATROLLING' | 'INSPECTING' | 'MANUAL_OVERRIDE' | 'HOLDING';
export type IncidentState = 'OPEN' | "ACK'D" | 'RESOLVED';

export type Msg = {
  from: 'bot' | 'me' | 'other' | 'system';
  author?: string;
  text?: string;
  /** Alert card: header line + body lines + snapshot. */
  alert?: { title: string; lines: string[]; scene: CameraScene; stamp: string };
  snapshot?: { scene: CameraScene; stamp: string; status?: string };
  link?: { label: string; href: string };
  buttons?: string[];
  time: string;
};

export type RobotState = {
  mode: Mode;
  at: WaypointId;
  incident: { id: string; state: IncidentState; label: string } | null;
  battery: number;
};

export type Step = {
  /** Pause before this step runs. */
  wait: number;
  /** Show a typing indicator for this long before the message lands. */
  typing?: number;
  msg?: Msg;
  /** Press a button on the most recent message that has one. */
  press?: string;
  /** Append a line to the most recent alert (Telegram edits the alert on ack). */
  amend?: string;
  state?: Partial<RobotState>;
  tool?: { kind: 'tool' | 'event' | 'held'; text: string };
};

export type Script = {
  channel: Channel;
  chatTitle: string;
  chatSubtitle: string;
  initial: RobotState;
  steps: Step[];
};

export const telegram: Script = {
  channel: 'telegram',
  chatTitle: 'Overwatch · Northgate',
  chatSubtitle: 'bot',
  initial: { mode: 'PATROLLING', at: 'dock', incident: null, battery: 82 },
  steps: [
    {
      wait: 500,
      state: { mode: 'INSPECTING', incident: { id: '0142', state: 'OPEN', label: 'person · LOADING DOCK' } },
      tool: { kind: 'event', text: 'incident_opened #0142 · person · loading_dock' },
    },
    {
      wait: 600,
      typing: 900,
      msg: {
        from: 'bot',
        alert: {
          title: 'LOADING DOCK',
          lines: ['person detected · just now', 'Lingering near bay 3. Robot inspecting.'],
          scene: 'dock-person',
          stamp: '22:41:15',
        },
        buttons: ['View', 'Acknowledge'],
        time: '22:41',
      },
    },
    {
      wait: 2200,
      press: 'Acknowledge',
      amend: "ACK'D by @ops_lead at 22:41",
      state: { incident: { id: '0142', state: "ACK'D", label: 'person · LOADING DOCK' } },
      tool: { kind: 'tool', text: 'acknowledge_incident(142, "telegram:ops_lead")' },
    },
    { wait: 1400, msg: { from: 'me', text: 'anything else in the last hour?', time: '22:42' } },
    { wait: 400, tool: { kind: 'tool', text: 'search_incidents(since="-1h")' } },
    {
      wait: 300,
      typing: 1200,
      msg: {
        from: 'bot',
        text: "2 incidents in the last hour.\n21:52 · NORTH FENCE · vehicle · resolved after inspection\n22:41 · LOADING DOCK · person · ack'd by @ops_lead",
        time: '22:42',
      },
    },
    { wait: 1800, msg: { from: 'me', text: 'go to the front gate', time: '22:42' } },
    {
      wait: 300,
      typing: 800,
      msg: { from: 'bot', text: 'Heading to FRONT GATE. Patrol paused, resumes after 60 s idle or on "resume patrol".', time: '22:42' },
      state: { mode: 'MANUAL_OVERRIDE', at: 'gate' },
      tool: { kind: 'tool', text: 'go_to_waypoint("front_gate")' },
    },
    {
      wait: 3200,
      msg: { from: 'bot', text: 'arrived · front_gate', snapshot: { scene: 'gate-clear', stamp: '22:43:02', status: 'Clear' }, time: '22:43' },
      tool: { kind: 'event', text: 'goal_reached · front_gate' },
    },
    { wait: 1800, msg: { from: 'me', text: 'stop surveillance', time: '22:43' } },
    {
      wait: 300,
      typing: 900,
      msg: { from: 'bot', text: 'Stopping surveillance halts patrol and detection site-wide. Reply y to confirm.', time: '22:43' },
      tool: { kind: 'held', text: 'stop_surveillance() · awaiting confirmation' },
    },
    { wait: 1600, msg: { from: 'me', text: 'n', time: '22:43' } },
    {
      wait: 300,
      typing: 700,
      msg: { from: 'bot', text: 'Cancelled. Resuming patrol from WP-01.', time: '22:43' },
      state: { mode: 'PATROLLING' },
      tool: { kind: 'tool', text: 'resume_patrol()' },
    },
  ],
};

export const whatsapp: Script = {
  channel: 'whatsapp',
  chatTitle: 'Northgate · Night shift',
  chatSubtitle: 'Overwatch, Guard 2, you',
  initial: { mode: 'PATROLLING', at: 'north', incident: null, battery: 72 },
  steps: [
    {
      wait: 500,
      state: { mode: 'INSPECTING', incident: { id: '0143', state: 'OPEN', label: 'vehicle · NORTH FENCE' } },
      tool: { kind: 'event', text: 'incident_opened #0143 · vehicle · north_fence' },
    },
    {
      wait: 600,
      typing: 900,
      msg: {
        from: 'bot',
        author: 'Overwatch',
        alert: {
          title: 'NORTH FENCE',
          lines: ['vehicle detected · stationary 12 s', 'Outside the fence line. Robot holding to inspect.'],
          scene: 'fence-vehicle',
          stamp: '23:02:40',
        },
        buttons: ['Acknowledge', 'View clip'],
        time: '23:02',
      },
    },
    {
      wait: 1800,
      msg: {
        from: 'bot',
        author: 'Overwatch',
        text: 'Clip ready · 0:24 including 5 s pre-roll.',
        link: { label: 'Open playback · link expires in 24 h', href: '#security' },
        time: '23:03',
      },
      tool: { kind: 'event', text: 'clip_ready #0143 · 00:24' },
    },
    {
      wait: 1500,
      typing: 1300,
      msg: { from: 'other', author: 'Guard 2', text: "That's the contractor van, booked for 23:00. Acknowledging.", time: '23:03' },
    },
    {
      wait: 900,
      press: 'Acknowledge',
      msg: { from: 'system', text: 'Guard 2 acknowledged #0143', time: '23:03' },
      state: { incident: { id: '0143', state: "ACK'D", label: 'vehicle · NORTH FENCE' } },
      tool: { kind: 'tool', text: 'acknowledge_incident(143, "whatsapp:guard_2")' },
    },
    { wait: 1500, msg: { from: 'me', text: '@Overwatch hold at the north fence for 15 minutes', time: '23:04' } },
    {
      wait: 300,
      typing: 900,
      msg: { from: 'bot', author: 'Overwatch', text: 'Holding at NORTH FENCE until 23:19, then resuming patrol.', time: '23:04' },
      state: { mode: 'HOLDING' },
      tool: { kind: 'tool', text: 'pause_patrol() → wait(900)' },
    },
    { wait: 1800, msg: { from: 'me', text: 'status', time: '23:05' } },
    { wait: 300, tool: { kind: 'tool', text: 'get_robot_state()' } },
    {
      wait: 200,
      typing: 900,
      msg: {
        from: 'bot',
        author: 'Overwatch',
        text: 'HOLDING · NORTH FENCE\nBattery 72% · 0 open incidents\nPatrol resumes 23:19',
        time: '23:05',
      },
    },
  ],
};
