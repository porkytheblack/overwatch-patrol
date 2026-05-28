'use client';
/**
 * Client root for /conversation.
 *
 * Holds the full chat state, talks to `agentClient` for round-trips,
 * and hands the voice panel a pair of callbacks that drop bubbles into
 * the same `messages` array so chat history and voice loop stay in
 * lockstep.
 *
 * Voice mounting is gated on `NEXT_PUBLIC_VOICE_ENABLED === '1'`. The
 * env var is read at *build time* (NEXT_PUBLIC_ prefix), so flipping it
 * requires rebuilding/restarting the dashboard. Spec calls this out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage, confirm as confirmAction, reset as resetAgent } from './agentClient';
import type { AgentApiError } from './agentClient';
import type { Message, PendingConfirmation } from '@overwatch/agent';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { ConfirmationBanner } from './ConfirmationBanner';
import { VoicePanel } from './VoicePanel';

interface Initial {
  messages: Message[];
  pending_confirmation: PendingConfirmation | null;
}

const VOICE_ENABLED = process.env.NEXT_PUBLIC_VOICE_ENABLED === '1';

export function ConversationPanel({ initial }: { initial: Initial }) {
  const [messages, setMessages] = useState<Message[]>(initial.messages);
  const [pending, setPending] = useState<PendingConfirmation | null>(
    initial.pending_confirmation,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Show a transient error toast — cleared after 5s. */
  const flashError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    errorTimeoutRef.current = setTimeout(() => {
      setError(null);
      errorTimeoutRef.current = null;
    }, 5000);
  }, []);

  useEffect(
    () => () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    },
    [],
  );

  const appendMessage = useCallback((m: Message) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  /**
   * Send a typed message to the agent.
   *
   * Slash hook: `/reset` mirrors Telegram and clears the in-process
   * cache + local UI state without burning an LLM turn. Anything else
   * goes through `/api/agent/message`.
   *
   * On 503 `agent_offline` and 500 `agent_error`, we keep the user
   * bubble visible (so they can re-read what they tried to send) and
   * surface the failure as a toast.
   */
  const handleSend = useCallback(
    async (text: string) => {
      if (busy) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (trimmed === '/reset') {
        await handleReset();
        return;
      }
      // Optimistic user bubble — keeps the UI responsive while the
      // round-trip burns.
      appendMessage({ sender: 'user', text: trimmed });
      setBusy(true);
      try {
        const reply = await sendMessage(trimmed);
        appendMessage({ sender: 'agent', text: reply.text });
        setPending(reply.meta?.pending_confirmation ?? null);
      } catch (e) {
        const apiErr = e as AgentApiError;
        const status = typeof apiErr.status === 'number' ? apiErr.status : 0;
        const detail =
          status === 503
            ? 'agent offline · no provider configured on ov-api'
            : status === 500
              ? `agent error · ${apiErr.message}`
              : `send failed · ${apiErr.message}`;
        flashError(detail);
      } finally {
        setBusy(false);
      }
    },
    // handleReset is declared below — eslint exhaustive-deps would
    // complain, but its identity is stable (also useCallback) so we
    // disable the rule for this one block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, appendMessage, flashError],
  );

  /**
   * Resolve a pending confirmation. On success, append a system-style
   * agent bubble with the outcome message. On 404, the pending was
   * stale — clear it silently.
   */
  const handleConfirm = useCallback(
    async (answer: 'y' | 'n') => {
      if (!pending || busy) return;
      setBusy(true);
      try {
        const reply = await confirmAction(answer);
        setPending(null);
        appendMessage({ sender: 'agent', text: reply.message });
      } catch (e) {
        const apiErr = e as AgentApiError;
        if (apiErr.status === 404) {
          // Race: pending was cleared by something else (e.g. another
          // tab, a reset). Drop it locally and move on.
          setPending(null);
        } else {
          flashError(`confirm failed · ${apiErr.message}`);
        }
      } finally {
        setBusy(false);
      }
    },
    [pending, busy, appendMessage, flashError],
  );

  /** `/reset` hook + reset button — both clear server cache and local UI. */
  const handleReset = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await resetAgent();
      setMessages([]);
      setPending(null);
    } catch (e) {
      flashError(`reset failed · ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, flashError]);

  /**
   * Voice callback: voice panel owns its own /api/agent/message
   * round-trip (see VoicePanel for why). Here we just drop the user
   * bubble into the chat log so the operator can see what was heard.
   */
  const handleVoiceTranscript = useCallback(
    (text: string) => {
      appendMessage({ sender: 'user', text });
    },
    [appendMessage],
  );

  /**
   * Voice callback: agent reply landed via voice path. Drop the agent
   * bubble so it shows up alongside the text-mode bubbles. Voice path
   * also reads pending_confirmation indirectly — when a confirmation-
   * required tool is trapped mid-turn, the agent's reply will say so
   * and the next /history pull will surface the pending row. For v1 we
   * don't refresh pending automatically; operator can press CONFIRM
   * via the banner after typing or hitting the page again.
   */
  const handleVoiceAgentReply = useCallback(
    (text: string) => {
      appendMessage({ sender: 'agent', text });
    },
    [appendMessage],
  );

  const handleVoiceError = useCallback(
    (err: Error) => {
      flashError(`voice · ${err.message}`);
    },
    [flashError],
  );

  return (
    <div className="p-4 max-w-5xl flex flex-col h-full min-h-0">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-4">
          <h1 className="mono uppercase text-sm tracking-[0.04em]">
            CONVERSATION
          </h1>
          <span className="mono text-xs text-text-dim">
            {messages.length} {messages.length === 1 ? 'message' : 'messages'}
          </span>
        </div>
        <button
          type="button"
          className="btn"
          onClick={handleReset}
          disabled={busy || messages.length === 0}
          title="clear conversation cache and history view"
        >
          RESET
        </button>
      </div>

      <MessageList messages={messages} />

      {pending && (
        <ConfirmationBanner
          pending={pending}
          busy={busy}
          onConfirm={handleConfirm}
        />
      )}

      {error && (
        <div className="card my-2 border-danger mono text-xs text-danger">
          {error}
        </div>
      )}

      <Composer busy={busy} onSubmit={handleSend} />

      {VOICE_ENABLED && (
        <VoicePanel
          onTranscript={handleVoiceTranscript}
          onAgentReply={handleVoiceAgentReply}
          onError={handleVoiceError}
        />
      )}
    </div>
  );
}
