import { Shell } from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import { incidentLabel, incidentPillClass, timeOf } from '@/lib/labels';
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

const STATUSES = ['all', 'open', 'acknowledged', 'closed', 'suppressed'] as const;
type StatusFilter = (typeof STATUSES)[number];

interface SearchParams {
  status?: string;
  from?: string;
  to?: string;
}

async function getIncidents(params: URLSearchParams): Promise<Incident[]> {
  try {
    const { incidents } = await apiFetch<{ incidents: Incident[] }>(
      `/api/incidents?${params.toString()}`,
    );
    return incidents;
  } catch {
    redirect('/login');
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const status: StatusFilter = (STATUSES as readonly string[]).includes(
    searchParams.status ?? '',
  )
    ? (searchParams.status as StatusFilter)
    : 'all';

  const params = new URLSearchParams({ limit: '200', status });
  if (searchParams.from) params.set('from', searchParams.from);
  if (searchParams.to) params.set('to', searchParams.to);
  const incidents = await getIncidents(params);

  const byDay = new Map<string, Incident[]>();
  for (const i of incidents) {
    const day = i.opened_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(i);
  }
  const days = Array.from(byDay.keys()).sort().reverse();
  const scope = describeScope(searchParams);

  return (
    <Shell>
      <div className="p-4 max-w-5xl">
        <div className="flex items-baseline gap-4 mb-4">
          <h1 className="mono uppercase text-sm tracking-[0.04em]">INCIDENTS</h1>
          <span className="mono text-xs text-text-dim">
            {incidents.length} {scope}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {STATUSES.map((s) => {
            const active = s === status;
            // Preserve from/to when switching status
            const q = new URLSearchParams();
            if (s !== 'all') q.set('status', s);
            if (searchParams.from) q.set('from', searchParams.from);
            if (searchParams.to) q.set('to', searchParams.to);
            const href = q.toString() ? `/incidents?${q}` : '/incidents';
            return (
              <Link
                key={s}
                href={href}
                className={`pill no-underline ${
                  active ? 'pill-open' : 'pill-muted hover:text-text'
                }`}
              >
                {s.toUpperCase()}
              </Link>
            );
          })}
          {(searchParams.from || searchParams.to) && (
            <Link
              href={status === 'all' ? '/incidents' : `/incidents?status=${status}`}
              className="pill pill-muted no-underline hover:text-text"
              title="clear date range"
            >
              CLEAR DATES
            </Link>
          )}
        </div>
        {days.length === 0 && (
          <div className="card mono text-sm text-text-muted">
            <div className="text-text mb-1">no incidents {scope}</div>
            <div className="text-text-dim text-xs">
              incidents are recorded when a configured target lingers in a waypoint zone past
              the linger threshold. start patrol from{' '}
              <Link href="/patrol" className="text-accent">
                /patrol
              </Link>{' '}
              and configure targets per-waypoint to begin.
            </div>
          </div>
        )}
        {days.map((day) => (
          <section key={day} className="mb-6">
            <h2 className="mono uppercase text-xs text-text-muted tracking-[0.04em] mb-2">
              {day}
            </h2>
            <div className="border-t border-border">
              {byDay.get(day)!.map((i) => (
                <Link key={i.id} href={`/incidents/${i.id}`} className="row no-underline">
                  {i.poster_path ? (
                    <img
                      src={`/api/incidents/${i.id}/poster`}
                      alt=""
                      className="shrink-0 border border-border"
                      style={{ width: 56, height: 32, objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      className="shrink-0 border border-border bg-surface-elev"
                      style={{ width: 56, height: 32 }}
                    />
                  )}
                  <span className="mono text-text-dim w-20 shrink-0">{timeOf(i.opened_at)}</span>
                  <span className="mono text-text-muted w-40 shrink-0 truncate">
                    {i.waypoint_name ?? '—'}
                  </span>
                  <span className="text-sm truncate flex-1">{i.classes.join(', ')}</span>
                  <span className={`ml-auto ${incidentPillClass(i.status)}`}>
                    {incidentLabel(i.status)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}

function describeScope(p: SearchParams): string {
  const parts: string[] = [];
  if (p.status && p.status !== 'all') parts.push(p.status);
  if (p.from && p.to) parts.push(`${p.from.slice(0, 10)} → ${p.to.slice(0, 10)}`);
  else if (p.from) parts.push(`since ${p.from.slice(0, 10)}`);
  else if (p.to) parts.push(`through ${p.to.slice(0, 10)}`);
  return parts.length ? parts.join(' · ') : 'total';
}
