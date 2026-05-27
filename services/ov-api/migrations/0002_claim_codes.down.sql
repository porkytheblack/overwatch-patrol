-- Reverse of 0002_claim_codes.sql
DROP INDEX IF EXISTS idx_claim_codes_expires_at;
DROP INDEX IF EXISTS idx_claim_codes_chat_id;
DROP TABLE IF EXISTS claim_codes;
