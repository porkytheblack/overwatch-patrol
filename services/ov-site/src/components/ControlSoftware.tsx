import { Corners, Section, SectionHeader } from './primitives';

const modules = [
  ['Live view', 'Robot camera with detection boxes, track IDs and linger timers drawn over the feed.'],
  ['Patrol editor', 'Name waypoints where the robot stands, set targets, linger and dwell per zone, and describe what normal looks like.'],
  ['Schedules', 'Patrols by shift and day on a calendar, with overrides for holidays and events.'],
  ['Incidents', 'Every incident with its clip, classes, waypoint, timeline and who acknowledged it.'],
  ['Manual drive', 'Keyboard and on-screen control, stance commands and an always-available stop.'],
  ['Operators', 'Individual accounts with hashed credentials, and a record of who did what.'],
  ['Integrations', 'Alarm panels, access control, existing CCTV or your own systems via webhooks, scoped in the survey.'],
];

const waypoints = [
  { id: 'WP-01', name: 'Front gate', targets: 'person, vehicle', linger: '6 s', dwell: '20 s', scene: 'Vehicle gate, staffed 07:00–19:00' },
  { id: 'WP-02', name: 'Yard', targets: 'person', linger: '10 s', dwell: '15 s', scene: 'Container stacks, no foot traffic after 20:00' },
  { id: 'WP-03', name: 'North fence', targets: 'person, vehicle', linger: '8 s', dwell: '20 s', scene: 'Public road beyond the fence line' },
  { id: 'WP-04', name: 'Loading dock', targets: 'person', linger: '8 s', dwell: '25 s', scene: 'Bays 1–3, deliveries 06:00–18:00' },
];

// Patrol windows per day as [startHour, endHour] on a 0–24 axis.
const schedule: [string, [number, number][]][] = [
  ['Mon', [[0, 6], [18, 24]]],
  ['Tue', [[0, 6], [18, 24]]],
  ['Wed', [[0, 6], [18, 24]]],
  ['Thu', [[0, 6], [18, 24]]],
  ['Fri', [[0, 6], [18, 24]]],
  ['Sat', [[0, 24]]],
  ['Sun', [[0, 24]]],
];

export function ControlSoftware() {
  return (
    <Section id="console">
      <SectionHeader
        index="03"
        label="Control software"
        title="Your site, your rules, one console."
        lede="Not a generic dashboard. We configure the console to your layout and your operation, and extend it where you need it. It runs on hardware at your site, so it keeps working when the internet doesn't."
      />

      <div className="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-10">
        <ol className="border-t border-border lg:col-span-4">
          {modules.map(([title, body], i) => (
            <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-2 border-b border-border py-5" data-reveal style={{ ['--reveal-delay' as string]: `${i * 50}ms` }}>
              <span className="mono pt-0.5 text-[11px] text-accent">0{i + 1}</span>
              <div>
                <h3 className="text-[15px] font-medium text-text">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="min-w-0 lg:col-span-8" data-reveal style={{ ['--reveal-delay' as string]: '150ms' }}>
          <div className="lg:sticky lg:top-24">
          <div className="relative border border-border-strong bg-bg" role="img" aria-label="Patrol editor, illustrative">
            <Corners />
            <div className="flex h-11 items-center justify-between gap-3 border-b border-border px-4">
              <span className="mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
                Patrol <span className="text-text-dim">/</span> <span className="text-text">Route A</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="btn btn-sm hidden sm:inline-flex">Add waypoint</span>
                <span className="btn btn-sm btn-primary">Start patrol</span>
              </div>
            </div>

            {/* waypoint table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left">
                <thead>
                  <tr className="border-b border-border">
                    {['WP', 'Name', 'Targets', 'Linger', 'Dwell', 'Scene'].map((h) => (
                      <th key={h} className="label px-4 py-2.5 font-normal !text-[10px]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {waypoints.map((w, i) => (
                    <tr key={w.id} className={`border-b border-border ${i === 3 ? 'bg-surface' : ''}`}>
                      <td className="mono whitespace-nowrap px-4 py-3 text-[12px] text-text-dim">{w.id}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-text">
                        <span className="flex items-center gap-2">
                          {i === 3 ? <span className="h-1.5 w-1.5 bg-accent" /> : null}
                          {w.name}
                        </span>
                      </td>
                      <td className="mono px-4 py-3 text-[11px] uppercase text-text-muted">{w.targets}</td>
                      <td className="mono tabular px-4 py-3 text-[12px] text-text">{w.linger}</td>
                      <td className="mono tabular px-4 py-3 text-[12px] text-text">{w.dwell}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-[12px] text-text-muted">{w.scene}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-5">
              {/* schedule */}
              <div className="bg-bg p-4 md:col-span-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="label !text-[10px]">Schedule · this week</span>
                  <span className="mono text-[10px] uppercase text-text-dim">Site time</span>
                </div>
                <div className="space-y-1.5">
                  {schedule.map(([day, spans]) => (
                    <div key={day} className="grid grid-cols-[2.25rem_1fr] items-center gap-2">
                      <span className="mono text-[10px] uppercase text-text-dim">{day}</span>
                      <div className="relative h-4 border border-border bg-surface">
                        {spans.map(([a, b]) => (
                          <span
                            key={a}
                            className="absolute inset-y-0 bg-accent/80"
                            style={{ left: `${(a / 24) * 100}%`, width: `${((b - a) / 24) * 100}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[2.25rem_1fr] gap-2">
                    <span />
                    <div className="mono flex justify-between text-[9px] text-text-dim">
                      <span>00</span>
                      <span>06</span>
                      <span>12</span>
                      <span>18</span>
                      <span>24</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* manual drive */}
              <div className="bg-bg p-4 md:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <span className="label !text-[10px]">Manual drive</span>
                  <span className="pill pill-muted !h-5">Standby</span>
                </div>
                <div className="flex items-center gap-5">
                  <div className="grid grid-cols-3 gap-1">
                    {['', 'W', '', 'A', 'S', 'D'].map((k, i) =>
                      k ? (
                        <span key={i} className={`mono flex h-8 w-8 items-center justify-center border text-[11px] ${k === 'W' ? 'border-accent text-accent' : 'border-border-strong text-text-muted'}`}>
                          {k}
                        </span>
                      ) : (
                        <span key={i} />
                      ),
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    {['Stand', 'Sit'].map((s) => (
                      <span key={s} className="btn btn-sm w-full">
                        {s}
                      </span>
                    ))}
                    <span className="btn btn-sm w-full border-danger text-danger">Stop</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="mono mt-3 text-[10px] uppercase tracking-[0.08em] text-text-dim">Patrol editor · illustrative configuration</p>
          </div>
        </div>
      </div>
    </Section>
  );
}
