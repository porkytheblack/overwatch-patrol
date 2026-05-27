'use client';
import { useLiveStatus } from '@/components/LiveStatus';
import { UserMenu } from '@/components/UserMenu';

export function Wordmark() {
  const { online } = useLiveStatus();
  return (
    <div className="flex items-center gap-3 py-3 px-4 border-b border-border">
      <span className="wordmark text-sm">OVERWATCH PATROL</span>
      <span
        className={`pulse-dot ${online ? '' : 'dot-offline'}`}
        aria-label={online ? 'online' : 'offline'}
        title={online ? 'lcm flowing from robot' : 'robot offline'}
      />
      <UserMenu />
    </div>
  );
}
