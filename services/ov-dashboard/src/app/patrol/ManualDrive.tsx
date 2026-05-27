'use client';
import { useEffect, useRef, useState } from 'react';
import { useLiveStatus } from '@/components/LiveStatus';

/**
 * Game-style robot teleop using velocity commands.
 *
 * Each tick publishes a Twist on `/cmd_vel` (linear x/y, angular z).
 * The Go2's `cmd_vel_timeout = 0.2s` means the robot auto-halts the
 * moment we stop publishing — no explicit stop-on-release needed and
 * no goal-replanning sway from `relative_move`.
 *
 * Bindings:
 *   W / ↑ = forward       S / ↓ = back
 *   A      = strafe left   D     = strafe right
 *   ← / Q  = rotate CCW    → / E = rotate CW
 *   space  = emergency-stop (zero-twist)
 *   shift  = sprint (1.6× speed)
 *
 * Keys are ignored when the operator is typing in an input/textarea
 * so naming a waypoint doesn't accidentally drive the robot.
 */
type Dir = 'fwd' | 'back' | 'left' | 'right' | 'rotL' | 'rotR';

const KEY_MAP: Record<string, Dir> = {
  w: 'fwd',
  W: 'fwd',
  ArrowUp: 'fwd',
  s: 'back',
  S: 'back',
  ArrowDown: 'back',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
  q: 'rotL',
  Q: 'rotL',
  ArrowLeft: 'rotL',
  e: 'rotR',
  E: 'rotR',
  ArrowRight: 'rotR',
};

// Velocity teleop: publish a Twist every TICK_MS while held.
//
// Has to be comfortably under Go2's cmd_vel_timeout (200 ms) so the
// robot doesn't auto-stop mid-stroke when a single packet is delayed
// over the cellular relay. 50 ms (20 Hz) gives 4 in-flight commands
// before any timeout, matches the Unitree controller's typical rate.
//
// LINEAR_SPEED is tuned for INDOOR demo use. The Go2's joystick has
// a walking deadzone below ~0.5; we stay just above that for normal
// drive (gentle pace) and use SPRINT_MULT only when the operator
// holds Shift. dimos's reference teleop uses 1.25 / 1.2 — that's an
// open-area value, too fast for a conference floor or office.
const TICK_MS = 50;
const LINEAR_SPEED = 0.6; // m/s — base indoor walk
const ANGULAR_SPEED = 0.7; // rad/s — gentle indoor turn
const SPRINT_MULT = 1.6; // hold Shift to bump to ~0.96 / 1.12

