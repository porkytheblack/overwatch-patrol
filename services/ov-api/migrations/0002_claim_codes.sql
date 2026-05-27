-- Short-lived claim codes that pair a Telegram chat to a dashboard subscriber.
--
-- Flow:
--   1. User sends /start to the bot.
--   2. The bot inserts a 6-char base32 code with a 10-min expiry, keyed to
--      the Telegram chat_id, and replies with the code.
--   3. The operator pastes the code into Settings → Subscribers → Claim,
--      which POSTs /api/subscribers/claim {code}. The API resolves the
--      code to a chat_id, marks the row claimed, and upserts a row in
--      `subscribers` (channel='telegram', handle=<chat_id>, enabled=1).
--
-- A row is consumed once: once `claimed_at` is set, future claims for the
-- same `code` fail. The bot's /start handler returns any unexpired
-- unclaimed row instead of generating a new one, so a user that hits
-- /start twice in 10 minutes gets a stable code.

CREATE TABLE IF NOT EXISTS claim_codes (
  code TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  chat_handle TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_claim_codes_chat_id ON claim_codes (chat_id);
CREATE INDEX IF NOT EXISTS idx_claim_codes_expires_at ON claim_codes (expires_at);
