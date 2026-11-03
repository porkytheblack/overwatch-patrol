'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { telegram, whatsapp, type Channel, type Msg, type RobotState, type Script, type Step } from '@/lib/scripts';
import { CameraView } from './CameraView';
import { Corners } from './primitives';
import { SiteMap, WAYPOINTS } from './SiteMap';
import { useReducedMotion } from './useReducedMotion';

type ShownMsg = Msg & { pressed?: string; amends?: string[] };
type LogLine = { kind: 'tool' | 'event' | 'held'; text: string; n: number };

const SCRIPTS: Record<Channel, Script> = { whatsapp, telegram };

const CHANNEL_META: Record<Channel, { label: string; dot: string; out: string; btn: string }> = {
  whatsapp: {
    label: 'WhatsApp',
    dot: 'bg-wa',
    out: 'bg-[#0f2a1e] border-[#1d4a35]',
    btn: 'text-wa',
  },
  telegram: {
    label: 'Telegram',
    dot: 'bg-tg',
    out: 'bg-[#0e2639] border-[#1b4466]',
    btn: 'text-tg',
  },
};

/** Applies one step to the visible state. Shared by the player and the reduced-motion render. */
function reduce(
  s: { msgs: ShownMsg[]; robot: RobotState; log: LogLine[] },
  step: Step,
  n: number,
): { msgs: ShownMsg[]; robot: RobotState; log: LogLine[] } {
  let msgs = s.msgs;
  if (step.press || step.amend) {
    const idx = [...msgs].reverse().findIndex((m) => (step.press ? m.buttons?.includes(step.press) : !!m.alert));
    if (idx >= 0) {
      const i = msgs.length - 1 - idx;
      const m = msgs[i]!;
      msgs = [...msgs];
      msgs[i] = { ...m, pressed: step.press ?? m.pressed, amends: step.amend ? [...(m.amends ?? []), step.amend] : m.amends };
    }
  }
  if (step.msg) msgs = [...msgs, step.msg];
  const robot = step.state ? { ...s.robot, ...step.state } : s.robot;
  const log = step.tool ? [...s.log, { ...step.tool, n }].slice(-7) : s.log;
  return { msgs, robot, log };
}

function finalState(script: Script) {
  return script.steps.reduce((acc, step, i) => reduce(acc, step, i), {
    msgs: [] as ShownMsg[],
    robot: script.initial,
    log: [] as LogLine[],
  });
}

