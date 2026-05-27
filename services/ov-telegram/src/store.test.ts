import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(join(tmpdir(), 'ov-telegram-store-'));
const dbPath = join(tmp, 'test.db');

process.env.SQLITE_PATH = dbPath;
process.env.DEEP_LINK_SECRET = 'test-deep-link-secret-1234567';
process.env.LOG_LEVEL = 'error';

const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
for (const f of ['0001_init.sql', '0002_claim_codes.sql']) {
  const sql = readFileSync(
    join(__dirname, '..', '..', 'ov-api', 'migrations', f),
    'utf8',
  );
  sqlite.exec(sql);
}
// Seed a legacy {role, content} row so we can verify migration on load.
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
sqlite.close();

const { TelegramStore } = await import('./store.js');

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('TelegramStore', () => {
  it('creates a fresh row on first use', async () => {
    const s = new TelegramStore('fresh-chat');
    expect(await s.getMessages()).toEqual([]);
    expect(await s.getTokenCount()).toBe(0);
  });

  it('round-trips appended messages', async () => {
    const s = new TelegramStore('rt-chat');
    await s.appendMessages([
      { sender: 'user', text: 'what is the robot doing' },
      { sender: 'agent', text: 'PATROLLING' },
    ]);
    const s2 = new TelegramStore('rt-chat');
    const msgs = await s2.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ sender: 'user', text: 'what is the robot doing' });
    expect(msgs[1]).toMatchObject({ sender: 'agent', text: 'PATROLLING' });
  });

  it('caps history at the last 20 turns', async () => {
    const s = new TelegramStore('cap-chat');
    const big: Array<{ sender: 'user' | 'agent'; text: string }> = [];
    for (let i = 0; i < 25; i++) big.push({ sender: 'user', text: `m${i}` });
    await s.appendMessages(big as never);
    const msgs = await s.getMessages();
    expect(msgs).toHaveLength(20);
    expect(msgs[0].text).toBe('m5'); // first 5 dropped
    expect(msgs[19].text).toBe('m24');
  });

  it('migrates legacy {role, content} rows to {sender, text}', async () => {
    const s = new TelegramStore('legacy-chat');
    const msgs = await s.getMessages();
    expect(msgs).toEqual([
      { sender: 'user', text: 'hello' },
      { sender: 'agent', text: 'hi there' },
    ]);
  });

  it('pending-confirmation getter / setter persist', () => {
    const s = new TelegramStore('confirm-chat');
    expect(s.getPendingConfirmation()).toBeNull();
    s.setPendingConfirmation({ tool: 'robot__execute_sport_command', args: { command_name: 'Backflip' } });
    const s2 = new TelegramStore('confirm-chat');
    expect(s2.getPendingConfirmation()).toEqual({
      tool: 'robot__execute_sport_command',
      args: { command_name: 'Backflip' },
    });
    s2.setPendingConfirmation(null);
    expect(new TelegramStore('confirm-chat').getPendingConfirmation()).toBeNull();
  });
});
