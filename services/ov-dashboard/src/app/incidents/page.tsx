import { Shell } from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { redirect } from 'next/navigation';

interface Incident {
  id: string;
  waypoint_name: string | null;
  classes: string[];
  opened_at: string;
  status: string;
  poster_path: string | null;
}

async function getIncidents(): Promise<Incident[]> {
  try {
    const { incidents } = await apiFetch<{ incidents: Incident[] }>('/api/incidents?limit=200');
    return incidents;
  } catch {
    redirect('/login');
  }
}

export default async function Page() {
  const incidents = await getIncidents();

  const byDay = new Map<string, Incident[]>();
  for (const i of incidents) {
    const day = i.opened_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(i);
  }
  const days = Array.from(byDay.keys()).sort().reverse();

  return (
    <Shell>
      <div className="p-4 max-w-5xl">
        <div className="flex items-baseline gap-4 mb-4">
          <h1 className="mono uppercase text-sm tracking-[0.04em]">INCIDENTS</h1>
          <span className="mono text-xs text-text-dim">{incidents.length} total</span>
        </div>
        {days.length === 0 && (
          <div className="mono text-text-dim text-sm">no incidents</div>
        )}
        {days.map((day) => (
          <section key={day} className="mb-6">
            <h2 className="mono uppercase text-xs text-text-muted tracking-[0.04em] mb-2">
              {day}
            </h2>
            <div className="border-t border-border">
              {byDay.get(day)!.map((i) => (
                <Link key={i.id} href={`/incidents/${i.id}`} className="row no-underline">
                  <span className="mono text-text-dim w-20 shrink-0">
                    {i.opened_at.slice(11, 19)}
                  </span>
                  <span className="mono text-text-muted w-40 shrink-0 truncate">
                    {i.waypoint_name ?? '—'}
                  </span>
                  <span className="text-sm truncate flex-1">{i.classes.join(', ')}</span>
                  <span className={`ml-auto ${pillFor(i.status)}`}>{i.status.toUpperCase()}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}

function pillFor(status: string) {
  switch (status) {
    case 'open':
      return 'pill pill-open';
    case 'acknowledged':
      return 'pill pill-ackd';
    case 'closed':
      return 'pill pill-resolved';
    case 'suppressed':
      return 'pill pill-suppressed';
    default:
      return 'pill pill-muted';
  }
}
