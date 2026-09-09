import fs from 'node:fs';
import path from 'node:path';
import { backup, DATA_DIR } from './db.js';
import { caricaRosa } from './lib/rosa.js';

/** Carica la rosa da data/rosa.json.
 *
 *  Serve quando l'asta e' stata fatta altrove: si arriva con venticinque nomi
 *  e un prezzo, non con venticinque id. Sostituisce la rosa esistente, quindi
 *  fa un backup prima, e se anche un solo nome non si risolve non scrive
 *  niente: una rosa a ventiquattro sembra completa e non lo e'. */
const PERCORSO = process.env.ROSA_PATH ?? path.join(DATA_DIR, 'rosa.json');
const log = (m) => console.log(`[rosa] ${m}`);

if (!fs.existsSync(PERCORSO)) {
  log(`file non trovato: ${PERCORSO}`);
  process.exit(1);
}
const voci = JSON.parse(fs.readFileSync(PERCORSO, 'utf8'));
log(`${voci.length} voci da ${PERCORSO}`);
const dichiarata = voci.reduce((s, v) => s + Number(v.prezzo ?? 0), 0);
log(`spesa dichiarata nel file: ${dichiarata}`);

const bak = backup('pre-rosa');
log(`backup db: ${bak}`);

const r = caricaRosa(voci);
if (!r.ok) {
  log(`NON HO SCRITTO NIENTE: ${r.problemi.length} nomi non risolti su ${voci.length}.`);
  for (const p of r.problemi) {
    log(`  "${p.nome}" (${p.prezzo}): ${p.motivo}`);
    for (const c of p.candidati) log(`      candidato: ${c.nome} (${c.squadra}, ${c.ruolo}, id ${c.id})`);
  }
  log('Dimmi tu quale, invece di farmelo indovinare.');
  process.exit(1);
}

for (const a of r.abbinate)
  log(
    `  ${a.nome.padEnd(16)} ${String(a.prezzo).padStart(3)}  ->  ${a.giocatore.nome} (${a.giocatore.squadra}, ${a.giocatore.ruolo})  [${a.via}]`
  );
log(`scritte ${r.scritte} righe, spesa totale ${r.spesa}`);
if (r.spesa !== dichiarata) log(`ATTENZIONE: la spesa scritta (${r.spesa}) non torna con quella del file (${dichiarata}).`);
process.exit(0);
