'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveStatus } from '@/components/LiveStatus';

/**
 * Capture the robot's current pose as a named waypoint. Wraps the MCP
 * `add_waypoint(name)` skill — the SurveillanceModule reads odom and
 * publishes `/ow/waypoint_sync`, which the bridge upserts into SQLite.
 * Once the API confirms, refresh the server component so the new row
 * shows up in the editor + map.
 */
export function AddWaypoint() {
  const { online } = useLiveStatus();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/surveillance/waypoints', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (res.ok) {
        setMsg(body.message ?? `saved ${name.trim()}`);
        setName('');
        router.refresh();
      } else {
        setMsg(body.error ?? `failed (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-2">
      <div className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">
        add waypoint at current pose
      </div>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="name (e.g. front_gate)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy || !online}
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || !online || !name.trim()}
        >
          {busy ? 'CAPTURING…' : 'ADD'}
        </button>
      </div>
      <div className="mono text-xs text-text-dim">
        drives the robot's current odom pose into SpatialMemory + this dashboard.
      </div>
      {msg && <div className="mono text-xs text-text-muted truncate">{msg}</div>}
    </form>
  );
}
