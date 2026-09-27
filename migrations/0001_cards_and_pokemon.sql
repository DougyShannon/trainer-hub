-- Reference data: card sets, cards and Pokémon species.
-- Filled by scripts/load-seed.mjs from files built by scripts/build-seed.mjs.

CREATE TABLE sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  series TEXT NOT NULL,
  printed_total INTEGER,
  total INTEGER,
  release_date TEXT NOT NULL,        -- YYYY-MM-DD
  ptcgo_code TEXT,
  symbol_url TEXT,
  logo_url TEXT,
  legal_standard INTEGER NOT NULL DEFAULT 0,
  legal_expanded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,               -- e.g. sv1-1
  set_id TEXT NOT NULL REFERENCES sets(id),
  number TEXT NOT NULL,
  number_sort INTEGER NOT NULL,      -- numeric part of number, for ordering
  name TEXT NOT NULL,
  supertype TEXT NOT NULL,           -- Pokémon, Trainer, Energy
  subtypes TEXT NOT NULL DEFAULT '[]',
  hp INTEGER,
  types TEXT NOT NULL DEFAULT '[]',
  evolves_from TEXT,
  rarity TEXT,
  artist TEXT,
  regulation_mark TEXT,
  legal_standard INTEGER NOT NULL DEFAULT 0,
  legal_expanded INTEGER NOT NULL DEFAULT 0,
  image_small TEXT,
  image_large TEXT,
  search_text TEXT NOT NULL,         -- lowercased name + attack/ability/rule text
  details TEXT NOT NULL DEFAULT '{}' -- attacks, abilities, weaknesses, rules, etc. as JSON
);

CREATE INDEX cards_name ON cards(name);
CREATE INDEX cards_set ON cards(set_id, number_sort);
CREATE INDEX cards_supertype ON cards(supertype);

-- Which Pokédex numbers a card depicts (a card can show more than one).
CREATE TABLE card_pokemon (
  card_id TEXT NOT NULL REFERENCES cards(id),
  dex INTEGER NOT NULL,
  PRIMARY KEY (card_id, dex)
);
CREATE INDEX card_pokemon_dex ON card_pokemon(dex);

CREATE TABLE pokemon (
  id INTEGER PRIMARY KEY,            -- National Pokédex number
  slug TEXT NOT NULL UNIQUE,         -- e.g. mr-mime
  name TEXT NOT NULL,
  genus TEXT,                        -- e.g. Seed Pokémon
  generation INTEGER NOT NULL,
  types TEXT NOT NULL,               -- JSON array, slot order
  height INTEGER,                    -- decimetres
  weight INTEGER,                    -- hectograms
  stats TEXT NOT NULL,               -- JSON {hp, attack, defense, spAttack, spDefense, speed}
  abilities TEXT NOT NULL,           -- JSON [{name, hidden, effect}]
  flavor_text TEXT,
  evolution_chain_id INTEGER,
  evolves_from INTEGER,
  is_legendary INTEGER NOT NULL DEFAULT 0,
  is_mythical INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX pokemon_chain ON pokemon(evolution_chain_id);
