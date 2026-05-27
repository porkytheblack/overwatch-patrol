import { Shell } from '@/components/Shell';
import { LiveTile } from '@/components/LiveTile';
import { apiFetch } from '@/lib/api';
import { redirect } from 'next/navigation';
import { PatrolEditor } from './PatrolEditor';
import { PatrolControls } from './PatrolControls';
import { ManualDrive } from './ManualDrive';
import { AddWaypoint } from './AddWaypoint';
import { SportPanel } from './SportPanel';
import { HowItWorks } from './HowItWorks';
import { WaypointMap } from '@/components/WaypointMap';

interface Waypoint {
  id: string;
  name: string;
  pose_x: number;
  pose_y: number;
  pose_yaw: number;
  scene_description: string;
  targets: string[];
  linger_threshold_seconds: number;
  inspection_dwell_seconds: number;
  min_standoff_m: number;
  order_index: number;
  enabled: boolean;
}

interface SystemStatus {
  mjpeg_url: string;
}

async function loadPatrol(): Promise<{ waypoints: Waypoint[]; mjpegUrl: string }> {
  try {
    const [{ waypoints }, sys] = await Promise.all([
      apiFetch<{ waypoints: Waypoint[] }>('/api/waypoints'),
      apiFetch<SystemStatus>('/api/system/status'),
    ]);
    return { waypoints, mjpegUrl: sys.mjpeg_url };
  } catch {
    redirect('/login');
  }
}

export default async function Page() {
  const { waypoints, mjpegUrl } = await loadPatrol();
  const hasWaypoints = waypoints.length > 0;

  return (
    <Shell>
      <div className="p-4 max-w-6xl space-y-4">
        <HowItWorks waypointCount={waypoints.length} />

        <PatrolControls />

        {/* The camera-while-driving block.
            On wide screens: camera left (2/3), drive + add-waypoint right (1/3).
            The user can SEE what they're doing the whole time. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-2">
            <h2 className="mono uppercase text-xs text-text-muted tracking-[0.04em]">
              LIVE · what the robot sees
            </h2>
            <LiveTile mjpegUrl={mjpegUrl} />
          </div>
          <div className="space-y-4">
            <ManualDrive />
            <SportPanel />
            <AddWaypoint />
          </div>
        </div>

        {/* Map + list — only meaningful once waypoints exist, so we
            hide it behind a clear empty state when there are none. */}
        {hasWaypoints ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
            <div>
              <h2 className="mono uppercase text-xs text-text-muted tracking-[0.04em] mb-2">
                MAP · top-down view
              </h2>
              <WaypointMap
                waypoints={waypoints.map((w) => ({
                  id: w.id,
                  name: w.name,
                  pose_x: w.pose_x,
                  pose_y: w.pose_y,
                  order_index: w.order_index,
                }))}
              />
            </div>
            <div>
              <h2 className="mono uppercase text-xs text-text-muted tracking-[0.04em] mb-2">
                WAYPOINTS · {waypoints.length}
              </h2>
              <PatrolEditor initial={waypoints} />
            </div>
          </div>
        ) : (
          <div className="card mono text-xs text-text-dim text-center py-6">
            map + waypoint list will appear here after you add your first waypoint
          </div>
        )}
      </div>
    </Shell>
  );
}
