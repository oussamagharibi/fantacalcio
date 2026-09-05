import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** Su Railway il filesystem del container e' effimero: senza un volume montato
 *  il db e il listone spariscono a ogni redeploy. Railway espone il mount point
 *  in RAILWAY_VOLUME_MOUNT_PATH (tipicamente /data): se c'e', i dati vanno li'.
 *  In locale, o su Railway senza volume, si ricade su ./data come sempre. */
export const DATA_DIR = process.env.DATA_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? path.join(ROOT, 'data');
export const SU_VOLUME = DATA_DIR !== path.join(ROOT, 'data');
export const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'asta.db');
const SCHEMA_PATH = path.join(import.meta.dirname, 'schema.sql');

let db = null;

/** Colonne aggiunte dopo che lo schema iniziale era gia' in circolazione.
 *  schema.sql da solo non basta: CREATE TABLE IF NOT EXISTS non tocca le tabelle
 *  gia' create, quindi un db esistente non vedrebbe mai la colonna nuova.
 *  Ogni voce deve restare sicura da rieseguire all'infinito. */
const COLONNE_AGGIUNTE = [
  { tabella: 'players', colonna: 'quotazione_iniziale', definizione: 'INTEGER' },
  { tabella: 'players', colonna: 'assente_dal', definizione: 'TEXT' },
  { tabella: 'articles', colonna: 'fonte', definizione: 'TEXT' },
];

/** La chiave di segnali e' passata da (player_id, tipo) a (player_id, tipo,
 *  fonte): in SQLite una chiave primaria non si cambia con ALTER, la tabella
 *  va ricostruita. Si riconosce dalla vecchia forma guardando quante colonne
 *  compongono la chiave.
 *  Le righe esistenti si portano dietro cosi' come sono, con la fonte a stringa
 *  vuota dove mancava: NULL in una chiave primaria SQLite lo accetta, e due
 *  NULL non si considerano uguali, quindi la riscrittura smetterebbe di essere
 *  idempotente. */
function migraSegnali(d) {
  const colonne = d.prepare('PRAGMA table_info(segnali)').all();
  if (!colonne.length) return false;
  const chiave = colonne.filter((c) => c.pk > 0).map((c) => c.name);
  if (chiave.includes('fonte')) return false;
  backup('pre-migrazione-segnali');
  d.exec(`
    CREATE TABLE segnali_nuova (
      player_id INTEGER NOT NULL REFERENCES players(id),
      tipo TEXT NOT NULL,
      testo TEXT,
      fonte TEXT NOT NULL DEFAULT '',
      data TEXT,
      PRIMARY KEY (player_id, tipo, fonte)
    );
    INSERT INTO segnali_nuova (player_id, tipo, testo, fonte, data)
      SELECT player_id, tipo, testo, coalesce(fonte, ''), data FROM segnali;
    DROP TABLE segnali;
    ALTER TABLE segnali_nuova RENAME TO segnali;
  `);
  console.log('[db] segnali: chiave estesa a (player_id, tipo, fonte)');
  return true;
}

/** Applica gli ALTER mancanti. Non fallisce se la colonna c'e' gia': la
 *  presenza si controlla prima, invece di intercettare l'errore di SQLite. */
function migra(d) {
  const applicate = [];
  for (const { tabella, colonna, definizione } of COLONNE_AGGIUNTE) {
    const presenti = d.prepare(`PRAGMA table_info(${tabella})`).all();
    if (!presenti.length || presenti.some((c) => c.name === colonna)) continue;
    if (!applicate.length) backup('pre-migrazione'); // solo se c'e' davvero da migrare
    d.exec(`ALTER TABLE ${tabella} ADD COLUMN ${colonna} ${definizione}`);
    applicate.push(`${tabella}.${colonna}`);
  }
  if (migraSegnali(d)) applicate.push('segnali.chiave');
  if (applicate.length) console.log(`[db] migrazioni applicate: ${applicate.join(', ')}`);
  return applicate;
}

/** Apre il db (creandolo se assente), applica lo schema e le migrazioni. Idempotente. */
export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const nuovo = !fs.existsSync(DB_PATH);
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  migra(db);
  console.log(`[db] ${nuovo ? 'creato' : 'aperto'} ${DB_PATH}`);
  return db;
}

/** Path da mostrare in log e risposte: relativo se sta dentro al progetto,
 *  assoluto altrimenti. Con un volume montato (DATA_DIR = /data, progetto in
 *  /app) il relativo sarebbe un "../data/..." illeggibile. */
export const perLog = (p) => {
  const rel = path.relative(ROOT, p);
  return rel.startsWith('..') ? p : rel;
};

/** Snapshot del file db prima di ogni scrittura. Ritorna il path, o null se il db non esiste. */
export function backup(tag) {
  if (!fs.existsSync(DB_PATH)) return null;
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `asta-${stamp}-${tag}.db`);
  fs.copyFileSync(DB_PATH, dest);
  return perLog(dest);
}

/** node:sqlite non ha .transaction(): questo e' l'equivalente minimo. */
export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}
