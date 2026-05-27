import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(join(tmpdir(), 'ov-telegram-claim-'));
const dbPath = join(tmp, 'test.db');

process.env.SQLITE_PATH = dbPath;
process.env.DEEP_LINK_SECRET = 'test-deep-link-secret-1234567';
process.env.LOG_LEVEL = 'error';

// Apply migrations from ov-api so the shape stays in sync.
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
for (const f of ['0001_init.sql', '0002_claim_codes.sql']) {
  const sql = readFileSync(
    join(__dirname, '..', '..', 'ov-api', 'migrations', f),
    'utf8',
  );
  sqlite.exec(sql);
}
sqlite.close();

const { issueClaimCode, purgeExpiredCodes } = await import('./claim.js');

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('issueClaimCode', () => {
  it('returns a 6-char code from the safe alphabet', () => {
    const c = issueClaimCode('chat-1');
    expect(c.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(c.reused).toBe(false);
    expect(new Date(c.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('reuses an existing unclaimed code for the same chat', () => {
    const a = issueClaimCode('chat-2');
    const b = issueClaimCode('chat-2');
    expect(b.code).toBe(a.code);
    expect(b.reused).toBe(true);
  });

  it('issues distinct codes for different chats', () => {
    const a = issueClaimCode('chat-3a');
    const b = issueClaimCode('chat-3b');
    expect(a.code).not.toBe(b.code);
  });

  it('purgeExpiredCodes is a no-op when nothing is expired', () => {
    issueClaimCode('chat-4');
    const n = purgeExpiredCodes();
    expect(n).toBe(0);
  });
});
