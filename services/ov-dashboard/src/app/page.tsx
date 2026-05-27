import { Shell } from '@/components/Shell';
import { LiveTile } from '@/components/LiveTile';
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

interface SetupCheck {
  needs_setup: boolean;
}

async function getData() {
  try {
    const setup = await apiFetch<SetupCheck>('/api/auth/needs-setup');
    if (setup.needs_setup) return { needsSetup: true } as const;
    const [{ incidents }, sys] = await Promise.all([
      apiFetch<{ incidents: Incident[] }>('/api/incidents?limit=10'),
      apiFetch<{ mjpeg_url: string }>('/api/system/status'),
    ]);
    return { needsSetup: false as const, incidents, mjpeg: sys.mjpeg_url };
  } catch {
    redirect('/login');
  }
}

export default async function Page() {
  const data = await getData();
  if (data.needsSetup) redirect('/setup');
  const { incidents, mjpeg } = data;

  return (
    <Shell>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
        <div className="lg:col-span-2">
          <LiveTile mjpegUrl={mjpeg ?? ''} />
        </div>
        <div className="card">
          <div className="mono uppercase text-xs text-text-muted tracking-[0.04em] mb-2">
            recent incidents
          </div>
          <div className="border-t border-border">
            {incidents.length === 0 && (
              <div className="mono text-sm py-4 space-y-1">
                <div className="text-text-muted">no incidents yet</div>
                <div className="text-text-dim text-xs">
                  add waypoints in{' '}
                  <Link href="/patrol" className="text-accent">
                    /patrol
                  </Link>{' '}
                  and press START PATROL to begin
                </div>
              </div>
            )}
            {incidents.map((i) => (
              <Link
                key={i.id}
                href={`/incidents/${i.id}`}
                className="row text-sm no-underline"
              >
                {i.poster_path ? (
                  <img
                    src={`/api/incidents/${i.id}/poster`}
                    alt=""
                    className="shrink-0 border border-border"
                    style={{ width: 48, height: 27, objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    className="shrink-0 border border-border bg-surface-elev"
                    style={{ width: 48, height: 27 }}
                  />
                )}
                <span className="mono text-text-dim shrink-0">{timeOf(i.opened_at)}</span>
                <span className="mono text-text-muted shrink-0">{i.waypoint_name ?? '—'}</span>
                <span className="text-text truncate">{i.classes.join(', ')}</span>
                <span className={`ml-auto ${incidentPillClass(i.status)}`}>
                  {incidentLabel(i.status)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
