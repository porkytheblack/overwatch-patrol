'use client';
import { useState } from 'react';

interface Sub {
  id: string;
  channel: string;
  handle: string;
  enabled: boolean;
}

export function SubscribersForm({ initial }: { initial: Sub[] }) {
  const [subs, setSubs] = useState(initial);
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!handle.trim()) return;
    setBusy(true);
    const res = await fetch('/api/subscribers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ channel: 'telegram', handle: handle.trim(), enabled: true }),
    });
    setBusy(false);
    if (res.ok) {
      const { id } = (await res.json()) as { id: string };
      setSubs((s) => [...s, { id, channel: 'telegram', handle: handle.trim(), enabled: true }]);
      setHandle('');
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/subscribers/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) setSubs((s) => s.filter((x) => x.id !== id));
  }

  return (
    <div className="card space-y-3">
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="telegram chat id (e.g. 12345678 or @handle)"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
        />
        <button className="btn btn-primary" onClick={add} disabled={busy || !handle}>
          ADD
        </button>
      </div>
      <div className="border-t border-border">
        {subs.length === 0 && (
          <div className="mono text-text-dim text-xs py-2">no subscribers</div>
        )}
        {subs.map((s) => (
          <div key={s.id} className="row">
            <span className="mono text-xs text-text-muted w-20">{s.channel}</span>
            <span className="mono text-sm flex-1">{s.handle}</span>
            <button className="btn btn-danger" onClick={() => remove(s.id)}>
              REMOVE
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
