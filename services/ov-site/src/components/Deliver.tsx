import type { ReactNode } from 'react';
import { Plus, Section, SectionHeader } from './primitives';

type Pillar = {
  n: string;
  tag: string;
  title: string;
  body: string;
  items: string[];
  visual: ReactNode;
};

const pillars: Pillar[] = [
  {
    n: '01',
    tag: 'Custom control software',
    title: 'A console built around your site, not a template.',
    body: 'We deploy the operator console on your hardware and shape it to your layout, shifts and people. Live video with detection overlays, routes drawn on your own site map, incident review with playback, and manual control when you need it.',
    items: [
      'Site map with named waypoints and routes',
      'Live video with detection overlays',
      'Patrol schedules by shift and day',
      'Incident review with clip playback',
      'Manual drive and stance control',
      'Operator accounts and audit trail',
      'Alarm, access-control and CCTV hooks, scoped per site',
    ],
    visual: <ConsoleGlyph />,
  },
  {
    n: '02',
    tag: 'WhatsApp integration',
    title: 'Alerts where your team already talks.',
    body: 'We connect Overwatch to a WhatsApp Business number and route each alert to the right people and groups. Your team acknowledges, asks questions and directs the robot without installing anything new.',
    items: [
      'Alerts with snapshot, location and class',
      'Routing to people or groups, per shift',
      'One-tap acknowledge, logged with name and time',
      'Signed links to clip playback',
      'Plain-language questions and commands',
      'Escalation when an alert goes unanswered',
    ],
    visual: <NotificationGlyph />,
  },
  {
    n: '03',
    tag: 'Telegram + smart monitoring',
    title: 'An operator in your pocket.',
    body: 'A Telegram bot backed by an AI agent with direct access to the robot. Ask what happened overnight, send the robot to a gate or call it back. Answers are built from real incident records, not guesses.',
    items: [
      'Natural-language incident search and summaries',
      'Commands: go to, stop, follow, resume patrol',
      'Inline View and Acknowledge on every alert',
      'Explicit confirmation for disruptive commands',
      'Multiple subscribers, per-chat memory',
      'Bot token swapped from the console, no redeploy',
    ],
    visual: <AgentGlyph />,
  },
];

