import type { ReactNode } from 'react';
import { Section, SectionHeader } from './primitives';

const S = { fill: 'none', stroke: '#f59e0b', strokeWidth: 1.25 } as const;

const caps: { title: string; body: string; glyph: ReactNode }[] = [
  {
    title: 'Person and vehicle detection',
    body: 'On-robot detection with stable track IDs, so one person is one track, not fifty alerts.',
    glyph: (
      <g {...S}>
        <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
        <circle cx="12" cy="9.5" r="2.25" />
        <path d="M8 17c.6-2.4 2.1-3.6 4-3.6s3.4 1.2 4 3.6" />
      </g>
    ),
  },
  {
    title: 'Linger thresholds per zone',
    body: 'Someone walking past is not an incident. Someone standing at the dock for eight seconds is.',
    glyph: (
      <g {...S}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.5 2" />
      </g>
    ),
  },
  {
    title: 'Autonomous inspection',
    body: 'The robot leaves its route, takes a safe standoff position, holds, then resumes from where it left off.',
    glyph: (
      <g {...S}>
        <path d="M3 18h6l3-9 3 9h6" strokeDasharray="0" />
        <rect x="10.5" y="4" width="3" height="3" fill="#f59e0b" />
      </g>
    ),
  },
  {
    title: 'Clips with pre-roll',
    body: 'Every incident is recorded from five seconds before the trigger, with a poster frame for the alert.',
    glyph: (
      <g {...S}>
        <rect x="3" y="6" width="13" height="12" />
        <path d="M16 10l5-3v10l-5-3" />
        <rect x="6" y="9" width="2" height="2" fill="#f59e0b" stroke="none" />
      </g>
    ),
  },
  {
    title: 'Ask in plain language',
    body: '“Anything at the dock after midnight?” The agent searches real incident records and answers in a line or two.',
    glyph: (
      <g {...S}>
        <path d="M4 5h16v11H10l-4 3v-3H4z" />
        <path d="M8 9h8M8 12h5" />
      </g>
    ),
  },
  {
    title: 'Scene context per waypoint',
    body: 'Describe what normal looks like at each stop: deliveries until 18:00, staffed gate, no foot traffic after dark.',
    glyph: (
      <g {...S}>
        <rect x="4" y="4" width="6" height="6" />
        <path d="M13 5h7M13 8h5M4 14h16M4 17h12M4 20h9" />
      </g>
    ),
  },
  {
    title: 'Fall detection and recovery',
    body: 'If the robot goes down on rough ground it detects the fall, gets back up and carries on.',
    glyph: (
      <g {...S}>
        <path d="M5 19h14" />
        <path d="M12 16V5M8 9l4-4 4 4" />
      </g>
    ),
  },
  {
    title: 'Scheduled patrols',
    body: 'Patrol windows by shift and day, set on a calendar. Out-of-hours coverage without out-of-hours staff.',
    glyph: (
      <g {...S}>
        <rect x="3.5" y="5" width="17" height="15" />
        <path d="M3.5 9.5h17M8 3v4M16 3v4" />
        <rect x="7" y="12.5" width="3" height="3" fill="#f59e0b" stroke="none" />
      </g>
    ),
  },
  {
    title: 'Fail-visible status',
    body: 'If the robot drops off the network the console turns red at once. Silence never means all clear.',
    glyph: (
      <g {...S}>
        <path d="M4 10a11.3 11.3 0 0 1 16 0M7 13.5a6.5 6.5 0 0 1 10 0" />
        <rect x="10.5" y="16.5" width="3" height="3" fill="#f59e0b" stroke="none" />
      </g>
    ),
  },
];

const timeline = [
  { t: 'T+00.0 s', title: 'Detect', body: 'Person detected at LOADING DOCK. Track 17 assigned.' },
  { t: 'T+08.0 s', title: 'Linger', body: 'Track stays past the zone threshold. Incident #0142 opens.' },
  { t: 'T+08.4 s', title: 'Deviate', body: 'Patrol pauses at its cursor. Standoff pose computed.' },
  { t: 'T+21 s', title: 'Inspect', body: 'Robot holds at standoff. Clip records with 5 s pre-roll.' },
  { t: '≤ T+38 s', title: 'Alert', body: 'WhatsApp and Telegram: snapshot, place, signed playback link.' },
  { t: 'Operator', title: 'Acknowledge', body: 'One tap from chat, attributed and logged. Patrol resumes.' },
];

export function Monitoring() {
  return (
    <Section id="monitoring">
      <SectionHeader
        index="04"
        label="Smart monitoring"
        title="Monitoring that decides what matters."
        lede="Motion alarms tell you something moved. Overwatch tells you who stayed, where, for how long, what the robot saw when it went to look, and lets you ask follow-up questions."
      />

      <div className="mt-16 grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {caps.map((c, i) => (
          <div key={c.title} className="group bg-bg p-6 transition-colors hover:bg-surface sm:p-8" data-reveal style={{ ['--reveal-delay' as string]: `${(i % 3) * 80}ms` }}>
            <div className="flex items-start justify-between">
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
                {c.glyph}
              </svg>
              <span className="mono text-[10px] text-text-dim">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <h3 className="mt-8 text-[17px] font-medium tracking-[-0.01em] text-text">{c.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted text-pretty">{c.body}</p>
          </div>
        ))}
      </div>

      {/* Anatomy of an incident */}
      <div className="mt-24">
        <div className="flex flex-wrap items-end justify-between gap-4" data-reveal>
          <h3 className="text-2xl font-medium tracking-[-0.02em] text-text sm:text-3xl">Anatomy of an incident</h3>
          <span className="mono text-[10px] uppercase tracking-[0.08em] text-text-dim">Illustrative timings · the alert target is 30 s from incident open</span>
        </div>

        <div className="relative mt-10" data-reveal>
          <div aria-hidden className="absolute left-0 right-0 top-[7px] hidden h-px bg-border lg:block" />
          <div aria-hidden className="tl-progress absolute left-0 right-0 top-[7px] hidden h-px bg-accent lg:block" />
          <div aria-hidden className="absolute bottom-0 left-[7px] top-0 w-px bg-border lg:hidden" />
          <ol className="grid grid-cols-1 gap-8 lg:grid-cols-6 lg:gap-6">
            {timeline.map((s, i) => (
              <li key={s.title} className="relative pl-8 lg:pl-0 lg:pt-8">
                <span
                  aria-hidden
                  className={`absolute left-0 top-0 h-[15px] w-[15px] border ${i === 1 || i === 4 ? 'border-accent bg-accent' : 'border-border-strong bg-bg'}`}
                />
                <div className="mono tabular text-[11px] uppercase tracking-[0.06em] text-accent">{s.t}</div>
                <div className="mt-2 text-[15px] font-medium text-text">{s.title}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}
