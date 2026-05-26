import { Shell } from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import { incidentLabel, incidentPillClass } from '@/lib/labels';
import { notFound } from 'next/navigation';
import { AckButton } from './AckButton';

interface IncidentDetail {
  incident: {
    id: string;
    waypoint_name: string | null;
    classes: string[];
    opened_at: string;
    closed_at: string | null;
    status: string;
    clip_path: string | null;
    poster_path: string | null;
    summary: string | null;
    acknowledged_by_handle: string | null;
    acknowledged_at: string | null;
    deep_link_token: string;
  };
  detections: Array<{
    id: number;
    ts: string;
    class: string;
    confidence: number;
    bbox: { x: number; y: number; w: number; h: number };
    track_id: string | null;
  }>;
}

async function load(id: string): Promise<IncidentDetail> {
  try {
    return await apiFetch<IncidentDetail>(`/api/incidents/${id}`);
  } catch {
    notFound();
  }
}

export default async function Page({ params }: { params: { id: string } }) {
  const { incident, detections } = await load(params.id);
  const tracks = new Map<string, typeof detections>();
  for (const d of detections) {
    const k = d.track_id ?? '∅';
    if (!tracks.has(k)) tracks.set(k, []);
    tracks.get(k)!.push(d);
  }

  return (
    <Shell>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="card p-0 overflow-hidden">
            {incident.clip_path ? (
              <video
                controls
                className="w-full block bg-black"
                src={`/api/incidents/${incident.id}/clip?token=${encodeURIComponent(incident.deep_link_token)}`}
                poster={`/api/incidents/${incident.id}/poster?token=${encodeURIComponent(incident.deep_link_token)}`}
              />
            ) : (
              <div className="bg-black aspect-video flex items-center justify-center mono text-text-dim text-xs">
                CLIP PENDING
              </div>
            )}
          </div>
          <div className="card">
            <div className="mono uppercase text-xs text-text-muted tracking-[0.04em] mb-2">
              detections · {detections.length} samples, {tracks.size} tracks
            </div>
            <div className="space-y-2">
              {Array.from(tracks.entries()).map(([trackId, dets]) => {
                const first = dets[0];
                const last = dets[dets.length - 1];
                const maxConf = Math.max(...dets.map((d) => d.confidence));
                return (
                  <div key={trackId} className="border-t border-border pt-2">
                    <div className="mono text-xs text-text-muted">
                      track {trackId} · {dets.length} samples
                    </div>
                    <div className="mono text-xs text-text-dim">
                      {first.class} · max {(maxConf * 100).toFixed(0)}%
                    </div>
                    <div className="mono text-xs text-text-dim">
                      {first.ts.slice(11, 19)} → {last.ts.slice(11, 19)}
                    </div>
                  </div>
                );
              })}
              {detections.length === 0 && <div className="mono text-text-dim text-xs">none</div>}
            </div>
          </div>
        </div>
        <div className="card space-y-3">
          <div>
            <div className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">incident</div>
            <div className="mono text-xs break-all">{incident.id}</div>
          </div>
          <div>
            <div className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">waypoint</div>
            <div className="mono text-sm">{incident.waypoint_name ?? '—'}</div>
          </div>
          <div>
            <div className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">classes</div>
            <div className="mono text-sm">{incident.classes.join(', ')}</div>
          </div>
          <div>
            <div className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">opened</div>
            <div className="mono text-sm">{incident.opened_at}</div>
          </div>
          {incident.closed_at && (
            <div>
              <div className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">closed</div>
              <div className="mono text-sm">{incident.closed_at}</div>
            </div>
          )}
          <div>
            <div className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">status</div>
            <div className={incidentPillClass(incident.status)}>{incidentLabel(incident.status)}</div>
          </div>
          {incident.summary && (
            <div>
              <div className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">summary</div>
              <div className="text-sm">{incident.summary}</div>
            </div>
          )}
          {incident.acknowledged_by_handle ? (
            <div className="mono text-xs text-success">
              ACK'D by {incident.acknowledged_by_handle} at {incident.acknowledged_at}
            </div>
          ) : (
            <AckButton incidentId={incident.id} />
          )}
        </div>
      </div>
    </Shell>
  );
}
