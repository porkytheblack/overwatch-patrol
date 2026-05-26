import { Shell } from '@/components/Shell';

export default function Loading() {
  return (
    <Shell>
      <div className="p-4 max-w-3xl space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <section key={i}>
            <div className="skeleton mb-3" style={{ height: 12, width: 120 }} />
            <div className="skeleton" style={{ height: 96 }} />
          </section>
        ))}
      </div>
    </Shell>
  );
}
