import { Shell } from '@/components/Shell';

export default function Loading() {
  return (
    <Shell>
      <div className="p-4 max-w-5xl">
        <div className="skeleton mb-4" style={{ height: 12, width: 120 }} />
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="skeleton my-2" style={{ height: 32 }} />
        ))}
      </div>
    </Shell>
  );
}
