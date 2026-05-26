import { Shell } from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import { redirect } from 'next/navigation';
import { PatrolEditor } from './PatrolEditor';

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
      <div className="p-4 max-w-5xl">
        <h1 className="mono uppercase text-sm tracking-[0.04em] mb-4">PATROL</h1>
        <PatrolEditor initial={waypoints} />
      </div>
    </Shell>
  );
}
