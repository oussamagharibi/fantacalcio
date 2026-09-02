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

-- Storico di carriera da Wikipedia: presenze e gol REALI, non di fantacalcio.
-- Media voto e fantamedia non stanno qui, arrivano dagli Excel in stats.
-- Per i portieri gol e' negativo: sono le reti subite, come le scrive Wikipedia.
CREATE TABLE IF NOT EXISTS carriera (
  player_id INTEGER NOT NULL REFERENCES players(id),
  stagione TEXT NOT NULL,
  squadra TEXT NOT NULL,
  competizione TEXT NOT NULL,
  presenze INTEGER,
  gol INTEGER,
  fonte TEXT,
  PRIMARY KEY (player_id, stagione, squadra, competizione)
);

-- Metadati dell'applicazione, chiave/valore. Serve per cose che non sono
-- configurazione dell'asta: da quale file viene il listone e quando e' stato
-- caricato. Tenerle in config le avrebbe mischiate a budget e squadre.
CREATE TABLE IF NOT EXISTS meta (
  chiave TEXT PRIMARY KEY,
  valore TEXT
);

-- Giocatori marcati come obiettivo dalla pagina Analisi.
CREATE TABLE IF NOT EXISTS targets (
  player_id INTEGER PRIMARY KEY REFERENCES players(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- "Preso da altri": esce dalla ricerca senza prezzo ne' squadra, perche' non
-- li conosciamo. Tabella separata da purchases, che resta la MIA rosa.
CREATE TABLE IF NOT EXISTS usciti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL UNIQUE REFERENCES players(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Segnali estratti dalle pagine-elenco di Fantacalcio.it da parser dedicati.
-- Una fotografia, non uno storico: a ogni giro il tipo viene riscritto.
CREATE TABLE IF NOT EXISTS segnali (
  player_id INTEGER NOT NULL REFERENCES players(id),
  tipo TEXT NOT NULL,
  testo TEXT,
  fonte TEXT,
  data TEXT,
  PRIMARY KEY (player_id, tipo)
);

CREATE TABLE IF NOT EXISTS articles (
  url TEXT PRIMARY KEY,
  titolo TEXT,
  testo TEXT,
  data TEXT,
  fetched_at TEXT,
  -- nome della fonte in fonti.json: serve a citarla dentro la nota
  fonte TEXT
);

-- Expected goals da Understat. Dati REALI di calcio, non di fantacalcio: xG e'
-- la qualita' delle occasioni avute, non un punteggio. Sta separata da stats
-- (Excel di fantacalcio.it) e da carriera (Wikipedia) perche' e' una terza
-- fonte con un suo abbinamento e un suo giro di aggiornamento.
-- scarto_xg (gol - xg) NON si salva: si calcola nelle query, cosi' non puo'
-- restare indietro rispetto alle colonne da cui deriva.
CREATE TABLE IF NOT EXISTS xg (
  player_id INTEGER NOT NULL REFERENCES players(id),
  stagione TEXT NOT NULL,
  squadra TEXT,
  partite INTEGER,
  minuti INTEGER,
  gol INTEGER,
  xg REAL,
  assist INTEGER,
  xa REAL,
  tiri INTEGER,
  passaggi_chiave INTEGER,
  npg INTEGER,
  npxg REAL,
  nome_fonte TEXT,
  aggiornato_il TEXT,
  PRIMARY KEY (player_id, stagione)
);
