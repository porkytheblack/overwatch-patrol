import { Shell } from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import { redirect } from 'next/navigation';
import { AccountForm } from './AccountForm';

interface Me {
  user: { id: string; username: string; role: string };
}

async function getMe(): Promise<Me> {
  try {
    return await apiFetch<Me>('/api/auth/me');
  } catch {
    redirect('/login');
  }
}

export default async function Page() {
  const { user } = await getMe();
  return (
    <Shell>
      <div className="p-4 max-w-2xl space-y-6">
        <h1 className="mono uppercase text-sm tracking-[0.04em]">ACCOUNT</h1>
        <div className="card space-y-2 mono text-sm">
          <Row label="username" value={user.username} />
          <Row label="role" value={user.role} />
          <Row label="user id" value={user.id} mono />
        </div>
        <section>
          <h2 className="mono uppercase text-xs text-text-muted tracking-[0.04em] mb-2">
            change password
          </h2>
          <AccountForm />
        </section>
        <section>
          <h2 className="mono uppercase text-xs text-text-muted tracking-[0.04em] mb-2">
            sign out
          </h2>
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="btn btn-danger">
              SIGN OUT
            </button>
          </form>
        </section>
      </div>
    </Shell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1">
      <span className="uppercase text-[10px] text-text-dim tracking-[0.04em]">{label}</span>
      <span className={mono ? 'mono text-xs break-all' : ''}>{value}</span>
    </div>
  );
}
