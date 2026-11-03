import { Section, SectionHeader } from './primitives';

const principles = [
  ['Recordings stay on-site', 'Clips and incident history live on the server at your site. Only alerts and snapshots go out to chat.'],
  ['Signed, expiring links', 'Playback links in alerts are HMAC-signed and expire after 24 hours by default.'],
  ['Confirmation on disruptive commands', 'Stopping surveillance, deleting waypoints or acrobatic moves wait for an explicit yes.'],
  ['Individual operator accounts', 'Console access is per person, with argon2-hashed credentials and server-side sessions.'],
  ['Every acknowledgement attributed', 'Who acknowledged what, from which channel and when is stored against the incident.'],
  ['Your choice of AI model', 'The chat agent’s model provider is configurable, and it answers from your records only.'],
];

function Node({ title, items, accent = false }: { title: string; items: string[]; accent?: boolean }) {
  return (
    <div className={`relative border bg-bg p-4 ${accent ? 'border-accent' : 'border-border-strong'}`}>
      <div className="mono flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-text">
        <span className={`h-1.5 w-1.5 ${accent ? 'bg-accent' : 'bg-text-muted'}`} />
        {title}
      </div>
      <ul className="mt-3 space-y-1">
        {items.map((i) => (
          <li key={i} className="mono text-[10px] uppercase tracking-[0.04em] text-text-dim">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Link({ label, vertical = false }: { label: string; vertical?: boolean }) {
  return vertical ? (
    <div className="flex flex-col items-center py-1" aria-hidden>
      <span className="flow-y h-6" />
      <span className="mono my-1.5 text-[9px] uppercase tracking-[0.1em] text-text-dim">{label}</span>
      <span className="flow-y h-6" />
    </div>
  ) : (
    <div className="flex w-full flex-col items-center gap-2 px-1" aria-hidden>
      <span className="mono whitespace-nowrap text-[9px] uppercase tracking-[0.1em] text-text-dim">{label}</span>
      <span className="flow-x w-full" />
    </div>
  );
}

export function Security() {
  return (
    <Section id="security">
      <SectionHeader
        index="06"
        label="Security by architecture"
        title="Your footage is evidence. It stays with you."
        lede="The whole system runs on your premises. The robot talks to a server on your network, the console runs there, and chat channels only receive what you choose to send them."
      />

      {/* Architecture diagram */}
      <div className="mt-16 border border-border p-4 sm:p-8" data-reveal role="img" aria-label="Architecture: robot and site server on your premises; WhatsApp, Telegram and the model provider reached by outbound TLS">
        <div className="grid grid-cols-1 items-center gap-2 lg:grid-cols-[minmax(0,2fr)_8rem_minmax(0,1fr)] lg:gap-0">
          <div className="relative border border-dashed border-border-strong px-4 pb-5 pt-10 sm:px-6 sm:pb-6">
            <span className="mono absolute left-4 top-3.5 text-[10px] uppercase tracking-[0.1em] text-accent sm:left-6">Your site · on-premises</span>
            <div className="grid grid-cols-1 items-center sm:grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1fr)]">
              <Node title="Patrol robot" items={['Detection', 'Navigation', 'Clip recording', 'Fall recovery']} />
              <div className="hidden sm:block">
                <Link label="Local network" />
              </div>
              <div className="sm:hidden">
                <Link label="Local network" vertical />
              </div>
              <Node title="Site server" items={['Event bridge', 'Storage · clips', 'Operator console', 'Chat agent']} accent />
            </div>
          </div>

          <div className="hidden lg:block">
            <Link label="Outbound · TLS" />
          </div>
          <div className="lg:hidden">
            <Link label="Outbound · TLS" vertical />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <Node title="WhatsApp" items={['Alerts · snapshots', 'Acks · commands']} />
            <Node title="Telegram" items={['Alerts · snapshots', 'Acks · commands']} />
            <Node title="Model provider" items={['Agent reasoning', 'Configurable']} />
          </div>
        </div>
      </div>

      <div className="mt-px grid grid-cols-1 gap-px border border-t-0 border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {principles.map(([t, b], i) => (
          <div key={t} className="bg-bg p-6 sm:p-8" data-reveal style={{ ['--reveal-delay' as string]: `${(i % 3) * 80}ms` }}>
            <div className="mono text-[10px] text-accent">{String(i + 1).padStart(2, '0')}</div>
            <h3 className="mt-4 text-[16px] font-medium text-text">{t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted text-pretty">{b}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
