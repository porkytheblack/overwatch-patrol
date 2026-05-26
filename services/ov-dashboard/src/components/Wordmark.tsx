'use client';
import { useLiveStatus } from '@/components/LiveStatus';

export function Wordmark() {
  const { online } = useLiveStatus();
  return (
    <div className="flex items-center gap-3 py-3 px-4 border-b border-border">
      <span className="wordmark text-sm">OVERWATCH PATROL</span>
      <span className={`pulse-dot ${online ? '' : 'dot-offline'}`} aria-label={online ? 'online' : 'offline'} />
    </div>
  );
}
