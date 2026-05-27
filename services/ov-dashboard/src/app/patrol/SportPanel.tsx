'use client';
import { useState } from 'react';
import { useLiveStatus } from '@/components/LiveStatus';

/**
 * Quick-access sport commands. The auto-recovery watcher in
 * SurveillanceModule fires RecoveryStand on its own if the robot tips
 * past ~53°, but giving the operator a one-click button is useful when
 * the auto path doesn't fire (rare orientation, watcher paused, etc.).
 *
 * Spec §13 lists the acrobatic flips / handstand as confirmation-required
 * — those go through the Telegram bot, not this panel.
 */
const SAFE_COMMANDS: { name: string; label: string; tone: 'primary' | 'normal' | 'danger' }[] = [
  { name: 'RecoveryStand', label: 'RECOVERY', tone: 'primary' },
  { name: 'BalanceStand', label: 'BALANCE', tone: 'normal' },
  { name: 'StandUp', label: 'STAND', tone: 'normal' },
  { name: 'Sit', label: 'SIT', tone: 'normal' },
  { name: 'Stretch', label: 'STRETCH', tone: 'normal' },
  { name: 'Hello', label: 'HELLO', tone: 'normal' },
];

export function SportPanel() {
  const { online } = useLiveStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(command: string) {
    setBusy(command);
    setMsg(null);
    try {
      const res = await fetch('/api/surveillance/sport', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      setMsg(res.ok ? body.message ?? `${command} sent` : body.error ?? `${command} failed (${res.status})`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">
          robot recovery & posture
        </span>
        {!online && (
          <span className="mono text-[10px] text-text-dim">offline</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SAFE_COMMANDS.map((c) => {
          const klass =
            c.tone === 'primary'
              ? 'btn btn-primary'
              : c.tone === 'danger'
                ? 'btn btn-danger'
                : 'btn';
          return (
            <button
              key={c.name}
              className={klass}
              disabled={!online || busy !== null}
              onClick={() => run(c.name)}
              title={c.name}
            >
              {busy === c.name ? '…' : c.label}
            </button>
          );
        })}
      </div>
      <div className="mono text-[10px] text-text-dim leading-snug">
        if the robot tips over, RECOVERY brings it back up. auto-recovery also
        runs when tilt &gt; ~53° for 2s.
      </div>
      {msg && <div className="mono text-[10px] text-text-muted truncate">{msg}</div>}
    </div>
  );
}
