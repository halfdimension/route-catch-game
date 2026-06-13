CREATE TABLE creature_catalog (
	creature_id VARCHAR(64) PRIMARY KEY,
	creature_name VARCHAR(100) NOT NULL,
	rarity VARCHAR(32) NOT NULL,
	score_value INTEGER NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_sessions (
	session_id UUID PRIMARY KEY,
	status VARCHAR(32) NOT NULL,
	created_at TIMESTAMPTZ NOT NULL,
	started_at TIMESTAMPTZ,
	ended_at TIMESTAMPTZ,
	duration_seconds INTEGER NOT NULL,
	score INTEGER NOT NULL DEFAULT 0,
	caught_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE caught_creatures (
	catch_id UUID PRIMARY KEY,
	session_id UUID NOT NULL REFERENCES game_sessions(session_id),
	creature_id VARCHAR(64) NOT NULL REFERENCES creature_catalog(creature_id),
	creature_name VARCHAR(100) NOT NULL,
	rarity VARCHAR(32) NOT NULL,
	score_value INTEGER NOT NULL,
	caught_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
