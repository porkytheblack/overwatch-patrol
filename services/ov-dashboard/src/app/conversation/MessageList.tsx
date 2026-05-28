'use client';
import { useEffect, useRef } from 'react';
import type { Message } from '@overwatch/agent';

/**
 * Append-only message log.
 *
 * - User bubbles right-aligned in `surface-elev`.
 * - Agent bubbles left-aligned in `surface`.
 * - Auto-scrolls to the bottom whenever the message count changes, so a
 *   freshly-arrived reply doesn't get lost above the fold.
 *
 * Empty state still renders the scroll container so the layout doesn't
 * jump the first time a message lands.
 */
export function MessageList({ messages }: { messages: Message[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Jump to bottom; smooth scroll would be nice but it stutters when
    // multiple messages arrive in quick succession (e.g. user + agent
    // bubble after a voice turn).
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div
      ref={scrollerRef}
      className="flex-1 min-h-0 overflow-y-auto border border-border bg-surface px-3 py-3 space-y-2"
    >
      {messages.length === 0 ? (
        <div className="mono text-xs text-text-dim">
          no messages yet — ask the agent about waypoints, incidents, or robot
          status, or tell it to drive somewhere.
        </div>
      ) : (
        messages.map((m, i) => (
          <MessageBubble key={m.id ?? `${m.sender}-${i}`} message={m} />
        ))
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.sender === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'max-w-[80%] bg-surface-elev border border-border-strong px-3 py-2 mono text-sm whitespace-pre-wrap break-words'
            : 'max-w-[80%] bg-surface border border-border px-3 py-2 mono text-sm whitespace-pre-wrap break-words text-text'
        }
      >
        {message.text}
      </div>
    </div>
  );
}
