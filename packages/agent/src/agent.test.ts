/**
 * ConversationStore tests.
 *
 * Mirrors the original `services/ov-telegram/src/store.test.ts` patterns
 * but exercises the channel-agnostic constructor. Asserts that two
 * conversations on the same db with different channels live in distinct
 * rows, and that the static `loadHistory` helper returns empty for a
 * non-existent (channel, handle).
 *
 * No LLM call — only the SQLite persistence surface.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { schema } from '@overwatch/shared-ts';
import { ConversationStore } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'ov-agent-store-'));
const dbPath = join(tmp, 'test.db');

// Apply the same migrations the API uses so the schema matches prod.
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
const migrationsDir = join(__dirname, '..', '..', '..', 'services', 'ov-api', 'migrations');
for (const f of ['0001_init.sql', '0002_claim_codes.sql']) {
  const ddl = readFileSync(join(migrationsDir, f), 'utf8');
  sqlite.exec(ddl);
}
const db = drizzle(sqlite, { schema });

afterAll(() => {
  sqlite.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('ConversationStore', () => {
  it('creates a fresh row on first use', async () => {
    const s = new ConversationStore(db, 'telegram', 'fresh-chat');
    expect(await s.getMessages()).toEqual([]);
    expect(await s.getTokenCount()).toBe(0);
    expect(s.identifier).toBe('telegram-fresh-chat');
  });

  it('round-trips appended messages', async () => {
    const s = new ConversationStore(db, 'telegram', 'rt-chat');
    await s.appendMessages([
      { sender: 'user', text: 'what is the robot doing' },
      { sender: 'agent', text: 'PATROLLING' },
    ]);
    const s2 = new ConversationStore(db, 'telegram', 'rt-chat');
    const msgs = await s2.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ sender: 'user', text: 'what is the robot doing' });
    expect(msgs[1]).toMatchObject({ sender: 'agent', text: 'PATROLLING' });
  });

  it('caps history at the last 20 turns', async () => {
    const s = new ConversationStore(db, 'telegram', 'cap-chat');
    const big: Array<{ sender: 'user' | 'agent'; text: string }> = [];
    for (let i = 0; i < 25; i++) big.push({ sender: 'user', text: `m${i}` });
    await s.appendMessages(big);
    const msgs = await s.getMessages();
    expect(msgs).toHaveLength(20);
    expect(msgs[0].text).toBe('m5'); // first 5 dropped
    expect(msgs[19].text).toBe('m24');
  });

  it('pending-confirmation getter / setter persist', () => {
    const s = new ConversationStore(db, 'telegram', 'confirm-chat');
    expect(s.getPendingConfirmation()).toBeNull();
    s.setPendingConfirmation({
      tool: 'robot__execute_sport_command',
      args: { command_name: 'Backflip' },
    });
    const s2 = new ConversationStore(db, 'telegram', 'confirm-chat');
    expect(s2.getPendingConfirmation()).toEqual({
      tool: 'robot__execute_sport_command',
      args: { command_name: 'Backflip' },
    });
    s2.setPendingConfirmation(null);
    expect(
      new ConversationStore(db, 'telegram', 'confirm-chat').getPendingConfirmation(),
    ).toBeNull();
  });

  it('isolates conversations by channel for the same handle', async () => {
    const tg = new ConversationStore(db, 'telegram', 'shared-handle');
    const dash = new ConversationStore(db, 'dashboard', 'shared-handle');
    await tg.appendMessages([{ sender: 'user', text: 'tg side' }]);
    await dash.appendMessages([{ sender: 'user', text: 'dashboard side' }]);

    expect(await tg.getMessages()).toEqual([{ sender: 'user', text: 'tg side' }]);
    expect(await dash.getMessages()).toEqual([
      { sender: 'user', text: 'dashboard side' },
    ]);

    // Verify two physical rows exist for this handle.
    const rows = sqlite
      .prepare(`SELECT channel FROM agent_conversations WHERE handle = ?`)
      .all('shared-handle') as Array<{ channel: string }>;
    expect(rows).toHaveLength(2);
    const channels = rows.map((r) => r.channel).sort();
    expect(channels).toEqual(['dashboard', 'telegram']);

    // Sanity: COUNT(*) on the table for this handle — must be exactly 2
    // (one per channel; the shared-handle pair did not collapse into one row).
    const totalForHandle = sqlite
      .prepare(`SELECT COUNT(*) as c FROM agent_conversations WHERE handle = ?`)
      .get('shared-handle') as { c: number };
    expect(totalForHandle.c).toBe(2);
  });

  it('loadHistory returns empty for a non-existent (channel, handle)', () => {
    const result = ConversationStore.loadHistory(db, 'dashboard', 'nobody-home');
    expect(result.messages).toEqual([]);
    expect(result.pending_confirmation).toBeNull();
  });

  it('loadHistory reads an existing conversation without inserting', async () => {
    const s = new ConversationStore(db, 'dashboard', 'load-test');
    await s.appendMessages([
      { sender: 'user', text: 'hi' },
      { sender: 'agent', text: 'hello' },
    ]);
    s.setPendingConfirmation({
      tool: 'robot__stop_surveillance',
      args: {},
    });
    const loaded = ConversationStore.loadHistory(db, 'dashboard', 'load-test');
    expect(loaded.messages).toEqual([
      { sender: 'user', text: 'hi' },
      { sender: 'agent', text: 'hello' },
    ]);
    expect(loaded.pending_confirmation).toEqual({
      tool: 'robot__stop_surveillance',
      args: {},
    });
  });

  it('migrates legacy {role, content} rows to {sender, text}', () => {
    // Insert a legacy row directly via the sqlite driver.
    sqlite
      .prepare(
        `INSERT INTO agent_conversations (id, channel, handle, messages, pending_confirmation, last_active)
         VALUES (?, 'telegram', 'legacy-chat', ?, ?, ?)`,
      )
      .run(
        'legacy-row-id',
        JSON.stringify([
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi there' },
        ]),
        null,
        new Date().toISOString(),
      );
    const s = new ConversationStore(db, 'telegram', 'legacy-chat');
    return s.getMessages().then((msgs) => {
      expect(msgs).toEqual([
        { sender: 'user', text: 'hello' },
        { sender: 'agent', text: 'hi there' },
      ]);
    });
  });
});
