-- Shared remixes (src/shares.ts): the snapshot a visitor shares (a version, its cover and comic), readable by anyone with the link. Written only by
-- POST /api/share from a signed version token and signed pictures, read by GET /api/share/:id.
CREATE TABLE shares (
	id TEXT PRIMARY KEY,
	at TEXT NOT NULL,                -- ISO time first shared
	book TEXT NOT NULL,
	divergence_id TEXT,
	request TEXT NOT NULL,           -- the what-if as shown
	n INTEGER NOT NULL,              -- the version shared
	chapter TEXT NOT NULL,           -- JSON: { title, events, chapter, panels }
	pictures TEXT NOT NULL           -- JSON: { cover?: { mime, hash }, comic?: { ... } } (since 0004)
);
-- Picture bytes per share (replaced by 0004's content-addressed files; kept so the migration history matches existing databases).
CREATE TABLE share_pictures (
	share_id TEXT NOT NULL REFERENCES shares (id),
	id TEXT NOT NULL,                -- cover | comic
	part INTEGER NOT NULL,
	bytes BLOB NOT NULL,
	PRIMARY KEY (share_id, id, part)
);
