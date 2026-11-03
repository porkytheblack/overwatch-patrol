import { Section, SectionHeader } from './primitives';

const steps = [
  {
    title: 'Site survey',
    body: 'We walk the perimeter with you. We map coverage, choose waypoints, check network and charging positions, and agree on what counts as an incident on your site.',
    out: ['Coverage plan', 'Waypoint and route proposal', 'Network assessment', 'Quote'],
  },
  {
    title: 'Robot provisioning',
    body: 'We bring the robot onto your network, map the site, name waypoints where it physically stands, and set detection targets, linger thresholds and scene descriptions per zone.',
    out: ['Mapped site', 'Named waypoints', 'Detection profile per zone'],
  },
  {
    title: 'Control software',
    body: 'We install the console on hardware at your site and tailor it: views, schedules, operator accounts and any integrations agreed in the survey.',
    out: ['On-site console', 'Operator accounts', 'Patrol schedule'],
  },
  {
    title: 'WhatsApp and Telegram',
    body: 'We connect your WhatsApp Business number and Telegram bot, register subscribers and groups, and decide who gets which alerts, when, and what happens if nobody answers.',
    out: ['Live alert routing', 'Subscriber list', 'Escalation rules'],
  },
  {
    title: 'Drill and handover',
    body: 'We run live drills with your team: incidents triggered on site, acknowledged from phones, the robot directed from chat. Then we hand over the runbook.',
    out: ['Live drill', 'Runbook', 'Team training'],
  },
  {
    title: 'Ongoing support',
    body: 'Optional managed service. We watch system health, ship updates, add detection targets and retune routes as your site changes.',
    out: ['Health monitoring', 'Updates', 'Route and threshold tuning'],
  },
];

export function Deployment() {
  return (
    <Section id="deployment">
      <SectionHeader
        index="05"
        label="Installation & provisioning"
        title="From site survey to standing patrol."
        lede="One team owns the whole job, from the first walk of your perimeter to the night your shift lead acknowledges an alert from their phone without thinking about it."
      />

      <ol className="mt-16 border-t border-border">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="group grid grid-cols-1 gap-6 border-b border-border py-8 transition-colors md:grid-cols-12 md:gap-8 md:py-10"
            data-reveal
            style={{ ['--reveal-delay' as string]: `${i * 40}ms` }}
          >
            <div className="flex items-baseline gap-4 md:col-span-4">
              <span className="mono tabular text-[2rem] font-medium leading-none tracking-[-0.04em] text-text-dim transition-colors group-hover:text-accent md:text-[2.75rem]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="text-xl font-medium tracking-[-0.015em] text-text">{s.title}</h3>
            </div>
            <p className="text-[15px] leading-relaxed text-text-muted text-pretty md:col-span-5">{s.body}</p>
            <ul className="flex flex-wrap content-start gap-2 md:col-span-3 md:flex-col md:items-start">
              {s.out.map((o) => (
                <li key={o} className="mono border border-border px-2 py-1 text-[10px] uppercase tracking-[0.06em] text-text-muted">
                  {o}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Section>
  );
}