export function Showcase() {
  const reduced = useReducedMotion();
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [run, setRun] = useState(0);
  const [inView, setInView] = useState(false);
  const [msgs, setMsgs] = useState<ShownMsg[]>([]);
  const [robot, setRobot] = useState<RobotState>(whatsapp.initial);
  const [log, setLog] = useState<LogLine[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [done, setDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const script = SCRIPTS[channel];
  const meta = CHANNEL_META[channel];

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Player. Restarts when the channel changes, on replay, or when scrolled back into view.
  useEffect(() => {
    if (reduced) {
      const f = finalState(script);
      setMsgs(f.msgs);
      setRobot(f.robot);
      setLog(f.log);
      setTyping(null);
      setComposer('');
      setDone(true);
      return;
    }
    if (!inView) return;

    let cancelled = false;
    const timers: number[] = [];
    const sleep = (ms: number) => new Promise<void>((r) => timers.push(window.setTimeout(r, ms)));
    let state = { msgs: [] as ShownMsg[], robot: script.initial, log: [] as LogLine[] };
    const commit = () => {
      setMsgs(state.msgs);
      setRobot(state.robot);
      setLog(state.log);
    };

    (async () => {
      commit();
      setTyping(null);
      setComposer('');
      setDone(false);
      for (let i = 0; i < script.steps.length; i++) {
        const step = script.steps[i]!;
        await sleep(step.wait);
        if (cancelled) return;
        if (step.msg?.from === 'me' && step.msg.text) {
          const text = step.msg.text;
          for (let c = 1; c <= text.length; c++) {
            setComposer(text.slice(0, c));
            await sleep(34);
            if (cancelled) return;
          }
          await sleep(260);
          if (cancelled) return;
          setComposer('');
        } else if (step.typing && step.msg) {
          setTyping(step.msg.author ?? script.chatTitle.split(' · ')[0] ?? 'Overwatch');
          await sleep(step.typing);
          if (cancelled) return;
          setTyping(null);
        }
        state = reduce(state, step, i);
        commit();
      }
      setDone(true);
    })();

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [script, run, inView, reduced]);

  // Keep the newest message in view without scrolling the page.
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [msgs, typing, reduced]);

  const switchTo = useCallback((c: Channel) => {
    setChannel(c);
    setRun((r) => r + 1);
  }, []);

  const pos = WAYPOINTS[robot.at];

  return (
    <div ref={rootRef} className="mt-16">
      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-b-0 border-border px-3 py-3 sm:px-4">
        <div role="tablist" aria-label="Channel" className="flex">
          {(Object.keys(CHANNEL_META) as Channel[]).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={channel === c}
              onClick={() => switchTo(c)}
              className={`mono flex h-9 items-center gap-2 border px-4 text-[11px] uppercase tracking-[0.08em] transition-colors ${
                channel === c ? 'border-border-strong bg-surface-elev text-text' : 'border-transparent text-text-dim hover:text-text-muted'
              }`}
            >
              <span className={`h-1.5 w-1.5 ${CHANNEL_META[c].dot}`} />
              {CHANNEL_META[c].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <span className="mono hidden text-[10px] uppercase tracking-[0.08em] text-text-dim sm:inline">
            {done ? 'Scenario complete' : 'Playing scenario'}
          </span>
          <button type="button" onClick={() => setRun((r) => r + 1)} className="btn btn-sm">
            Replay
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px border border-border bg-border lg:grid-cols-12">
        {/* chat */}
        <div className="flex flex-col bg-bg lg:col-span-7" aria-live="polite" aria-label={`${meta.label} conversation`}>
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center border border-border-strong bg-surface">
              <span className="pulse-dot" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-text">{script.chatTitle}</div>
              <div className="mono truncate text-[10px] uppercase tracking-[0.06em] text-text-dim">
                {typing ? <span className={meta.btn}>{typing} is typing…</span> : script.chatSubtitle}
              </div>
            </div>
            <span className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-text-muted">
              <span className={`h-1.5 w-1.5 ${meta.dot}`} />
              {meta.label}
            </span>
          </div>

          <div ref={chatRef} className="dot-grid min-h-[440px] flex-1 basis-0 overflow-y-auto px-3 py-4 sm:min-h-[500px] sm:px-5">
            <div className="flex min-h-full flex-col justify-end gap-2.5">
              <div className="mono mx-auto mb-2 border border-border bg-bg px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-dim">
                Today
              </div>
              {msgs.map((m, i) => (
                <Bubble key={`${run}-${i}`} m={m} channel={channel} />
              ))}
              {typing ? (
                <div className="msg-in flex w-fit items-center gap-1 border border-border bg-[#161616] px-3 py-3">
                  <span className="typing-dot h-1.5 w-1.5 bg-text-muted" />
                  <span className="typing-dot h-1.5 w-1.5 bg-text-muted" />
                  <span className="typing-dot h-1.5 w-1.5 bg-text-muted" />
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border p-3">
            <div className="flex h-10 flex-1 items-center border border-border bg-surface px-3 text-sm">
              {composer ? (
                <span className="text-text">
                  {composer}
                  <span className="blink ml-px inline-block h-4 w-px translate-y-0.5 bg-accent" />
                </span>
              ) : (
                <span className="text-text-dim">Message</span>
              )}
            </div>
            <div className={`flex h-10 w-10 items-center justify-center border ${composer ? 'border-accent bg-accent text-black' : 'border-border text-text-dim'}`}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          </div>
        </div>

        {/* robot state */}
        <div className="flex flex-col bg-bg lg:col-span-5">
          <div className="mono flex h-[61px] items-center justify-between border-b border-border px-4 text-[10px] uppercase tracking-[0.08em]">
            <span className="text-text-muted">Robot · live state</span>
            <span className="flex items-center gap-2 text-text-dim">
              <span className="pulse-dot" /> GO2-01
            </span>
          </div>
          <div className="relative aspect-[4/3] border-b border-border p-2">
            <SiteMap activeWaypoint={robot.at}>
              <g
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  transition: reduced ? 'none' : 'transform 2.8s cubic-bezier(.45,0,.2,1)',
                }}
              >
                {robot.mode === 'INSPECTING' || robot.mode === 'HOLDING' ? (
                  <circle r="5" fill="none" stroke="#f59e0b" className="ping" />
                ) : null}
                <rect x="-5" y="-5" width="10" height="10" fill="#f59e0b" />
                <rect x="-2" y="-2" width="4" height="4" fill="#0a0a0a" />
              </g>
            </SiteMap>
          </div>
          <dl className="grid grid-cols-2 gap-px border-b border-border bg-border">
            <Field k="Mode">
              <span className={`pill ${robot.mode === 'PATROLLING' ? 'pill-muted' : 'pill-inspecting'} !h-5`}>{robot.mode.replace('_', ' ')}</span>
            </Field>
            <Field k="Position">
              <span className="mono text-[12px] uppercase text-text">{WAYPOINTS[robot.at].name}</span>
            </Field>
            <Field k="Incident">
              {robot.incident ? (
                <span className="flex items-center gap-2">
                  <span className="mono tabular text-[12px] text-text">#{robot.incident.id}</span>
                  <span className={`pill ${robot.incident.state === 'OPEN' ? 'pill-open' : 'pill-ackd'} !h-5`}>{robot.incident.state}</span>
                </span>
              ) : (
                <span className="mono text-[12px] uppercase text-text-dim">None open</span>
              )}
            </Field>
            <Field k="Battery">
              <span className="flex items-center gap-2">
                <span className="mono tabular text-[12px] text-text">{robot.battery}%</span>
                <span className="relative h-1.5 w-14 border border-border-strong">
                  <span className="absolute inset-y-0 left-0 bg-success" style={{ width: `${robot.battery}%` }} />
                </span>
              </span>
            </Field>
          </dl>
          <div className="flex flex-1 flex-col">
            <div className="mono flex h-8 items-center justify-between border-b border-border px-4 text-[10px] uppercase tracking-[0.08em]">
              <span className="text-text-muted">Agent · tool calls &amp; events</span>
              <span className="text-text-dim">MCP</span>
            </div>
            <ol className="min-h-[196px] flex-1 px-4 py-3">
              {log.length === 0 ? (
                <li className="mono text-[11px] text-text-dim">Waiting for events…</li>
              ) : (
                log.map((l, i) => {
                  const newest = i === log.length - 1;
                  return (
                    <li key={`${run}-${l.n}`} className={`msg-in mono flex gap-3 py-1 text-[11px] leading-snug ${newest ? 'text-text' : 'text-text-dim'}`}>
                      <span className={`w-11 shrink-0 uppercase tracking-[0.06em] ${l.kind === 'tool' ? 'text-accent' : l.kind === 'held' ? 'text-accent-strong' : 'text-text-muted'} ${newest ? '' : 'opacity-60'}`}>
                        {l.kind === 'held' ? 'hold' : l.kind}
                      </span>
                      <span className="min-w-0 break-words">{l.text}</span>
                    </li>
                  );
                })
              )}
            </ol>
          </div>
        </div>
      </div>
      <p className="mono mt-3 text-[10px] uppercase tracking-[0.08em] text-text-dim">
        Scripted demonstration · message formats, states and tool names match the production system
      </p>
    </div>
  );
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg px-4 py-3">
      <dt className="label !text-[9px]">{k}</dt>
      <dd className="mt-1.5 flex min-h-5 items-center">{children}</dd>
    </div>
  );
}

function Bubble({ m, channel }: { m: ShownMsg; channel: Channel }) {
  const meta = CHANNEL_META[channel];

  if (m.from === 'system') {
    return (
      <div className="msg-in mono mx-auto my-1 flex items-center gap-2 border border-border bg-bg px-2.5 py-1 text-[10px] uppercase tracking-[0.06em] text-success">
        <span className="h-1 w-1 bg-success" />
        {m.text}
      </div>
    );
  }

  const mine = m.from === 'me';
  const base = mine ? `ml-auto ${meta.out}` : 'border-border bg-[#161616]';

  return (
    <div className={`msg-in flex max-w-[88%] flex-col sm:max-w-[78%] ${mine ? 'ml-auto items-end' : 'items-start'}`}>
      <div className={`w-full border ${base}`}>
        {m.author && !mine ? (
          <div className={`mono px-3 pt-2 text-[10px] uppercase tracking-[0.06em] ${m.from === 'bot' ? 'text-accent' : 'text-text-muted'}`}>{m.author}</div>
        ) : null}

        {m.alert ? (
          <div className="p-1.5 pb-0">
            <div className="aspect-[16/9] w-full min-w-[220px] border border-border sm:min-w-[300px]">
              <CameraView scene={m.alert.scene} timestamp={`2026-11-03 ${m.alert.stamp}`} still status="Snapshot" />
            </div>
            <div className="px-1.5 pb-1 pt-2.5">
              <div className="mono text-[11px] uppercase tracking-[0.06em] text-text">
                <span className="text-accent">[Overwatch]</span> · {m.alert.title}
              </div>
              {m.alert.lines.map((l) => (
                <div key={l} className="mt-1 text-[13px] leading-snug text-text-muted">
                  {l}
                </div>
              ))}
              {m.amends?.map((a) => (
                <div key={a} className="mono mt-2 text-[11px] uppercase tracking-[0.04em] text-success">
                  {a}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {m.snapshot ? (
          <div className="p-1.5 pb-0">
            <div className="aspect-[16/9] w-full min-w-[220px] border border-border sm:min-w-[280px]">
              <CameraView scene={m.snapshot.scene} timestamp={`2026-11-03 ${m.snapshot.stamp}`} still status={m.snapshot.status} />
            </div>
          </div>
        ) : null}

        {m.text ? (
          <div className={`whitespace-pre-line px-3 py-2 text-[13.5px] leading-snug ${mine ? 'text-text' : 'text-text'} ${/^[a-z_]+ · /.test(m.text) ? 'mono text-[12px] text-text-muted' : ''}`}>
            {m.text}
          </div>
        ) : null}

        {m.link ? (
          <a href={m.link.href} className={`mono mx-3 mb-2 flex items-center justify-between gap-3 border border-border bg-bg px-2.5 py-2 text-[10px] uppercase tracking-[0.06em] ${meta.btn}`}>
            {m.link.label}
            <span aria-hidden>↗</span>
          </a>
        ) : null}

        <div className="mono px-3 pb-1.5 text-right text-[9px] tabular text-text-dim">{m.time}</div>
      </div>

      {m.buttons ? (
        <div className={`mt-1 grid w-full gap-1 ${m.buttons.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {m.buttons.map((b) => {
            const pressed = m.pressed === b;
            return (
              <span
                key={b}
                className={`mono flex h-8 items-center justify-center border text-[10px] uppercase tracking-[0.08em] transition-colors duration-300 ${
                  pressed ? 'border-accent bg-[#211808] text-accent' : `border-border bg-[#141414] ${meta.btn}`
                }`}
              >
                {pressed ? '✓ ' : ''}
                {b}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
