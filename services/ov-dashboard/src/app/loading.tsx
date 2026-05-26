import { Shell } from '@/components/Shell';

export default function Loading() {
  return (
    <Shell>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
        <div className="lg:col-span-2">
          <div className="card p-0 overflow-hidden">
            <div className="skeleton" style={{ aspectRatio: '16 / 9' }} />
          </div>
        </div>
        <div className="card">
          <div className="skeleton mb-2" style={{ height: 12, width: '40%' }} />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton my-2" style={{ height: 16 }} />
          ))}
        </div>
      </div>
    </Shell>
  );
}
