import { Contact } from '@/components/Contact';
import { ControlSoftware } from '@/components/ControlSoftware';
import { Deliver } from '@/components/Deliver';
import { Deployment } from '@/components/Deployment';
import { Engagements } from '@/components/Engagements';
import { Faq } from '@/components/Faq';
import { Footer } from '@/components/Footer';
import { Hero, Stats, Ticker } from '@/components/Hero';
import { Monitoring } from '@/components/Monitoring';
import { Nav } from '@/components/Nav';
import { Section, SectionHeader } from '@/components/primitives';
import { RevealObserver } from '@/components/Reveal';
import { Security } from '@/components/Security';
import { Showcase } from '@/components/Showcase';
import { Sites } from '@/components/Sites';

export default function Page() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-site border-x border-border">
        <Hero />
        <Stats />
        <Ticker />
        <Deliver />
        <Section id="in-action">
          <SectionHeader
            index="02"
            label="In action"
            title="Watch an incident play out in chat."
            lede="An alert lands with a snapshot. Someone acknowledges it, asks what else happened, and sends the robot to the gate, all in plain language. On the right is what the robot and the agent are doing at each moment."
          />
          <Showcase />
        </Section>
        <ControlSoftware />
        <Monitoring />
        <Deployment />
        <Security />
        <Sites />
        <Engagements />
        <Faq />
        <Contact />
        <Footer />
      </main>
      <RevealObserver />
    </>
  );
}
