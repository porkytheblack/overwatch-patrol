import { Shell } from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { redirect } from 'next/navigation';

interface Incident {
  id: string;
  opened_at: string;
  status: string;
}

async function getIncidents(from: string, to: string): Promise<Incident[]> {
  try {
    const { incidents } = await apiFetch<{ incidents: Incident[] }>(
      `/api/incidents?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2000`,
    );
    return incidents;
  } catch {
    redirect('/login');
  }
}

export default async function Page() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const incidents = await getIncidents(
    new Date(Date.UTC(first.getFullYear(), first.getMonth(), 1)).toISOString(),
    new Date(
      Date.UTC(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999),
    ).toISOString(),
  );

  const counts = new Map<string, number>();
  const hourly = new Map<string, number[]>();
  for (const i of incidents) {
    const day = i.opened_at.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
    if (!hourly.has(day)) hourly.set(day, new Array(24).fill(0));
    const h = parseInt(i.opened_at.slice(11, 13), 10);
    hourly.get(day)![h]++;
  }

  const days: Date[] = [];
  for (let d = new Date(first); d.getMonth() === today.getMonth(); d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  const leading = first.getDay();

  return (
    <Shell>
      <div className="p-4 max-w-5xl">
        <h1 className="mono uppercase text-sm tracking-[0.04em] mb-4">
          CALENDAR · {today.toLocaleString('en-US', { month: 'long' }).toUpperCase()}{' '}
          {today.getFullYear()}
        </h1>
        <div className="grid grid-cols-7 gap-0 border-t border-l border-border">
          {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d) => (
            <div
              key={d}
              className="mono uppercase text-[10px] text-text-dim tracking-[0.04em] px-2 py-2 border-r border-b border-border"
            >
              {d}
            </div>
          ))}
          {Array.from({ length: leading }).map((_, i) => (
            <div key={`pad-${i}`} className="border-r border-b border-border h-24 bg-bg" />
          ))}
          {days.map((d) => {
            const key = d.toISOString().slice(0, 10);
            const c = counts.get(key) ?? 0;
            const bars = hourly.get(key) ?? new Array(24).fill(0);
            const max = Math.max(1, ...bars);
            return (
              <Link
                key={key}
                href={`/incidents?from=${key}T00:00:00.000Z&to=${key}T23:59:59.999Z`}
                className="border-r border-b border-border h-24 px-2 py-1 hover:bg-surface-elev no-underline block"
              >
                <div className="flex items-baseline gap-2">
                  <span className="mono text-text-dim text-xs">{d.getDate()}</span>
                  {c > 0 && <span className="mono text-accent text-xs">{c}</span>}
                </div>
                {c > 0 && (
                  <div className="flex items-end gap-[1px] h-10 mt-1">
                    {bars.map((v, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-accent"
                        style={{ height: `${(v / max) * 100}%`, opacity: v > 0 ? 0.7 : 0.1 }}
                      />
                    ))}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