export function ManualDrive() {
  const { online } = useLiveStatus();
  const [held, setHeld] = useState<Set<Dir>>(new Set());
  const [sprint, setSprint] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heldRef = useRef<Set<Dir>>(new Set());
  const sprintRef = useRef(false);
  const inFlightRef = useRef(false);

  // Mirror state into refs so the ticker callback doesn't capture stale values.
  useEffect(() => {
    heldRef.current = held;
  }, [held]);
  useEffect(() => {
    sprintRef.current = sprint;
  }, [sprint]);

  function press(d: Dir) {
    setHeld((s) => {
      if (s.has(d)) return s;
      const next = new Set(s);
      next.add(d);
      return next;
    });
  }

  function release(d: Dir) {
    setHeld((s) => {
      if (!s.has(d)) return s;
      const next = new Set(s);
      next.delete(d);
      return next;
    });
  }

  async function sendVel(linear_x: number, linear_y: number, angular_z: number) {
    if (inFlightRef.current) return; // Skip overlapping; next tick will publish.
    inFlightRef.current = true;
    try {
      const res = await fetch('/api/surveillance/cmd_vel', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linear_x, linear_y, angular_z }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(body.error ?? `move failed (${res.status})`);
      } else {
        setMsg(null);
      }
    } catch (e) {
      setMsg(`move failed: ${String(e).slice(0, 60)}`);
    } finally {
      inFlightRef.current = false;
    }
  }

  async function halt() {
    setHeld(new Set());
    // Bypass the in-flight guard so the stop always lands.
    inFlightRef.current = false;
    sendVel(0, 0, 0);
  }

  // Ticker: while any direction is held, fire a Twist every TICK_MS.
  useEffect(() => {
    if (held.size === 0) {
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
        // Explicit zero-twist on release so the robot halts instantly
        // rather than waiting for its 200ms cmd_vel watchdog.
        sendVel(0, 0, 0);
      }
      return;
    }
    if (tickerRef.current) return;
    const tick = () => {
      const s = heldRef.current;
      if (s.size === 0) return;
      const mult = sprintRef.current ? SPRINT_MULT : 1;
      let lx = 0;
      let ly = 0;
      let az = 0;
      if (s.has('fwd')) lx += LINEAR_SPEED * mult;
      if (s.has('back')) lx -= LINEAR_SPEED * mult;
      if (s.has('left')) ly += LINEAR_SPEED * mult;
      if (s.has('right')) ly -= LINEAR_SPEED * mult;
      if (s.has('rotL')) az += ANGULAR_SPEED * mult;
      if (s.has('rotR')) az -= ANGULAR_SPEED * mult;
      if (lx !== 0 || ly !== 0 || az !== 0) sendVel(lx, ly, az);
    };
    tick(); // fire one immediately
    tickerRef.current = setInterval(tick, TICK_MS);
    return () => {
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    };
  }, [held]);

  // Keyboard input — ignore when the operator is typing.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
      );
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        halt();
        return;
      }
      if (e.key === 'Shift') {
        setSprint(true);
        return;
      }
      const dir = KEY_MAP[e.key];
      if (!dir) return;
      e.preventDefault();
      press(dir);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setSprint(false);
        return;
      }
      const dir = KEY_MAP[e.key];
      if (!dir) return;
      release(dir);
    };
    const blur = () => {
      setHeld(new Set());
      setSprint(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const disabled = !online;

  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">
          manual drive
        </span>
        {sprint && (
          <span className="mono text-[10px] text-accent uppercase tracking-[0.04em]">
            sprint
          </span>
        )}
      </div>

      {/* D-pad: 5×3 grid sized for finger taps. Pointer events for
          press/release so it works on touch too. */}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr' }}
      >
        {/* row 1 */}
        <PadBtn label="Q" hint="rot ←" dir="rotL" held={held} disabled={disabled} onPress={press} onRelease={release} />
        <div />
        <PadBtn label="W" hint="fwd" dir="fwd" held={held} disabled={disabled} onPress={press} onRelease={release} />
        <div />
        <PadBtn label="E" hint="rot →" dir="rotR" held={held} disabled={disabled} onPress={press} onRelease={release} />
        {/* row 2 */}
        <div />
        <PadBtn label="A" hint="strafe ←" dir="left" held={held} disabled={disabled} onPress={press} onRelease={release} />
        <StopBtn disabled={disabled} onPress={halt} />
        <PadBtn label="D" hint="strafe →" dir="right" held={held} disabled={disabled} onPress={press} onRelease={release} />
        <div />
        {/* row 3 */}
        <div />
        <div />
        <PadBtn label="S" hint="back" dir="back" held={held} disabled={disabled} onPress={press} onRelease={release} />
        <div />
        <div />
      </div>

      <div className="mono text-[10px] text-text-dim leading-snug">
        keyboard: <kbd className="kbd">W</kbd>/<kbd className="kbd">A</kbd>/
        <kbd className="kbd">S</kbd>/<kbd className="kbd">D</kbd> drive ·{' '}
        <kbd className="kbd">Q</kbd>/<kbd className="kbd">E</kbd> rotate ·{' '}
        <kbd className="kbd">Shift</kbd> sprint · <kbd className="kbd">Space</kbd> stop
      </div>
      {!online && (
        <div className="mono text-[10px] text-text-dim">robot offline · start `make sim`</div>
      )}
      {msg && <div className="mono text-[10px] text-text-muted truncate">{msg}</div>}
    </div>
  );
}

function PadBtn({
  label,
  hint,
  dir,
  held,
  disabled,
  onPress,
  onRelease,
}: {
  label: string;
  hint: string;
  dir: Dir;
  held: Set<Dir>;
  disabled: boolean;
  onPress: (d: Dir) => void;
  onRelease: (d: Dir) => void;
}) {
  const active = held.has(dir);
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        onPress(dir);
      }}
      onPointerUp={(e) => {
        try {
          (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
        } catch {
          /* fine */
        }
        onRelease(dir);
      }}
      onPointerCancel={() => onRelease(dir)}
      onPointerLeave={(e) => {
        // If the operator drags off the button while still held, treat
        // as release — otherwise the robot would keep moving.
        if (held.has(dir)) onRelease(dir);
      }}
      className={`h-14 flex flex-col items-center justify-center mono text-sm border tracking-[0.04em] transition-colors select-none ${
        active
          ? 'bg-accent text-black border-accent'
          : 'bg-surface text-text border-border-strong hover:bg-surface-elev'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      title={hint}
    >
      <span>{label}</span>
      <span className="text-[9px] text-text-dim mt-0.5">{hint}</span>
    </button>
  );
}

function StopBtn({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className={`h-14 flex flex-col items-center justify-center mono text-sm border tracking-[0.04em] transition-colors select-none ${
        disabled
          ? 'opacity-40 cursor-not-allowed border-border-strong'
          : 'border-danger text-danger hover:bg-surface-elev'
      }`}
      title="stop · space"
    >
      <span>■</span>
      <span className="text-[9px] mt-0.5">stop</span>
    </button>
  );
}
