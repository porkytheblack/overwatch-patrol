/**
 * Claim-code generation for the /start linking flow.
 *
 * Flow (spec §11 extension):
 *   1. User opens Telegram, sends /start to the bot.
 *   2. We insert a 6-char code keyed to their chat_id with a 10-min expiry.
 *      Idempotent: if a fresh unclaimed code already exists for the chat,
 *      we return it instead of generating a new one.
 *   3. The user pastes the code into Dashboard → Settings → Subscribers,
 *      which POSTs to /api/subscribers/claim. The API marks the code
 *      consumed and upserts a `subscribers` row.
 *
 * The character set deliberately drops easy-confusable glyphs (I/O/0/1)
 * so the user can read the code off their phone without squinting.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, nowIso } from '@overwatch/shared-ts';
import { db } from './db.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no I/O/0/1
const CODE_LENGTH = 6;
const TTL_MINUTES = 10;
/** Max attempts when the generated code happens to collide. 32^6 ≈ 1B codes
 *  with a 10-min window — collisions are vanishingly unlikely, but the loop
 *  guards against a degenerate RNG. */
const MAX_GEN_ATTEMPTS = 8;

export interface IssuedClaim {
  code: string;
  expires_at: string;
  ttl_minutes: number;
  reused: boolean;
}

function generateCode(): string {
  // crypto.getRandomValues is sufficient; we don't need cryptographic
  // unpredictability — just no birthday surprises over the 10-min window.
  const buf = new Uint8Array(CODE_LENGTH);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Issue (or re-surface) a claim code for the given Telegram chat.
 *
 * If the chat already has an unclaimed, unexpired code, that code is
 * returned with `reused: true`. Otherwise a fresh row is inserted.
 *
 * @param chat_id    Telegram chat_id (as string — Telegram chat ids are
 *                   64-bit ints that don't round-trip through JS numbers).
 * @param chat_handle Optional @username for diagnostics.
 */
export function issueClaimCode(chat_id: string, chat_handle?: string | null): IssuedClaim {
  // 1. Reuse any unclaimed, unexpired code for this chat.
  const now = nowIso();
  const existing = db
    .select()
    .from(schema.claimCodes)
    .where(
      and(
        eq(schema.claimCodes.chat_id, chat_id),
        isNull(schema.claimCodes.claimed_at),
        sql`${schema.claimCodes.expires_at} > ${now}`,
      ),
    )
    .get();
  if (existing) {
    return {
      code: existing.code,
      expires_at: existing.expires_at,
      ttl_minutes: TTL_MINUTES,
      reused: true,
    };
  }

  // 2. Generate + insert. Retry on PK collision (vanishingly rare).
  for (let attempt = 0; attempt < MAX_GEN_ATTEMPTS; attempt++) {
    const code = generateCode();
    const expires_at = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();
    try {
      db.insert(schema.claimCodes)
        .values({
          code,
          chat_id,
          chat_handle: chat_handle ?? null,
          created_at: now,
          expires_at,
          claimed_at: null,
        })
        .run();
      return { code, expires_at, ttl_minutes: TTL_MINUTES, reused: false };
    } catch (e) {
      // PK collision → retry. Any other error → bubble up.
      if (!(e instanceof Error) || !/UNIQUE constraint/.test(e.message)) {
        throw e;
      }
    }
  }
  throw new Error('claim_code_generation_exhausted');
}

/** Opportunistic cleanup so the table stays bounded; cheap, single-statement. */
export function purgeExpiredCodes(): number {
  const r = db
    .delete(schema.claimCodes)
    .where(
      and(isNull(schema.claimCodes.claimed_at), sql`${schema.claimCodes.expires_at} < ${nowIso()}`),
    )
    .run();
  return r.changes ?? 0;
}
