-- Preset runs (src/presetRuns.ts): every create of a turning point's own preset what-if, recorded after its response closed. Nothing reads it at run time.
CREATE TABLE preset_runs (
	id TEXT PRIMARY KEY,
	at TEXT NOT NULL,                -- ISO time the create started
	book TEXT NOT NULL,
	divergence_id TEXT NOT NULL,
	status TEXT NOT NULL,            -- ready | error | left (the visitor went away before the end)
	error_code TEXT,
	showcase INTEGER NOT NULL DEFAULT 0,
	attempts INTEGER NOT NULL DEFAULT 0, -- writer attempts (start events)
	calls INTEGER NOT NULL DEFAULT 0,    -- Meta calls (writer and pictures; retries and failed calls included)
	calls_open INTEGER NOT NULL DEFAULT 0, -- calls still running when the run was recorded (their cost is not in cost_usd)
	cost_usd REAL NOT NULL DEFAULT 0,
	first_text_ms INTEGER,           -- create start -> first prose sent
	chapter_ms INTEGER,              -- create start -> validated chapter
	total_ms INTEGER NOT NULL,       -- create start -> end
	words INTEGER,
	writer_model TEXT,
	image_model TEXT,
	title TEXT,
	events TEXT,                     -- JSON array
	chapter TEXT
);
CREATE INDEX preset_runs_point ON preset_runs (book, divergence_id, status);
-- The pictures of the first 2 ready runs of each turning point (bounded: about 1.6 MB a run).
CREATE TABLE preset_pictures (
	run_id TEXT NOT NULL REFERENCES preset_runs (id),
	id TEXT NOT NULL,                -- cover | comic
	mime TEXT NOT NULL,
	width INTEGER,
	height INTEGER,
	bytes BLOB NOT NULL,
	PRIMARY KEY (run_id, id)
);
