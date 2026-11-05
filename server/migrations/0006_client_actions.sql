-- Model actions per client per UTC day (src/clientLimits.ts, ACTION_DAILY_LIMIT). `client` is a salted hash of the IP address, never
-- the address itself. One small row per client and day.
CREATE TABLE client_actions (day TEXT NOT NULL, client TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, client));
