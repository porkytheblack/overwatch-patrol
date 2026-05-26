import { Shell } from '@/components/Shell';

export default function Loading() {
  return (
    <Shell>
      <div className="p-4 max-w-5xl">
        <div className="skeleton mb-4" style={{ height: 12, width: 200 }} />
        <div className="grid grid-cols-7 gap-0 border-t border-l border-border">
          {Array.from({ length: 42 }).map((_, i) => (
            <div
              key={i}
              className="skeleton border-r border-b border-border"
              style={{ height: 96 }}
            />
          ))}
        </div>
      </div>
    </Shell>
  );
}
