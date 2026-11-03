'use client';

import { useEffect, useState } from 'react';
import { CameraView } from './CameraView';
import { Corners } from './primitives';
import { DetectionMarker, ROUTE, RobotGlyph, SiteMap } from './SiteMap';
import { useReducedMotion } from './useReducedMotion';

// The story starts at a fixed moment so the clock, incident list and camera
// overlay agree with each other. It then ticks forward in real time.
const START = new Date('2026-11-03T22:41:07');

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function fmt(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const INCIDENTS = [
  { id: '0142', wp: 'LOADING DOCK', cls: 'person', t: '22:41', state: 'INSPECTING', pill: 'pill-inspecting' },
  { id: '0141', wp: 'NORTH FENCE', cls: 'vehicle', t: '21:52', state: 'RESOLVED', pill: 'pill-resolved' },
  { id: '0140', wp: 'FRONT GATE', cls: 'person', t: '19:08', state: "ACK'D", pill: 'pill-ackd' },
  { id: '0139', wp: 'YARD', cls: 'person', t: '17:33', state: "ACK'D", pill: 'pill-ackd' },
];

export function ConsoleMock() {
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [reduced]);

  const now = new Date(START.getTime() + elapsed * 1000);
  // Loops so the overlay never runs into implausible numbers on a long visit.
  const linger = `${(8.2 + (elapsed % 24)).toFixed(1).padStart(4, '0')}s`;

  return (
    <div className="relative border border-border-strong bg-bg" aria-label="Overwatch operator console, illustrative" role="img">
      <Corners />
      {/* title bar */}
      <div className="flex h-10 items-center justify-between gap-4 border-b border-border px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="pulse-dot" />
          <span className="wordmark truncate text-[11px]">Overwatch</span>
          <span className="mono hidden truncate text-[10px] uppercase tracking-[0.08em] text-text-dim sm:inline">
            / Site · Northgate depot
          </span>
        </div>
        <div className="mono hidden items-center gap-5 text-[10px] uppercase tracking-[0.08em] text-text-dim md:flex">
          <span className="text-text">Live</span>
          <span>Patrol</span>
          <span>Incidents</span>
          <span>Calendar</span>
          <span>Settings</span>
        </div>
        <div className="mono tabular flex items-center gap-3 text-[10px] tracking-[0.04em] text-text-muted">
          <span className="hidden sm:inline">{fmt(now)}</span>
          <span className="pill pill-muted !h-5">Online</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* map */}
        <div className="border-b border-border lg:col-span-5 lg:border-b-0 lg:border-r">
          <PaneHeader left="Patrol · route A" right="03 / 04" />
          <div className="aspect-[4/3] p-2">
            <SiteMap activeWaypoint="dock">
              <DetectionMarker x={322} y={214} label="TRK 17" />
              {reduced ? (
                <g transform="translate(360 150) rotate(90)">
                  <RobotGlyph />
                </g>
              ) : (
                <g>
                  <animateMotion dur="32s" repeatCount="indefinite" rotate="auto" path={ROUTE} />
                  <RobotGlyph />
                </g>
              )}
            </SiteMap>
          </div>
        </div>

        {/* camera */}
        <div className="border-b border-border lg:col-span-4 lg:border-b-0 lg:border-r">
          <PaneHeader left="Live view" right="Tracking · 1 target" accent />
          <div className="aspect-[4/3] p-2">
            <div className="h-full w-full border border-border">
              <CameraView timestamp={fmt(now)} status={`Linger ${linger}`} />
            </div>
          </div>
        </div>

        {/* incidents + telemetry */}
        <div className="flex flex-col lg:col-span-3">
          <PaneHeader left="Incidents · 24h" right="4" />
          <ul className="flex-1">
            {INCIDENTS.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="mono tabular text-[11px] text-text">
                    <span className="text-text-dim">#</span>
                    {i.id} <span className="text-text-dim">·</span> {i.t}
                  </div>
                  <div className="mono mt-0.5 truncate text-[10px] uppercase tracking-[0.04em] text-text-dim">
                    {i.wp} · {i.cls}
                  </div>
                </div>
                <span className={`pill ${i.pill} !h-5 !px-1.5 !text-[9px]`}>{i.state}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-2">
            {[
              ['Mode', 'Patrolling'],
              ['Battery', '82%'],
              ['Next', 'WP-01'],
              ['Uptime', '14d 06h'],
            ].map(([k, v], idx) => (
              <div key={k} className={`border-border px-3 py-2.5 ${idx % 2 === 0 ? 'border-r' : ''} ${idx < 2 ? 'border-b' : ''}`}>
                <dt className="label !text-[9px]">{k}</dt>
                <dd className="mono tabular mt-1 text-[12px] uppercase text-text">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

function PaneHeader({ left, right, accent }: { left: string; right: string; accent?: boolean }) {
  return (
    <div className="mono flex h-8 items-center justify-between border-b border-border px-3 text-[10px] uppercase tracking-[0.08em]">
      <span className="text-text-muted">{left}</span>
      <span className={accent ? 'text-accent' : 'text-text-dim'}>{right}</span>
    </div>
  );
}
