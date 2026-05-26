'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const r = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
      credentials: 'include',
    });
    if (!res.ok) {
      setErr('invalid credentials');
      return;
    }
    r.replace('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <form onSubmit={submit} className="card w-full max-w-sm">
        <div className="wordmark text-sm mb-6">OVERWATCH PATROL</div>
        <label className="mono uppercase text-[10px] text-text-muted block mb-1 tracking-[0.04em]">
          username
        </label>
        <input className="input w-full mb-3" autoFocus value={u} onChange={(e) => setU(e.target.value)} />
        <label className="mono uppercase text-[10px] text-text-muted block mb-1 tracking-[0.04em]">
          password
        </label>
        <input
          type="password"
          className="input w-full mb-4"
          value={p}
          onChange={(e) => setP(e.target.value)}
        />
        {err && <div className="mono text-xs text-danger mb-3">{err}</div>}
        <button type="submit" className="btn btn-primary w-full">
          SIGN IN
        </button>
      </form>
    </div>
  );
}
