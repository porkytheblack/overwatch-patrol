import { ConsoleMock } from './ConsoleMock';
import { Arrow } from './primitives';

const services = [
  { n: '01', label: 'Custom control software', href: '#deliver' },
  { n: '02', label: 'WhatsApp integration', href: '#deliver' },
  { n: '03', label: 'Telegram + smart monitoring', href: '#deliver' },
];

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="line-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" aria-hidden />
      <div className="relative px-5 pb-16 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pb-20 lg:pt-28">
        <p className="eyebrow" data-reveal>
          <span className="pulse-dot" />
          Autonomous security · installed &amp; provisioned
        </p>

        <h1 className="h-display mt-8" data-reveal style={{ ['--reveal-delay' as string]: '80ms' }}>
          <span className="block text-balance">Eyes on every gate.</span>
          <span className="block text-balance text-[#737373]">Answers in every chat.</span>
        </h1>

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-end">
          <p className="lede max-w-[46ch] text-pretty lg:col-span-6" data-reveal style={{ ['--reveal-delay' as string]: '160ms' }}>
            We survey your site, install and provision an autonomous patrol robot, build the control software your team
            runs it from, and wire every alert into WhatsApp and Telegram. Incidents reach your phone in seconds. The robot
            takes orders in plain language.
          </p>
          <div className="flex flex-col gap-6 lg:col-span-6 lg:items-end" data-reveal style={{ ['--reveal-delay' as string]: '240ms' }}>
            <div className="flex flex-wrap gap-3">
              <a href="#contact" className="btn btn-primary btn-lg">
                Book a site survey <Arrow />
              </a>
              <a href="#in-action" className="btn btn-lg">
                See it in action
              </a>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 lg:justify-end">
              {services.map((s) => (
                <li key={s.n}>
                  <a href={s.href} className="mono text-[11px] uppercase tracking-[0.08em] text-text-muted transition-colors hover:text-text">
                    <span className="text-accent">{s.n}</span> {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-16 lg:mt-20" data-reveal style={{ ['--reveal-delay' as string]: '320ms' }}>
          <ConsoleMock />
          <p className="mono mt-3 text-[10px] uppercase tracking-[0.08em] text-text-dim">
            Operator console · illustrative site · live view, patrol map, incident feed
          </p>
        </div>
      </div>
    </section>
  );
}

const stats = [
  {
    value: '≤30',
    unit: 's',
    label: 'Incident to alert',
    body: 'Snapshot, location and a signed playback link, on the phones of the people on shift.',
  },
  {
    value: '5',
    unit: 's',
    label: 'Pre-roll on every clip',
    body: 'Each incident is recorded from before the trigger, so you see what led up to it.',
  },
  {
    value: '24/7',
    unit: '',
    label: 'Autonomous patrol',
    body: 'Scheduled routes, inspection detours, and self-recovery if the robot goes down.',
  },
  {
    value: 'On-site',
    unit: '',
    label: 'Recordings & history',
    body: 'Clips and incident records stay on your hardware. You decide what leaves.',
  },
];

export function Stats() {
  return (
    <section aria-label="Key figures" className="relative border-t border-border">
      <span aria-hidden className="reg -left-[5px] -top-[5px]" />
      <span aria-hidden className="reg -right-[5px] -top-[5px]" />
      <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            data-reveal
            style={{ ['--reveal-delay' as string]: `${i * 80}ms` }}
            className="bg-bg px-5 py-10 sm:px-8 lg:px-10"
          >
            <dt className="label">{s.label}</dt>
            <dd className="mt-5">
              <span className="mono tabular text-[2.75rem] font-medium leading-none tracking-[-0.04em] text-text">
                {s.value}
                {s.unit ? <span className="ml-1 text-xl text-text-dim">{s.unit}</span> : null}
              </span>
              <p className="mt-4 max-w-[30ch] text-sm leading-relaxed text-text-muted">{s.body}</p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const events = [
  ['22:41:07', 'WP-04 LOADING DOCK', 'Person detected · track 17'],
  ['22:41:15', 'WP-04 LOADING DOCK', 'Linger 8.0 s · incident #0142 opened'],
  ['22:41:16', 'ROBOT', 'Deviating · standoff pose computed'],
  ['22:41:29', 'ROBOT', 'Inspecting · clip recording, 5 s pre-roll'],
  ['22:41:34', 'WHATSAPP', 'Alert delivered · Northgate night shift'],
  ['22:41:34', 'TELEGRAM', 'Alert delivered · 3 subscribers'],
  ['22:42:02', 'OPERATOR', "#0142 ACK'D via WhatsApp"],
  ['22:42:05', 'ROBOT', 'Resuming patrol · next WP-01 FRONT GATE'],
];

export function Ticker() {
  const row = (
    <ul className="flex shrink-0 items-center">
      {events.map(([t, src, msg], i) => (
        <li key={i} className="mono flex items-center gap-3 whitespace-nowrap px-6 text-[11px] uppercase tracking-[0.06em]">
          <span className="tabular text-text-dim">{t}</span>
          <span className="text-accent">{src}</span>
          <span className="text-text-muted">{msg}</span>
          <span className="ml-3 h-1 w-1 bg-border-strong" aria-hidden />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="relative overflow-hidden border-t border-border py-4" aria-label="Example event log" role="marquee">
      <div className="marquee flex w-max hover:[animation-play-state:paused]">
        {row}
        <div aria-hidden className="flex">
          {row}
        </div>
      </div>
    </div>
  );
}
