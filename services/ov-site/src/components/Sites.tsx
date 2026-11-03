import { Section, SectionHeader } from './primitives';

const sites = [
  ['Warehouses and logistics yards', 'Docks, container stacks and long fence lines after the last shift leaves.'],
  ['Construction sites', 'Plant, materials and open perimeters that change week to week.'],
  ['Residential estates', 'Gates, common areas and boundary walls, patrolled on a schedule residents can rely on.'],
  ['Campuses and data centres', 'Controlled entrances and service roads between guard rounds.'],
  ['Farms and remote assets', 'Sheds, machinery and fuel stores far from the nearest guard.'],
  ['Retail and car parks after hours', 'Loading bays, service corridors and car parks once the doors close.'],
];

export function Sites() {
  return (
    <Section id="sites">
      <SectionHeader
        index="07"
        label="Where it fits"
        title="Built for sites that can’t be left unwatched."
        lede="Overwatch suits sites with a defined perimeter, quiet hours and a team that needs to know, quickly, when something is wrong."
      />
      <ul className="mt-16 grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {sites.map(([t, b], i) => (
          <li key={t} className="group relative bg-bg p-6 transition-colors hover:bg-surface sm:p-8" data-reveal style={{ ['--reveal-delay' as string]: `${(i % 3) * 80}ms` }}>
            <span aria-hidden className="absolute left-0 top-0 h-full w-px origin-top scale-y-0 bg-accent transition-transform duration-500 group-hover:scale-y-100" />
            <span className="mono text-[10px] text-text-dim">{String(i + 1).padStart(2, '0')}</span>
            <h3 className="mt-6 text-[17px] font-medium tracking-[-0.01em] text-text">{t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{b}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
