import { apiFetch } from '@/lib/api';
import { notFound } from 'next/navigation';

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

async function load(id: string, token: string): Promise<Payload> {
  try {
    return await apiFetch<Payload>(`/api/incidents/${id}/playback?token=${encodeURIComponent(token)}`);
  } catch {
    notFound();
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
  if (!token) notFound();
  const { incident, clip_url, poster_url } = await load(params.id, token);

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
