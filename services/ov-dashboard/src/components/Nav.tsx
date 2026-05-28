'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'OVERVIEW' },
  { href: '/patrol', label: 'PATROL' },
  { href: '/incidents', label: 'INCIDENTS' },
  // Operator workflow: status → talk to the agent → handle incidents → review.
  // CONVERSATION sits next to INCIDENTS so the natural "see something, ask
  // about it" handoff is a single column hop.
  { href: '/conversation', label: 'CONVERSATION' },
  { href: '/calendar', label: 'CALENDAR' },
  { href: '/settings', label: 'SETTINGS' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex flex-col border-r border-border w-44 bg-bg">
      {items.map((it) => {
        const active = path === it.href || (it.href !== '/' && path.startsWith(it.href));
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`mono uppercase text-xs px-4 py-3 border-b border-border tracking-[0.04em] ${
              active ? 'text-accent' : 'text-text-muted hover:text-text'
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
