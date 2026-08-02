CREATE TABLE game_rounds (
	game_round_id UUID PRIMARY KEY,
	round_instance_id UUID NOT NULL,
	room_code VARCHAR(16) NOT NULL,
	round_generation BIGINT NOT NULL,
	status VARCHAR(32) NOT NULL,
	end_reason VARCHAR(32) NOT NULL,
	started_at TIMESTAMPTZ NOT NULL,
	ended_at TIMESTAMPTZ NOT NULL,
	duration_seconds INTEGER NOT NULL,
	participant_count INTEGER NOT NULL,
	created_at TIMESTAMPTZ NOT NULL,
	CONSTRAINT uk_game_rounds_round_instance_id
		UNIQUE (round_instance_id),
	CONSTRAINT ck_game_rounds_room_code_not_blank
		CHECK (TRIM(room_code) <> ''),
	CONSTRAINT ck_game_rounds_duration_positive
		CHECK (duration_seconds > 0),
	CONSTRAINT ck_game_rounds_participant_count_non_negative
		CHECK (participant_count >= 0)
);

CREATE INDEX idx_game_rounds_ended_at
	ON game_rounds (ended_at DESC, round_instance_id DESC);

CREATE INDEX idx_game_rounds_room_code_ended_at
	ON game_rounds (room_code, ended_at DESC, round_instance_id DESC);

CREATE TABLE game_round_players (
	game_round_player_id UUID PRIMARY KEY,
	game_round_id UUID NOT NULL,
	user_id UUID NOT NULL,
	leaderboard_position INTEGER NOT NULL,
	display_name VARCHAR(80) NOT NULL,
	final_score INTEGER NOT NULL,
	final_rank INTEGER NOT NULL,
	caught_total INTEGER NOT NULL,
	common_catches INTEGER NOT NULL,
	rare_catches INTEGER NOT NULL,
	legendary_catches INTEGER NOT NULL,
	joined_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL,
	CONSTRAINT fk_game_round_players_game_round_id
		FOREIGN KEY (game_round_id)
		REFERENCES game_rounds(game_round_id)
		ON DELETE CASCADE,
	CONSTRAINT fk_game_round_players_user_id
		FOREIGN KEY (user_id)
		REFERENCES users(user_id),
	CONSTRAINT uk_game_round_players_round_user
		UNIQUE (game_round_id, user_id),
	CONSTRAINT uk_game_round_players_round_position
		UNIQUE (game_round_id, leaderboard_position),
	CONSTRAINT ck_game_round_players_position_positive
		CHECK (leaderboard_position > 0),
	CONSTRAINT ck_game_round_players_display_name_not_blank
		CHECK (TRIM(display_name) <> ''),
	CONSTRAINT ck_game_round_players_score_non_negative
		CHECK (final_score >= 0),
	CONSTRAINT ck_game_round_players_rank_positive
		CHECK (final_rank > 0),
	CONSTRAINT ck_game_round_players_caught_non_negative
		CHECK (
			caught_total >= 0
			AND common_catches >= 0
			AND rare_catches >= 0
			AND legendary_catches >= 0
		),
	CONSTRAINT ck_game_round_players_catch_totals_match
		CHECK (
			caught_total = common_catches + rare_catches + legendary_catches
		)
);

CREATE INDEX idx_game_round_players_user_round
	ON game_round_players (user_id, game_round_id);

CREATE TABLE game_round_player_catches (
	game_round_player_catch_id UUID PRIMARY KEY,
	game_round_player_id UUID NOT NULL,
	creature_instance_id UUID NOT NULL,
	creature_id VARCHAR(64) NOT NULL,
	creature_name VARCHAR(100) NOT NULL,
	rarity VARCHAR(32) NOT NULL,
	score_awarded INTEGER NOT NULL,
	caught_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL,
	CONSTRAINT fk_game_round_player_catches_player_id
		FOREIGN KEY (game_round_player_id)
		REFERENCES game_round_players(game_round_player_id)
		ON DELETE CASCADE,
	CONSTRAINT uk_game_round_player_catches_player_instance
		UNIQUE (game_round_player_id, creature_instance_id),
	CONSTRAINT ck_game_round_player_catches_creature_id_not_blank
		CHECK (TRIM(creature_id) <> ''),
	CONSTRAINT ck_game_round_player_catches_creature_name_not_blank
		CHECK (TRIM(creature_name) <> ''),
	CONSTRAINT ck_game_round_player_catches_rarity_not_blank
		CHECK (TRIM(rarity) <> ''),
	CONSTRAINT ck_game_round_player_catches_score_non_negative
		CHECK (score_awarded >= 0)
);

CREATE INDEX idx_game_round_player_catches_player_caught_at
	ON game_round_player_catches (
		game_round_player_id,
		caught_at,
		creature_instance_id
	);
