'use client';
import type { ReactNode } from 'react';
import { LiveStatusProvider } from './LiveStatus';
import { Nav } from './Nav';
import { Wordmark } from './Wordmark';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <LiveStatusProvider>
      <div className="min-h-screen flex flex-col bg-bg">
        <Wordmark />
        <div className="flex flex-1 min-h-0">
          <Nav />
          <main className="flex-1 min-w-0 overflow-auto">{children}</main>
        </div>
      </div>
    </LiveStatusProvider>
  );
}
