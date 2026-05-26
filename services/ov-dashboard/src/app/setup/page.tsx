'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Setup() {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const r = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (p !== confirm) {
      setErr('passwords do not match');
      return;
    }
    if (p.length < 8) {
      setErr('password must be ≥ 8 characters');
      return;
    }
    const res = await fetch('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
      credentials: 'include',
    });
    if (!res.ok) {
      setErr('setup failed');
      return;
    }
    r.replace('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <form onSubmit={submit} className="card w-full max-w-sm">
        <div className="wordmark text-sm mb-6">OVERWATCH PATROL · FIRST BOOT</div>
        <p className="mono text-xs text-text-muted mb-4">create the initial operator account</p>
        <label className="mono uppercase text-[10px] text-text-muted block mb-1 tracking-[0.04em]">
          username
        </label>
        <input className="input w-full mb-3" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        <label className="mono uppercase text-[10px] text-text-muted block mb-1 tracking-[0.04em]">
          password
        </label>
        <input
          type="password"
          className="input w-full mb-3"
          value={p}
          onChange={(e) => setP(e.target.value)}
        />
        <label className="mono uppercase text-[10px] text-text-muted block mb-1 tracking-[0.04em]">
          confirm
        </label>
        <input
          type="password"
          className="input w-full mb-4"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {err && <div className="mono text-xs text-danger mb-3">{err}</div>}
        <button type="submit" className="btn btn-primary w-full">
          CREATE OPERATOR
        </button>
      </form>
    </div>
  );
}
