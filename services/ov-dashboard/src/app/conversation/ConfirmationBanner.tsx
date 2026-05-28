'use client';
import type { PendingConfirmation } from '@overwatch/agent';
// Local mirror of agent's describeAction — see describeAction.ts for
// why we can't import it from @overwatch/agent directly in the browser.
import { describeAction } from './describeAction';

interface Props {
  pending: PendingConfirmation;
  busy: boolean;
  onConfirm: (answer: 'y' | 'n') => void;
}

/**
 * Renders the amber "waiting on confirm" banner when the agent has
 * trapped a confirmation-required tool call (spec §13).
 *
 * `describeAction` is the same helper Telegram uses to format the
 * action label, so the two surfaces stay in lockstep — operators see
 * the same wording regardless of channel.
 */
export function ConfirmationBanner({ pending, busy, onConfirm }: Props) {
  return (
    <div className="card my-2 flex flex-wrap items-center gap-3 border-accent">
      <span className="pill pill-inspecting shrink-0">WAITING ON CONFIRM</span>
      <span className="mono text-sm flex-1 min-w-0 truncate">
        {describeAction(pending.tool, pending.args)}
      </span>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onConfirm('y')}
          disabled={busy}
        >
          CONFIRM
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onConfirm('n')}
          disabled={busy}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}
