'use client';
import { useState } from 'react';
import { useLiveStatus } from '@/components/LiveStatus';

type Action = 'start' | 'stop' | 'pause' | 'resume';

export function PatrolControls() {
  const { state, online } = useLiveStatus();
  const [busy, setBusy] = useState<Action | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function call(action: Action) {
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch(`/api/surveillance/${action}`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (res.ok) setMsg(body.message ?? `${action.toUpperCase()} sent`);
      else setMsg(body.error ?? `${action} failed (${res.status})`);
    } catch (e) {
      setMsg(`${action} failed: ${String(e).slice(0, 80)}`);
    } finally {
      setBusy(null);
    }
  }

  const stateLabel = online ? state : 'OFFLINE';
  const isPatrolling = state === 'PATROLLING' || state === 'INSPECTING';
  const isPaused = state === 'MANUAL_OVERRIDE';

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">
          robot
        </span>
        <span className={statePill(stateLabel)}>{stateLabel}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          onClick={() => call('start')}
          disabled={busy !== null || isPatrolling}
          title="begin cycling enabled waypoints"
        >
          {busy === 'start' ? '…' : 'START PATROL'}
        </button>
        <button
          className="btn"
          onClick={() => call('pause')}
          disabled={busy !== null || !isPatrolling}
          title="hold position; resume later"
        >
          {busy === 'pause' ? '…' : 'PAUSE'}
        </button>
        <button
          className="btn"
          onClick={() => call('resume')}
          disabled={busy !== null || !isPaused}
          title="resume from saved cursor"
        >
          {busy === 'resume' ? '…' : 'RESUME'}
        </button>
        <button
          className="btn btn-danger"
          onClick={() => call('stop')}
          disabled={busy !== null || (state === 'IDLE' && !isPatrolling && !isPaused)}
          title="stop and return to IDLE; cursor reset"
        >
          {busy === 'stop' ? '…' : 'STOP'}
        </button>
      </div>
      {msg && <div className="mono text-xs text-text-muted">{msg}</div>}
      {!online && (
        <div className="mono text-xs text-text-dim">
          robot offline · start the dimos blueprint (`make sim` or `make robot`) to enable
          controls
        </div>
      )}
    </div>
  );
}

function statePill(s: string): string {
  switch (s) {
    case 'PATROLLING':
      return 'pill pill-inspecting';
    case 'INSPECTING':
      return 'pill pill-open';
    case 'MANUAL_OVERRIDE':
      return 'pill pill-muted';
    case 'IDLE':
    case 'COOLDOWN':
      return 'pill pill-muted';
    case 'OFFLINE':
      return 'pill pill-offline';
    default:
      return 'pill pill-muted';
  }
}
