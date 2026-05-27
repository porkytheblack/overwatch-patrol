'use client';
import { useState, useEffect } from 'react';

/**
 * Three-step onboarding explainer. Auto-dismisses once the operator has
 * at least one waypoint — at that point the steps below the banner
 * (drive controls, add form, map) self-explain. Operator can also
 * collapse it manually; the choice persists in localStorage so it
 * doesn't snap back open after a page nav.
 */
export function HowItWorks({ waypointCount }: { waypointCount: number }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = window.localStorage.getItem('ow.patrol.howto.dismissed') === '1';
    if (dismissed || waypointCount > 0) setCollapsed(true);
  }, [waypointCount]);

  function dismiss() {
    setCollapsed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ow.patrol.howto.dismissed', '1');
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="mono uppercase text-[10px] text-text-dim tracking-[0.04em] hover:text-text-muted"
      >
        show how patrol works
      </button>
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="mono uppercase text-sm tracking-[0.04em]">how patrol works</h2>
        <button
          onClick={dismiss}
          className="mono uppercase text-[10px] text-text-dim tracking-[0.04em] hover:text-text-muted"
          title="hide this panel"
        >
          DISMISS
        </button>
      </div>
      <ol className="grid grid-cols-1 md:grid-cols-3 gap-3 mono text-xs">
        <Step
          n={1}
          title="DRIVE TO A SPOT"
          body="Use the MANUAL DRIVE D-pad below to move the robot. The live camera shows what it sees."
        />
        <Step
          n={2}
          title="NAME IT A WAYPOINT"
          body='A waypoint is a named position the robot will return to — e.g. "front_gate" or "back_door". Click ADD WAYPOINT to save the current spot. Repeat for 2–5 locations.'
        />
        <Step
          n={3}
          title="START PATROL"
          body="The robot cycles your waypoints, looking for the targets you set per waypoint. Detections become incidents and ping Telegram if you've configured a bot."
        />
      </ol>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="border border-border p-3 space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="mono text-accent text-base font-medium">{n}</span>
        <span className="mono uppercase text-[10px] tracking-[0.04em] text-text">
          {title}
        </span>
      </div>
      <p className="text-text-muted leading-snug">{body}</p>
    </div>
  );
}
