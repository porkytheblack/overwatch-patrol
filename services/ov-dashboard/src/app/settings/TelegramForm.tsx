'use client';
import { useState } from 'react';

export function TelegramForm({
  enabled,
  tokenSet,
}: {
  enabled: boolean;
  tokenSet: boolean;
}) {
  const [token, setToken] = useState('');
  const [isEnabled, setEnabled] = useState(enabled);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setStatus(null);
    const res = await fetch('/api/bot-configs/telegram', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ config: { bot_token: token }, enabled: isEnabled }),
    });
    setBusy(false);
    if (res.ok) {
      setStatus('saved · bot reloads within 30s');
      setToken('');
    } else {
      setStatus('save failed');
    }
  }

  return (
    <div className="card space-y-3">
      <div className="mono text-xs text-text-muted">
        token current state: {tokenSet ? 'set' : 'unset'} · {isEnabled ? 'enabled' : 'disabled'}
      </div>
      <label className="block">
        <span className="mono uppercase text-[10px] text-text-dim tracking-[0.04em] block mb-1">
          bot token
        </span>
        <input
          className="input w-full"
          type="password"
          placeholder={tokenSet ? '••••••' : 'paste BotFather token'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 mono text-xs">
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        ENABLED
      </label>
      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={save} disabled={busy || !token}>
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
      </div>
      {status && <div className="mono text-xs text-text-muted">{status}</div>}
    </div>
  );
}
