import { Shell } from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import { redirect } from 'next/navigation';
import { PatrolEditor } from './PatrolEditor';
import { PatrolControls } from './PatrolControls';
import { ManualDrive } from './ManualDrive';
import { AddWaypoint } from './AddWaypoint';
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

async function getWaypoints(): Promise<Waypoint[]> {
  try {
    const { waypoints } = await apiFetch<{ waypoints: Waypoint[] }>('/api/waypoints');
    return waypoints;
  } catch {
    redirect('/login');
  }
}

export default async function Page() {
  const waypoints = await getWaypoints();
  return (
    <Shell>
      <div className="p-4 max-w-6xl space-y-4">
        <PatrolControls />
      </div>
      <div className="px-4 max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ManualDrive />
        <AddWaypoint />
      </div>
      <div className="p-4 max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h1 className="mono uppercase text-sm tracking-[0.04em] mb-4">PATROL · MAP</h1>
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
          <h1 className="mono uppercase text-sm tracking-[0.04em] mb-4">WAYPOINTS</h1>
          <PatrolEditor initial={waypoints} />
        </div>
      </div>
    </Shell>
  );
}
