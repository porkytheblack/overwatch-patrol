'use client';
import { useRef, useState } from 'react';

interface Props {
  busy: boolean;
  onSubmit: (text: string) => void;
}

/**
 * Single-line composer that grows up to ~4 rows.
 *
 * Enter sends, Shift+Enter inserts a newline (the standard chat
 * convention). Trims whitespace before submit so accidental newlines at
 * the end of pasted text don't become empty turns.
 */
export function Composer({ busy, onSubmit }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    setText('');
    // Reset the textarea height in case it grew with multiline content.
    if (ref.current) ref.current.style.height = 'auto';
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    // Autosize: scrollHeight reflects the content height once height is
    // reset to auto. Cap at 4 lines (~96px) so the composer never eats
    // the message list.
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }

  return (
    <div className="flex items-end gap-2 mt-2">
      <textarea
        ref={ref}
        className="input flex-1 resize-none mono text-sm leading-snug py-2"
        style={{ minHeight: '32px' }}
        rows={1}
        placeholder="message the agent…"
        value={text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        disabled={busy}
        aria-label="message the agent"
      />
      <button
        type="button"
        className="btn btn-primary"
        onClick={submit}
        disabled={busy || !text.trim()}
      >
        {busy ? '…' : 'SEND'}
      </button>
    </div>
  );
}
