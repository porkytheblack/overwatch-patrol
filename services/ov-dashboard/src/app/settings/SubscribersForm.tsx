'use client';
import { useState } from 'react';

interface Sub {
  id: string;
  channel: string;
  handle: string;
  enabled: boolean;
}

/**
 * Subscribers panel — links Telegram chats to the dashboard.
 *
 * Two flows:
 *  1. RECOMMENDED — paste the 6-char claim code the bot replied to /start with.
 *  2. POWER-USER — paste the raw chat_id you somehow know.
 *
 * When `subs.length === 0` we surface the claim-code instructions inline so
 * a first-boot operator can complete setup without leaving the page. The
 * bot's @username (when known) is interpolated into the instructions.
 */
export function SubscribersForm({
  initial,
  botUsername,
}: {
  initial: Sub[];
  botUsername: string | null;
}) {
  const [subs, setSubs] = useState(initial);
  const [code, setCode] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [handle, setHandle] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  const botRef = botUsername ? `@${botUsername}` : 'your Overwatch bot';
  const emptyState = subs.length === 0;

  async function claim() {
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return;
    setClaimBusy(true);
    setClaimErr(null);
    try {
      const res = await fetch('/api/subscribers/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: cleaned }),
      });
      if (!res.ok) {
        let msg = 'claim failed';
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error === 'invalid_code') msg = 'invalid code — check the 6 chars';
          else if (j.error === 'expired') msg = 'code expired — send /start to the bot again';
          else if (j.error === 'already_claimed') msg = 'code already used';
          else if (j.error) msg = `claim failed · ${j.error}`;
        } catch {
          /* ignore parse errors */
        }
        setClaimErr(msg);
        return;
      }
      const created = (await res.json()) as Sub & { claimed: boolean };
      setSubs((s) => {
        // Re-claiming an existing chat just re-enables → replace in place.
        const exists = s.find((r) => r.id === created.id);
        if (exists) {
          return s.map((r) => (r.id === created.id ? { ...r, enabled: created.enabled } : r));
        }
        return [...s, created];
      });
      setCode('');
    } finally {
      setClaimBusy(false);
    }
  }

  async function addManual() {
    if (!handle.trim()) return;
    setManualBusy(true);
    try {
      const res = await fetch('/api/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel: 'telegram', handle: handle.trim(), enabled: true }),
      });
      if (res.ok) {
        const { id } = (await res.json()) as { id: string };
        setSubs((s) => {
          const existing = s.find((r) => r.id === id);
          if (existing) return s;
          return [...s, { id, channel: 'telegram', handle: handle.trim(), enabled: true }];
        });
        setHandle('');
      }
    } finally {
      setManualBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/subscribers/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) setSubs((s) => s.filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-3">
      {emptyState && (
        <div className="card space-y-2">
          <div className="mono uppercase text-[10px] tracking-[0.04em] text-text-dim">
            FIRST-RUN SETUP
          </div>
          <ol className="text-xs text-text-muted space-y-1 list-decimal list-inside">
            <li>
              Open Telegram, search <span className="mono text-text">{botRef}</span>.
            </li>
            <li>
              Send <span className="mono text-text">/start</span> to the bot.
            </li>
            <li>Paste the 6-character code it replies with into the field below.</li>
          </ol>
          <div className="mono text-[10px] text-text-dim">
            Codes expire after 10 minutes. Each subscriber links one Telegram chat.
          </div>
        </div>
      )}

      <div className="card space-y-2">
        <div className="mono uppercase text-[10px] tracking-[0.04em] text-text-dim flex items-center gap-2">
          CLAIM CODE
          <span className="pill pill-open">RECOMMENDED</span>
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1 uppercase tracking-[0.1em]"
            placeholder="A B C 1 2 3"
            value={code}
            maxLength={12}
            onChange={(e) => {
              setCode(e.target.value);
              setClaimErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !claimBusy) claim();
            }}
          />
          <button
            className="btn btn-primary"
            onClick={claim}
            disabled={claimBusy || !code.trim()}
          >
            {claimBusy ? 'LINKING…' : 'LINK'}
          </button>
        </div>
        {claimErr && <div className="mono text-xs text-danger">{claimErr}</div>}
      </div>

      <details
        className="card"
        open={showManual}
        onToggle={(e) => setShowManual((e.target as HTMLDetailsElement).open)}
      >
        <summary className="mono uppercase text-[10px] tracking-[0.04em] text-text-dim cursor-pointer">
          ADVANCED · ADD BY CHAT_ID
        </summary>
        <div className="pt-3 space-y-2">
          <div className="mono text-[10px] text-text-dim">
            Skip the claim flow when you already know the chat_id (e.g. from a
            previous setup or another bot). The chat_id is a number Telegram assigns
            to each chat.
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="telegram chat id (e.g. 12345678)"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <button
              className="btn"
              onClick={addManual}
              disabled={manualBusy || !handle.trim()}
            >
              ADD
            </button>
          </div>
        </div>
      </details>

      <div className="card">
        <div className="mono uppercase text-[10px] tracking-[0.04em] text-text-dim mb-2">
          LINKED CHATS
        </div>
        {subs.length === 0 ? (
          <div className="mono text-text-dim text-xs py-2">no subscribers yet</div>
        ) : (
          subs.map((s) => (
            <div key={s.id} className="row">
              <span className="mono text-xs text-text-muted w-20">{s.channel}</span>
              <span className="mono text-sm flex-1">{s.handle}</span>
              <button className="btn btn-danger" onClick={() => remove(s.id)}>
                REMOVE
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
