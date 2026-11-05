-- The spend ledger (src/spendCap.ts): one row holding the running total of Meta spend in USD and the number of calls reserved.
CREATE TABLE spend (id INTEGER PRIMARY KEY CHECK (id = 1), usd REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0);
INSERT INTO spend (id, usd, calls) VALUES (1, 0, 0);
