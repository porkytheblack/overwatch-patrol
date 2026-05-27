'use client';
import { useState } from 'react';

interface Waypoint {
  id: string;
  name: string;
  pose_x: number;
  pose_y: number;
  pose_yaw: number;
  scene_description: string;
  targets: string[];
  linger_threshold_seconds: number;
  inspection_dwell_seconds: number;
  min_standoff_m: number;
  order_index: number;
  enabled: boolean;
}

export function PatrolEditor({ initial }: { initial: Waypoint[] }) {
  const [waypoints, setWaypoints] = useState(initial);

  async function patch(id: string, body: Partial<Waypoint>) {
    const res = await fetch(`/api/waypoints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    if (res.ok) setWaypoints((ws) => ws.map((w) => (w.id === id ? { ...w, ...body } : w)));
  }

  async function remove(id: string) {
    if (!confirm('delete waypoint?')) return;
    const res = await fetch(`/api/waypoints/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) setWaypoints((ws) => ws.filter((w) => w.id !== id));
  }

  async function reorder(ids: string[]) {
    const res = await fetch('/api/waypoints/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      credentials: 'include',
    });
    if (res.ok) {
      setWaypoints((ws) => {
        const map = new Map(ws.map((w) => [w.id, w]));
        return ids.map((id, idx) => ({ ...map.get(id)!, order_index: idx }));
      });
    }
  }

  function move(id: string, delta: -1 | 1) {
    const idx = waypoints.findIndex((w) => w.id === id);
    if (idx < 0) return;
    const next = idx + delta;
    if (next < 0 || next >= waypoints.length) return;
    const ids = waypoints.map((w) => w.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    reorder(ids);
  }

  return (
    <div className="space-y-2">
      <div className="mono text-xs text-text-muted">
        {waypoints.length} waypoint{waypoints.length === 1 ? '' : 's'}
      </div>
      {waypoints.length === 0 && (
        <div className="card mono text-sm space-y-2">
          <div className="text-text">no waypoints yet</div>
          <div className="text-text-dim text-xs">
            drive the robot to a position you want patrolled, then add a waypoint by
            messaging the Telegram bot:{' '}
            <code className="mono text-text">add_waypoint front_gate</code>
            <br />
            (set the bot token in{' '}
            <a href="/settings" className="text-accent">
              settings
            </a>{' '}
            first)
          </div>
        </div>
      )}
      {waypoints.map((w) => (
        <details key={w.id} className="card">
          <summary className="cursor-pointer flex items-center gap-3 list-none">
            <span className="mono text-text-dim w-6 text-right">{w.order_index}</span>
            <span className="mono text-text">{w.name}</span>
            <span className="mono text-xs text-text-dim">
              ({w.pose_x.toFixed(2)}, {w.pose_y.toFixed(2)}, {w.pose_yaw.toFixed(2)})
            </span>
            <span className="ml-auto mono text-xs text-text-muted">
              targets: {w.targets.join(', ') || '—'}
            </span>
            <span className={`pill ${w.enabled ? 'pill-resolved' : 'pill-suppressed'}`}>
              {w.enabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
            <Field label="scene description">
              <input
                className="input w-full"
                defaultValue={w.scene_description}
                onBlur={(e) => patch(w.id, { scene_description: e.target.value })}
              />
            </Field>
            <Field label="targets (comma)">
              <input
                className="input w-full"
                defaultValue={w.targets.join(', ')}
                onBlur={(e) =>
                  patch(w.id, {
                    targets: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <Field label="linger (s)">
              <input
                type="number"
                className="input w-full"
                defaultValue={w.linger_threshold_seconds}
                onBlur={(e) => patch(w.id, { linger_threshold_seconds: Number(e.target.value) })}
              />
            </Field>
            <Field label="dwell (s)">
              <input
                type="number"
                className="input w-full"
                defaultValue={w.inspection_dwell_seconds}
                onBlur={(e) => patch(w.id, { inspection_dwell_seconds: Number(e.target.value) })}
              />
            </Field>
            <Field label="min standoff (m)">
              <input
                type="number"
                step="0.1"
                className="input w-full"
                defaultValue={w.min_standoff_m}
                onBlur={(e) => patch(w.id, { min_standoff_m: Number(e.target.value) })}
              />
            </Field>
            <Field label="enabled">
              <select
                className="select w-full"
                defaultValue={String(w.enabled)}
                onChange={(e) => patch(w.id, { enabled: e.target.value === 'true' })}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </Field>
            <div className="col-span-2 flex justify-end gap-2 pt-2">
              <button
                className="btn"
                onClick={() => move(w.id, -1)}
                disabled={w.order_index === 0}
                title="move up"
              >
                ↑
              </button>
              <button
                className="btn"
                onClick={() => move(w.id, 1)}
                disabled={w.order_index === waypoints.length - 1}
                title="move down"
              >
                ↓
              </button>
              <button className="btn btn-danger" onClick={() => remove(w.id)}>
                DELETE
              </button>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono uppercase text-[10px] text-text-dim tracking-[0.04em] block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
