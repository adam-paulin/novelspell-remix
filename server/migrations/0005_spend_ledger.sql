-- The spend ledger per provider (src/spendCap.ts): one row per model API (meta, baseten, ...), each with its own cap var. Replaces
-- 0001's one-row `spend` table; the Meta total carries over. A provider's row is created by its first reservation.
CREATE TABLE spend_ledger (provider TEXT PRIMARY KEY, usd REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0);
INSERT INTO spend_ledger (provider, usd, calls) SELECT 'meta', usd, calls FROM spend WHERE id = 1;
DROP TABLE spend;
