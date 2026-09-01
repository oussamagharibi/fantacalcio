CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  squadra TEXT NOT NULL,
  ruolo TEXT NOT NULL CHECK(ruolo IN ('P','D','C','A')),
  quotazione INTEGER NOT NULL,
  fvm INTEGER,
  rapporto_fvm REAL,
  fascia INTEGER,
  note TEXT,
  note_generated_at TEXT,
  -- In fondo di proposito: ALTER TABLE ADD COLUMN accoda sempre, e cosi' un db
  -- creato da zero ha le stesse colonne nello stesso ordine di uno migrato.
  quotazione_iniziale INTEGER,
  -- NULL = in listino. Altrimenti ISO timestamp del primo import che non lo
  -- ha piu' trovato nel file. Non si cancella la riga: potrebbe essere gia'
  -- stata acquistata, e purchases la referenzia.
  assente_dal TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  prezzo INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config (
  chiave TEXT PRIMARY KEY,
  valore TEXT
);

-- Statistiche storiche, una riga per giocatore per stagione. Solo dati grezzi
-- come li pubblica Fantacalcio.it: nessun indice o punteggio calcolato qui.
CREATE TABLE IF NOT EXISTS stats (
  player_id INTEGER NOT NULL REFERENCES players(id),
  stagione TEXT NOT NULL,
  pv INTEGER,
  mv REAL,
  fm REAL,
  gol INTEGER,
  gs INTEGER,
  rig_segnati INTEGER,
  rig_tirati INTEGER,
  rig_parati INTEGER,
  assist INTEGER,
  amm INTEGER,
  esp INTEGER,
  PRIMARY KEY (player_id, stagione)
);

CREATE TABLE IF NOT EXISTS articles (
  url TEXT PRIMARY KEY,
  titolo TEXT,
  testo TEXT,
  data TEXT,
  fetched_at TEXT
);
