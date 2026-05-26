'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

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

  useEffect(() => {
    let stopped = false;
    const connect = () => {
      const ws = new WebSocket(
        `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`,
      );
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
            setStatus((s) => ({ ...s, online: true, last_event_at: new Date().toISOString() }));
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

    const stale = setInterval(() => {
      if (Date.now() - lastEvt.current > 8000) setStatus((s) => ({ ...s, online: false }));
    }, 1000);

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
