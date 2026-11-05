-- One link per version, with its pictures attached as they land; picture bytes are stored once by content hash (a picture in several
-- shares is one file), so storage grows only with pictures the service actually drew. shares.pictures is { cover?: { mime, hash }, comic?: { ... } }.
DROP TABLE share_pictures;
CREATE TABLE share_files (
	hash TEXT PRIMARY KEY,           -- SHA-256 hex of the bytes
	mime TEXT NOT NULL,
	size INTEGER NOT NULL,
	parts INTEGER NOT NULL,
	at TEXT NOT NULL
);
-- The bytes in parts under D1's 2 MB value limit.
CREATE TABLE share_blobs (
	hash TEXT NOT NULL REFERENCES share_files (hash),
	part INTEGER NOT NULL,
	bytes BLOB NOT NULL,
	PRIMARY KEY (hash, part)
);
