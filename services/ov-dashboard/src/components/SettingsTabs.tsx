'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/settings', label: 'BOT & SYSTEM' },
  { href: '/settings/account', label: 'ACCOUNT' },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-0 border-b border-border mb-4">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`mono uppercase text-xs tracking-[0.04em] px-3 py-2 border-r border-border no-underline ${
              active
                ? 'text-accent border-b-2 border-b-accent -mb-px'
                : 'text-text-muted hover:text-text'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
