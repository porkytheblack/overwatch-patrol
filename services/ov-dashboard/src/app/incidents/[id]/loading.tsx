import { Shell } from '@/components/Shell';

export default function Loading() {
  return (
    <Shell>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="card p-0 overflow-hidden">
            <div className="skeleton" style={{ aspectRatio: '16 / 9' }} />
          </div>
          <div className="card">
            <div className="skeleton mb-2" style={{ height: 12, width: '30%' }} />
            <div className="skeleton my-2" style={{ height: 16 }} />
          </div>
        </div>
        <div className="card space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 24 }} />
          ))}
        </div>
      </div>
    </Shell>
  );
}
