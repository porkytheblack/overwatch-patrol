import { Arrow, Check, Section, SectionHeader } from './primitives';

const tiers = [
  {
    name: 'Pilot',
    line: 'Prove it on your site.',
    items: [
      'Site survey and coverage plan',
      'One robot, one patrol route provisioned',
      'Standard operator console',
      'Telegram alerts and AI agent',
      'Remote support through the pilot',
    ],
    cta: 'Start with a survey',
    featured: false,
  },
  {
    name: 'Deployment',
    line: 'Full installation, built around you.',
    items: [
      'Everything in Pilot',
      'Custom control software for your site',
      'WhatsApp Business integration',
      'Group routing and escalation',
      'Alarm, access-control or CCTV integration, scoped in survey',
      'On-site drill, training and runbook',
    ],
    cta: 'Book a site survey',
    featured: true,
  },
  {
    name: 'Managed',
    line: 'We keep it sharp.',
    items: [
      'Everything in Deployment',
      'Health monitoring of the system itself',
      'Software updates',
      'Route and threshold tuning as the site changes',
      'Priority support',
    ],
    cta: 'Talk to us',
    featured: false,
  },
];

export function Engagements() {
  return (
    <Section id="engagements">
      <SectionHeader
        index="08"
        label="Engagements"
        title="Start small. Scale to standing patrol."
        lede="Every engagement starts with a site survey. We quote once we've walked the site, so the price reflects your perimeter, not a guess."
      />

      <div className="mt-16 grid grid-cols-1 gap-px border border-border bg-border lg:grid-cols-3">
        {tiers.map((t, i) => (
          <div
            key={t.name}
            className={`relative flex flex-col p-6 sm:p-8 ${t.featured ? 'bg-surface' : 'bg-bg'}`}
            data-reveal
            style={{ ['--reveal-delay' as string]: `${i * 100}ms` }}
          >
            {t.featured ? <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-accent" /> : null}
            <div className="flex items-center justify-between">
              <span className="mono text-[12px] uppercase tracking-[0.1em] text-text">{t.name}</span>
              {t.featured ? <span className="pill pill-open">Recommended</span> : null}
            </div>
            <p className="mt-6 text-2xl font-medium tracking-[-0.02em] text-text">{t.line}</p>
            <p className="mono mt-3 text-[11px] uppercase tracking-[0.08em] text-text-dim">Quoted per site</p>
            <ul className="mt-8 flex-1 border-t border-border">
              {t.items.map((it) => (
                <li key={it} className="flex items-start gap-3 border-b border-border py-3 text-sm text-text">
                  <Check className={`mt-0.5 shrink-0 ${t.featured ? 'text-accent' : 'text-text-muted'}`} />
                  {it}
                </li>
              ))}
            </ul>
            <a href="#contact" className={`btn btn-lg mt-8 w-full ${t.featured ? 'btn-primary' : ''}`}>
              {t.cta} <Arrow />
            </a>
          </div>
        ))}
      </div>
    </Section>
  );
}
