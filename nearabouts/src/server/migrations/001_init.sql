-- Nearabouts initial schema (SQLite)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  pass_hash TEXT,
  is_guest INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  banned_until INTEGER,
  ban_reason TEXT,
  avatar TEXT NOT NULL DEFAULT '{}',
  bio TEXT NOT NULL DEFAULT '',
  xp INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE friendships (
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requester_id, addressee_id)
);
CREATE INDEX friendships_addressee ON friendships(addressee_id);

CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

-- Every playable location. status: verified (imagery confirmed by provider), demo (illustrative
-- procedural scene, never presented as real imagery), dead (imagery no longer available).
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  pano_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  heading REAL NOT NULL DEFAULT 0,
  country TEXT,
  subdivision TEXT,
  difficulty INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','demo','dead')),
  source TEXT NOT NULL DEFAULT 'sampled',
  attribution TEXT NOT NULL DEFAULT '{}',
  meta TEXT NOT NULL DEFAULT '{}',
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, pano_id)
);
CREATE INDEX locations_country ON locations(provider, status, country);
CREATE INDEX locations_latlng ON locations(provider, status, lat, lng);

CREATE TABLE maps (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,           -- world | continent | country | city | landmark | community
  kind TEXT NOT NULL,               -- region | explicit
  region TEXT NOT NULL DEFAULT '{}',-- JSON: {countries?:[], states?:[], circle?:{lat,lng,radiusKm}, bbox?:[]}
  scale_km REAL NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
  builtin INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  plays INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX maps_category ON maps(category);

CREATE TABLE map_locations (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  heading REAL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (map_id, location_id)
);

CREATE TABLE map_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, map_id)
);

-- Solo-style games (classic, quick, daily, streaks, explorer, challenge)
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  map_id TEXT,
  rules TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished','abandoned')),
  total_score INTEGER NOT NULL DEFAULT 0,
  round_count INTEGER NOT NULL,     -- 0 = open-ended (streaks)
  current_round INTEGER NOT NULL DEFAULT 0,
  daily_date TEXT,
  challenge_code TEXT,
  country_code TEXT,
  scale_km REAL NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX games_user ON games(user_id, created_at);
CREATE INDEX games_daily ON games(daily_date, status);
CREATE INDEX games_challenge ON games(challenge_code);
CREATE INDEX games_mode ON games(mode, status);
CREATE UNIQUE INDEX games_daily_once ON games(user_id, daily_date) WHERE daily_date IS NOT NULL;

CREATE TABLE game_rounds (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  heading REAL,                     -- starting direction override (map editor)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','done')),
  started_at INTEGER,
  deadline_at INTEGER,
  guess_lat REAL,
  guess_lng REAL,
  guessed_at INTEGER,
  distance_km REAL,
  score INTEGER,
  guess_region TEXT,
  correct INTEGER,
  PRIMARY KEY (game_id, idx)
);

CREATE TABLE daily_challenges (
  date TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  location_ids TEXT NOT NULL,
  rules TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE challenges (
  code TEXT PRIMARY KEY,
  creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  map_id TEXT NOT NULL,
  rules TEXT NOT NULL,
  location_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,              -- finished | abandoned
  room_code TEXT,
  config TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE match_players (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team INTEGER,
  placement INTEGER,
  outcome TEXT,                      -- win | loss | draw
  total_score INTEGER NOT NULL DEFAULT 0,
  forfeited INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX match_players_user ON match_players(user_id);

CREATE TABLE match_rounds (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  location_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY (match_id, idx)
);

CREATE TABLE explorer_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  medal TEXT NOT NULL DEFAULT 'none',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, country_code)
);

CREATE TABLE achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Daily counters used to cap paid imagery-provider calls.
CREATE TABLE api_usage (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