export function Deliver() {
  return (
    <Section id="deliver">
      <SectionHeader
        index="01"
        label="What we deliver"
        title={
          <>
            Three systems.
            <br />
            One installation.
          </>
        }
        lede="Every engagement is scoped to your site. We bring the robot, the software and the channels, and leave you with a patrol that runs itself and reports to the people who need to know."
      />

      <div className="mt-16 grid grid-cols-1 gap-px border border-border bg-border lg:grid-cols-3">
        {pillars.map((p, i) => (
          <article
            key={p.n}
            className="group relative flex flex-col bg-bg"
            data-reveal
            style={{ ['--reveal-delay' as string]: `${i * 100}ms` }}
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-accent transition-transform duration-500 group-hover:scale-x-100" />
            <div className="flex items-center justify-between px-6 pt-6 sm:px-8 sm:pt-8">
              <span className="mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
                <span className="text-accent">{p.n}</span> · {p.tag}
              </span>
            </div>
            <div className="mx-6 mt-6 h-52 overflow-hidden border border-border bg-[#0d0d0d] sm:mx-8">{p.visual}</div>
            <div className="flex flex-1 flex-col px-6 pb-8 pt-8 sm:px-8">
              <h3 className="h-card text-balance">{p.title}</h3>
              <p className="mt-4 text-[15px] leading-relaxed text-text-muted text-pretty">{p.body}</p>
              <ul className="mt-8 border-t border-border">
                {p.items.map((it) => (
                  <li key={it} className="flex items-start gap-3 border-b border-border py-3 text-sm text-text">
                    <Plus className="mt-1 shrink-0 text-accent" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}

/* ---- Card visuals --------------------------------------------------------- */

function ConsoleGlyph() {
  return (
    <div className="dot-grid flex h-full flex-col p-3">
      <div className="flex h-5 items-center justify-between border border-border bg-bg px-2">
        <span className="mono text-[8px] uppercase tracking-[0.1em] text-text-muted">Patrol · route A</span>
        <span className="mono bg-accent px-1.5 text-[8px] uppercase tracking-[0.06em] text-black">Start patrol</span>
      </div>
      <div className="mt-2 grid flex-1 grid-cols-5 gap-2">
        <div className="col-span-3 border border-border bg-bg p-1.5">
          <svg viewBox="0 0 120 80" className="h-full w-full" aria-hidden>
            <rect x="12" y="10" width="44" height="24" fill="#111" stroke="#2e2e2e" />
            <rect x="72" y="22" width="30" height="34" fill="#111" stroke="#2e2e2e" />
            <path d="M60 74 L57 50 L67 44 L67 16 L108 16 L108 66 L90 66 Z" fill="none" stroke="#f59e0b" strokeOpacity="0.5" strokeDasharray="2 2.5" />
            {[
              [60, 74],
              [57, 50],
              [90, 16],
              [90, 66],
            ].map(([x, y], i) => (
              <rect key={i} x={x - 2.5} y={y - 2.5} width="5" height="5" fill={i === 3 ? '#f59e0b' : '#0a0a0a'} stroke={i === 3 ? '#f59e0b' : '#737373'} />
            ))}
          </svg>
        </div>
        <div className="col-span-2 flex flex-col border border-border bg-bg">
          {['Front gate', 'Yard', 'North fence', 'Loading dock'].map((w, i) => (
            <div key={w} className="flex flex-1 items-center justify-between border-b border-border px-1.5 last:border-b-0">
              <span className="mono truncate text-[8px] uppercase tracking-[0.04em] text-text-muted">
                <span className="text-text-dim">0{i + 1}</span> {w}
              </span>
              <span className={`h-1.5 w-1.5 ${i === 3 ? 'bg-accent' : 'bg-border-strong'}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotificationGlyph() {
  const notes = [
    { t: 'now', title: 'Northgate · Night shift', body: 'Overwatch: Vehicle at NORTH FENCE · stationary 12 s', strong: true },
    { t: '2m', title: 'Northgate · Night shift', body: "Guard 2: Contractor van, booked for 23:00. Ack'd." },
    { t: '1h', title: 'Overwatch', body: 'Patrol resumed · next WP-01 FRONT GATE' },
  ];
  return (
    <div className="dot-grid flex h-full flex-col items-center justify-center gap-2 px-4">
      {notes.map((n, i) => (
        <div
          key={i}
          className={`w-full max-w-[290px] border bg-[#151515] px-3 py-2 ${n.strong ? 'border-wa/40' : 'border-border'}`}
          style={{ opacity: 1 - i * 0.22, transform: `scale(${1 - i * 0.03})` }}
        >
          <div className="flex items-center justify-between">
            <span className="mono flex items-center gap-1.5 text-[8px] uppercase tracking-[0.08em] text-text-muted">
              <span className="h-1.5 w-1.5 bg-wa" />
              WhatsApp · {n.title}
            </span>
            <span className="mono text-[8px] text-text-dim">{n.t}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-text">{n.body}</p>
        </div>
      ))}
    </div>
  );
}

function AgentGlyph() {
  return (
    <div className="dot-grid flex h-full flex-col justify-center gap-2 px-4 py-3">
      <div className="ml-auto max-w-[78%] border border-tg/30 bg-[#0e2234] px-3 py-1.5 text-[12px] text-text">go to the front gate</div>
      <div className="mono flex items-center gap-2 text-[9px] uppercase tracking-[0.06em] text-text-dim">
        <span className="h-px w-3 bg-border-strong" />
        tool · <span className="normal-case text-accent">go_to_waypoint(&quot;front_gate&quot;)</span>
      </div>
      <div className="max-w-[86%] border border-border bg-[#151515] px-3 py-1.5 text-[12px] text-text">
        Heading to FRONT GATE. Patrol paused, resumes after 60 s idle.
      </div>
      <div className="max-w-[86%] border border-border bg-[#151515] px-3 py-1.5">
        <span className="mono text-[11px] text-text-muted">arrived · front_gate</span>
      </div>
    </div>
  );
}
