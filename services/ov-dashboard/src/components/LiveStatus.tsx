'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { eventsWsUrl } from '@/lib/api';

type RobotState = 'IDLE' | 'PATROLLING' | 'INSPECTING' | 'COOLDOWN' | 'MANUAL_OVERRIDE' | 'OFFLINE';
interface Status {
  online: boolean;
  state: RobotState;
  last_event_at: string | null;
  current_waypoint_id: string | null;
}

const LiveCtx = createContext<Status>({
  online: false,
  state: 'OFFLINE',
  last_event_at: null,
  current_waypoint_id: null,
});

export function LiveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({
    online: false,
    state: 'OFFLINE',
    last_event_at: null,
    current_waypoint_id: null,
  });
  const lastEvt = useRef(Date.now());

  // Bootstrap from the api's SQLite-backed status snapshot. We used to
  // hit /api/surveillance/state, but that proxies through to MCP and
  // the dimos RPC backplane can take tens of seconds (or worse, 120s
  // timeouts) under load — which made the dashboard wordmark sit grey
  // for ages even when the bridge was happily seeing heartbeats. The
  // /api/system/status endpoint reads the bridge-populated
  // `robot_status` row directly and is always sub-millisecond.
  //
  // An AbortController caps the request at 3s so a wedged api process
  // can't keep us "loading" indefinitely.
  useEffect(() => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    fetch('/api/system/status', {
      credentials: 'include',
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          body:
            | {
                bridge_connected?: boolean;
                last_lcm_event_at?: string | null;
                robot?: { state?: string; current_waypoint_id?: string | null } | null;
              }
            | null,
        ) => {
          if (!body) return;
          const robotState = (body.robot?.state as RobotState | undefined) ?? null;
          const recent =
            body.last_lcm_event_at !== null && body.last_lcm_event_at !== undefined;
          if (recent || body.bridge_connected) {
            setStatus((s) => ({
              ...s,
              online: true,
              state: robotState ?? (s.state === 'OFFLINE' ? 'IDLE' : s.state),
              last_event_at:
                body.last_lcm_event_at ?? new Date().toISOString(),
              current_waypoint_id: body.robot?.current_waypoint_id ?? null,
            }));
            lastEvt.current = Date.now();
          }
        },
      )
      .catch(() => {
        // Aborted or network error — fall back on the WS path. The
        // wordmark stays grey for a beat but heartbeats will land soon.
      });
    return () => {
      clearTimeout(timeout);
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    const connect = () => {
      // ov-api directly, not the dashboard origin — Next.js's rewrites
      // can't proxy WS upgrades. localhost is host-only cookie scope so
      // the session cookie reaches ov-api even cross-port.
      const ws = new WebSocket(eventsWsUrl('/ws'));
      ws.onmessage = (e) => {
        try {
          const evt = JSON.parse(e.data);
          lastEvt.current = Date.now();
          if (evt.type === 'robot.state_changed') {
            setStatus((s) => ({
              ...s,
              online: true,
              state: evt.state,
              last_event_at: evt.ts,
              current_waypoint_id: evt.waypoint_id ?? null,
            }));
          } else {
            setStatus((s) => ({
              ...s,
              online: true,
              // Any LCM activity means the robot is up; if the explicit
              // state machine hasn't told us otherwise yet, IDLE is the
              // honest default (spec §8) rather than OFFLINE.
              state: s.state === 'OFFLINE' ? 'IDLE' : s.state,
              last_event_at: new Date().toISOString(),
            }));
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (!stopped) setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    // Tolerate up to 30s of WS silence before flipping the wordmark to
    // offline. The bridge's heartbeat is 1Hz and api↔bridge sometimes
    // reconnects (we've seen the cycle every couple minutes on the 4G
    // relay path), which previously caused brief offline flickers. A
    // 30s grace window covers a full reconnect cycle without lying.
    const stale = setInterval(() => {
      if (Date.now() - lastEvt.current > 30000) {
        setStatus((s) => (s.online ? { ...s, online: false } : s));
      }
    }, 2000);

    return () => {
      stopped = true;
      clearInterval(stale);
    };
  }, []);

  return <LiveCtx.Provider value={status}>{children}</LiveCtx.Provider>;
}

export function useLiveStatus() {
  return useContext(LiveCtx);
}

export function statePillClass(state: RobotState): string {
  switch (state) {
    case 'PATROLLING':
      return 'pill pill-inspecting'; // amber outline
    case 'INSPECTING':
      return 'pill pill-open'; // amber fill
    case 'MANUAL_OVERRIDE':
      return 'pill pill-muted';
    case 'IDLE':
      return 'pill pill-muted';
    case 'COOLDOWN':
      return 'pill pill-muted';
    case 'OFFLINE':
      return 'pill pill-offline';
    default:
      return 'pill pill-muted';
  }
}
