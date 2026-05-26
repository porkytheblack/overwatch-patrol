'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AckButton({ incidentId }: { incidentId: string }) {
  const [busy, setBusy] = useState(false);
  const r = useRouter();
  async function ack() {
    setBusy(true);
    const res = await fetch(`/api/incidents/${incidentId}/acknowledge`, {
      method: 'POST',
      credentials: 'include',
    });
    setBusy(false);
    if (res.ok) r.refresh();
  }
  return (
    <button onClick={ack} disabled={busy} className="btn btn-primary w-full">
      {busy ? '…' : 'ACKNOWLEDGE'}
    </button>
  );
}
