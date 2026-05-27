'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Me {
  user: { id: string; username: string; role: string } | null;
}

export function UserMenu() {
  const [me, setMe] = useState<Me['user'] | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Me | null) => {
        if (!cancelled && body?.user) setMe(body.user);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  if (!me) return null;

  return (
    <div className="flex items-center gap-3 ml-auto">
      <Link
        href="/settings/account"
        className="mono text-xs text-text-muted hover:text-text no-underline"
        title="account"
      >
        <span className="uppercase tracking-[0.04em] text-text-dim">user</span>{' '}
        <span className="text-text">{me.username}</span>
      </Link>
      <button
        className="mono uppercase text-[10px] tracking-[0.04em] text-text-dim hover:text-danger"
        onClick={signOut}
        disabled={busy}
        title="sign out"
      >
        {busy ? 'SIGNING OUT…' : 'SIGN OUT'}
      </button>
    </div>
  );
}
