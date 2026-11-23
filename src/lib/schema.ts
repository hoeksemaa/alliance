// The database schema. It is safe to run many times (every statement is "IF NOT EXISTS").
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  username text NOT NULL,
  username_key text NOT NULL UNIQUE,
  pass_hash text NOT NULL,
  role text NOT NULL DEFAULT 'player' CHECK (role IN ('admin', 'player')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  invite_code text NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id serial PRIMARY KEY,
  status text NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'active', 'finished')),
  ap_mode text NOT NULL DEFAULT 'daily' CHECK (ap_mode IN ('daily', 'interval')),
  ap_interval_min int NOT NULL DEFAULT 60 CHECK (ap_interval_min BETWEEN 1 AND 1440),
  anchor_at timestamptz,
  round int NOT NULL DEFAULT 0,
  last_tick_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  winner_tank_id int
);

CREATE TABLE IF NOT EXISTS tanks (
  id serial PRIMARY KEY,
  game_id int NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag text NOT NULL,
  x int,
  y int,
  hearts int NOT NULL DEFAULT 3,
  range int NOT NULL DEFAULT 2,
  ap int NOT NULL DEFAULT 0,
  alive boolean NOT NULL DEFAULT true,
  died_at timestamptz,
  killer_tank_id int,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, flag),
  UNIQUE (game_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS tanks_one_per_square ON tanks (game_id, x, y) WHERE alive AND x IS NOT NULL;

CREATE TABLE IF NOT EXISTS votes (
  game_id int NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round int NOT NULL,
  juror_tank_id int NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
  target_tank_id int NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
  cast_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, round, juror_tank_id)
);

CREATE TABLE IF NOT EXISTS events (
  id serial PRIMARY KEY,
  game_id int NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  round int NOT NULL,
  audience text NOT NULL CHECK (audience IN ('public', 'private')),
  tank_id int REFERENCES tanks(id) ON DELETE CASCADE,
  text text NOT NULL,
  CHECK ((audience = 'public') = (tank_id IS NULL))
);
CREATE INDEX IF NOT EXISTS events_by_game ON events (game_id, id DESC);
CREATE INDEX IF NOT EXISTS events_by_tank ON events (tank_id, id DESC) WHERE tank_id IS NOT NULL;
`;
