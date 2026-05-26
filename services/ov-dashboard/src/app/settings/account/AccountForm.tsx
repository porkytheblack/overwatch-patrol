'use client';
import { useState } from 'react';

/**
 * Password change is intentionally a CLI-only operation in v1 (spec §11
 * line 951: "Password reset via CLI: `pnpm -F @overwatch/api reset-password`").
 * This form surfaces that contract clearly rather than pretending to do
 * the rotation client-side.
 */
export function AccountForm() {
  const [msg] = useState<string | null>(null);
  return (
    <div className="card mono text-xs text-text-dim space-y-2">
      <p>
        Password reset is operator-CLI-only in v1. Run the following on the API host:
      </p>
      <code className="block bg-surface-elev px-2 py-1 text-text">
        pnpm -F @overwatch/api reset-password &lt;username&gt;
      </code>
      {msg && <p className="text-text-muted">{msg}</p>}
    </div>
  );
}
