import { Plus, Section } from './primitives';

const faqs = [
  {
    q: 'What robot do you deploy?',
    a: 'Current deployments use the Unitree Go2 quadruped, running our patrol, detection and recording software on the dimos robotics stack. Legs handle kerbs, gravel and ramps that stop wheeled platforms.',
  },
  {
    q: 'Do we need internet on site?',
    a: 'Patrol, detection, recording and the console all run on your network. Chat alerts and the AI agent need an outbound connection. If it drops, the robot keeps patrolling and recording, and the console keeps working.',
  },
  {
    q: 'WhatsApp or Telegram, which should we choose?',
    a: 'Whichever your team already lives in, or both. WhatsApp suits teams and groups that already coordinate there. Telegram gives the richest bot experience with inline buttons and the full conversational agent. We set up routing so each alert goes to the right people on either.',
  },
  {
    q: 'Is it safe to control the robot from chat?',
    a: 'Routine commands such as moving to a waypoint run immediately. Disruptive ones, like stopping surveillance or deleting a waypoint, wait for an explicit confirmation before anything happens. Every acknowledgement is recorded with who sent it and from which channel.',
  },
  {
    q: 'Where are recordings stored?',
    a: 'On a server at your site. Alerts carry a snapshot and a signed playback link that expires, by default after 24 hours. Full clips never leave your hardware unless you export them.',
  },
  {
    q: 'Can it work with our existing CCTV or alarm system?',
    a: 'Usually, yes. Integrations with alarm panels, access control and existing camera systems are part of the custom control software and are scoped during the site survey.',
  },
  {
    q: 'What happens if the robot falls or goes offline?',
    a: 'The robot detects falls and recovers itself where it can. If it drops off the network, the console shows it as offline immediately rather than going quiet, so a silent screen never means all clear.',
  },
  {
    q: 'How long does an installation take?',
    a: 'It depends on the size of the site and the integrations you need. We give you a timeline with the quote after the survey.',
  },
];

export function Faq() {
  return (
    <Section id="faq">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="lg:col-span-4" data-reveal>
          <p className="eyebrow mb-6">
            <span className="text-accent">09</span>
            <span className="h-px w-6 bg-border-strong" />
            Questions
          </p>
          <h2 className="h-section text-balance">Asked before every survey.</h2>
        </div>
        <div className="border-t border-border lg:col-span-8">
          {faqs.map((f) => (
            <details key={f.q} className="group border-b border-border">
              <summary className="flex cursor-pointer items-center justify-between gap-6 py-6 text-left text-[17px] font-medium tracking-[-0.01em] text-text transition-colors hover:text-accent-strong">
                {f.q}
                <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-border-strong text-text-muted transition-transform duration-300 group-open:rotate-45 group-open:border-accent group-open:text-accent">
                  <Plus />
                </span>
              </summary>
              <p className="max-w-[62ch] pb-7 pr-12 text-[15px] leading-relaxed text-text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
