'use client';
import { useState } from 'react';
import { useLiveStatus } from '@/components/LiveStatus';

/**
 * Manual drive controls. Each click sends a single `relative_move` step
 * over MCP. Hold-to-repeat is intentionally not wired — sport command
 * confirmation rules (spec §13) want every motion to be an explicit
 * operator action, and the spec's nav skills already do their own
 * obstacle avoidance during each step.
 */
export function ManualDrive() {
  const { online } = useLiveStatus();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Step sizes match dimos's NavigationSkillContainer defaults.
  const [step, setStep] = useState(0.3); // metres
  const [turn, setTurn] = useState(30); // degrees

  async function move(forward: number, left: number, degrees: number) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/surveillance/move', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forward, left, degrees }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      setMsg(res.ok ? body.message ?? 'ok' : body.error ?? `failed (${res.status})`);
    } finally {
      setBusy(false);
    }
  }

  async function halt() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/surveillance/halt', {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      setMsg(res.ok ? body.message ?? 'halted' : body.error ?? `failed (${res.status})`);
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || !online;
  return (
    <div className="card space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">
          manual drive
        </span>
        {!online && (
          <span className="mono text-xs text-text-dim">robot offline · run `make sim` / `make robot`</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 max-w-[180px]">
        <div />
        <button
          className="btn"
          disabled={disabled}
          onClick={() => move(step, 0, 0)}
          title={`forward ${step}m`}
        >
          ↑
        </button>
        <div />
        <button
          className="btn"
          disabled={disabled}
          onClick={() => move(0, step, 0)}
          title={`left ${step}m`}
        >
          ←
        </button>
        <button
          className="btn btn-danger"
          disabled={disabled}
          onClick={halt}
          title="stop"
        >
          ■
        </button>
        <button
          className="btn"
          disabled={disabled}
          onClick={() => move(0, -step, 0)}
          title={`right ${step}m`}
        >
          →
        </button>
        <div />
        <button
          className="btn"
          disabled={disabled}
          onClick={() => move(-step, 0, 0)}
          title={`back ${step}m`}
        >
          ↓
        </button>
        <div />
        <button
          className="btn"
          disabled={disabled}
          onClick={() => move(0, 0, turn)}
          title={`rotate +${turn}°`}
        >
          ⟲
        </button>
        <div />
        <button
          className="btn"
          disabled={disabled}
          onClick={() => move(0, 0, -turn)}
          title={`rotate −${turn}°`}
        >
          ⟳
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mono text-xs text-text-dim items-center">
        <label className="flex items-center gap-1">
          <span className="uppercase tracking-[0.04em]">step (m)</span>
          <input
            type="number"
            className="input w-16"
            step={0.1}
            min={0.05}
            max={1}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="uppercase tracking-[0.04em]">turn (°)</span>
          <input
            type="number"
            className="input w-16"
            step={5}
            min={5}
            max={180}
            value={turn}
            onChange={(e) => setTurn(Number(e.target.value))}
          />
        </label>
      </div>

      {msg && <div className="mono text-xs text-text-muted truncate">{msg}</div>}
    </div>
  );
}
