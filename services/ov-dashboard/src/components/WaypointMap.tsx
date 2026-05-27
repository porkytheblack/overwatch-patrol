'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLiveStatus } from './LiveStatus';
import { eventsWsUrl } from '@/lib/api';

interface Waypoint {
  id: string;
  name: string;
  pose_x: number;
  pose_y: number;
  order_index: number;
}

/**
 * 2D map view (spec §10.2): waypoints as numbered amber dots, robot pose
 * as a filled amber circle (driven by WS). The occupancy-grid background
 * is a v2 enhancement; v1 ships a clean coordinate grid.
 */
export function WaypointMap({
  waypoints,
  onSelect,
}: {
  waypoints: Waypoint[];
  onSelect?: (id: string) => void;
}) {
  const { state, online } = useLiveStatus();
  const robotPose = useRobotPose();

  const bounds = useMemo(() => {
    const xs = [...waypoints.map((w) => w.pose_x), robotPose?.x ?? 0];
    const ys = [...waypoints.map((w) => w.pose_y), robotPose?.y ?? 0];
    if (xs.length === 0) return { minX: -5, maxX: 5, minY: -5, maxY: 5 };
    const minX = Math.min(...xs) - 1;
    const maxX = Math.max(...xs) + 1;
    const minY = Math.min(...ys) - 1;
    const maxY = Math.max(...ys) + 1;
    const span = Math.max(maxX - minX, maxY - minY, 4);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return {
      minX: cx - span / 2,
      maxX: cx + span / 2,
      minY: cy - span / 2,
      maxY: cy + span / 2,
    };
  }, [waypoints, robotPose]);

  const W = 480;
  const H = 480;
  const toX = (x: number) => ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * W;
  const toY = (y: number) => H - ((y - bounds.minY) / (bounds.maxY - bounds.minY)) * H;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="mono uppercase text-xs text-text-muted tracking-[0.04em]">map</span>
        <span className="mono text-[10px] text-text-dim">
          {online ? state : 'OFFLINE'} · {waypoints.length} waypoint
          {waypoints.length === 1 ? '' : 's'}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block bg-black">
        {gridLines(bounds.minX, bounds.maxX, toX, W, H, 'x')}
        {gridLines(bounds.minY, bounds.maxY, toY, W, H, 'y')}
        {waypoints.map((w) => {
          const x = toX(w.pose_x);
          const y = toY(w.pose_y);
          return (
            <g
              key={w.id}
              onClick={() => onSelect?.(w.id)}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
            >
              <circle cx={x} cy={y} r={8} fill="#F59E0B" />
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fontSize="10"
                fontFamily="var(--font-mono), monospace"
                fill="#000"
                fontWeight="500"
              >
                {w.order_index}
              </text>
              <text
                x={x + 12}
                y={y + 3}
                fontSize="10"
                fontFamily="var(--font-mono), monospace"
                fill="#E5E5E5"
              >
                {w.name}
              </text>
            </g>
          );
        })}
        {robotPose && (
          <g>
            <circle cx={toX(robotPose.x)} cy={toY(robotPose.y)} r={6} fill="#F59E0B" />
            <circle
              cx={toX(robotPose.x)}
              cy={toY(robotPose.y)}
              r={10}
              fill="none"
              stroke="#F59E0B"
              strokeOpacity="0.4"
            />
          </g>
        )}
      </svg>
    </div>
  );
}

function gridLines(
  min: number,
  max: number,
  to: (v: number) => number,
  W: number,
  H: number,
  axis: 'x' | 'y',
): React.ReactNode {
  const lines: React.ReactNode[] = [];
  const start = Math.ceil(min);
  for (let v = start; v <= max; v += 1) {
    const p = to(v);
    lines.push(
      axis === 'x' ? (
        <line key={`gx${v}`} x1={p} x2={p} y1={0} y2={H} stroke="#262626" strokeWidth="0.5" />
      ) : (
        <line key={`gy${v}`} x1={0} x2={W} y1={p} y2={p} stroke="#262626" strokeWidth="0.5" />
      ),
    );
  }
  return lines;
}

function useRobotPose(): { x: number; y: number; yaw: number } | null {
  const [pose, setPose] = useState<{ x: number; y: number; yaw: number } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let stopped = false;
    const ws = new WebSocket(eventsWsUrl('/ws'));
    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type === 'robot.state_changed' && evt.pose) {
          if (!stopped) setPose(evt.pose);
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      stopped = true;
      ws.close();
    };
  }, []);
  return pose;
}
