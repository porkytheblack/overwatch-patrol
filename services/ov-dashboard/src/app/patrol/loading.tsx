import { Shell } from '@/components/Shell';

export default function Loading() {
  return (
    <Shell>
      <div className="p-4 max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="skeleton mb-4" style={{ height: 12, width: 120 }} />
          <div className="card p-0 overflow-hidden">
            <div className="skeleton" style={{ aspectRatio: '1' }} />
          </div>
        </div>
        <div>
          <div className="skeleton mb-4" style={{ height: 12, width: 120 }} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton my-2" style={{ height: 40 }} />
          ))}
        </div>
      </div>
    </Shell>
  );
}
