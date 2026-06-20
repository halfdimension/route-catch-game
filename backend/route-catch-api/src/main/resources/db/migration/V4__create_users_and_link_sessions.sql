CREATE TABLE users (
	user_id UUID PRIMARY KEY,
	username VARCHAR(40) NOT NULL UNIQUE,
	email VARCHAR(320) UNIQUE,
	display_name VARCHAR(80) NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	created_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE game_sessions
ADD COLUMN user_id UUID NULL;

ALTER TABLE game_sessions
ADD CONSTRAINT fk_game_sessions_user_id
FOREIGN KEY (user_id) REFERENCES users(user_id);
