import { API_BASE } from '@/lib/api';

interface Payload {
  incident: {
    id: string;
    waypoint_name: string | null;
    classes: string[];
    opened_at: string;
    status: string;
  };
  clip_url: string;
  poster_url: string;
}

interface LoadResult {
  ok: true;
  payload: Payload;
}
interface LoadError {
  ok: false;
  kind: 'expired' | 'not_found' | 'error';
}

async function load(id: string, token: string): Promise<LoadResult | LoadError> {
  try {
    const res = await fetch(
      `${API_BASE}/api/incidents/${id}/playback?token=${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'expired' };
    if (res.status === 404) return { ok: false, kind: 'not_found' };
    if (!res.ok) return { ok: false, kind: 'error' };
    return { ok: true, payload: (await res.json()) as Payload };
  } catch {
    return { ok: false, kind: 'error' };
  }
}

export default async function Page({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { token?: string };
}) {
  const token = searchParams.token;
  if (!token) {
    return <ErrorPanel title="LINK EXPIRED" hint="No token supplied." />;
  }
  const r = await load(params.id, token);
  if (!r.ok) {
    if (r.kind === 'expired') {
      return (
        <ErrorPanel title="LINK EXPIRED" hint="Request a fresh deep link from the operator." />
      );
    }
    if (r.kind === 'not_found') {
      return <ErrorPanel title="NOT FOUND" hint="Incident no longer exists." />;
    }
    return <ErrorPanel title="ERROR" hint="Could not load incident." />;
  }
  const { incident, clip_url, poster_url } = r.payload;

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border px-4 py-3">
        <span className="wordmark text-sm">OVERWATCH PATROL · PLAYBACK</span>
      </header>
      <main className="p-4 max-w-5xl mx-auto space-y-3">
        <div className="mono text-xs text-text-muted">
          {incident.waypoint_name} · {incident.classes.join(', ')} · {incident.opened_at}
        </div>
        <video controls className="w-full bg-black" src={clip_url} poster={poster_url} />
      </main>
    </div>
  );
}

function ErrorPanel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="card max-w-sm">
        <div className="wordmark text-sm mb-2">OVERWATCH PATROL</div>
        <div className="mono text-xs text-danger mb-2">{title}</div>
        <div className="mono text-xs text-text-dim">{hint}</div>
      </div>
    </div>
  );
}
