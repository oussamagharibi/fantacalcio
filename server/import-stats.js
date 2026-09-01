import { getDb } from './db.js';
import { importaStats } from './lib/stats.js';

/** CLI: npm run import-stats. Importa tutte le stagioni da DATA_DIR.
 *  Non tocca la rete: i file si scaricano a mano da Fantacalcio.it. */
const { backupDb, esiti } = importaStats();
console.log(`[stats] backup db : ${backupDb}`);

let problemi = 0;
for (const e of esiti) {
  if (e.mancante) {
    console.warn(`[stats] ${e.stagione}: file non trovato -> ${e.file}`);
    problemi++;
    continue;
  }
  if (e.errore) {
    console.error(`[stats] ${e.stagione}: ERRORE ${e.errore}`);
    if (e.righeGrezze) e.righeGrezze.forEach((r, i) => console.error(`  riga ${i + 1}: ${JSON.stringify(r)}`));
    problemi++;
    continue;
  }
  console.log(
    `[stats] ${e.stagione}: foglio "${e.foglio}" (intestazione riga ${e.rigaHeader}) | righe lette: ${e.righeLette} | ` +
      `inserite: ${e.inserite} | aggiornate: ${e.aggiornate} | scartate: ${e.senzaGiocatore.length + e.scartateRiga.length}`
  );
  for (const s of e.scartateRiga) console.warn(`[stats]   riga ${s.riga} scartata: ${s.motivo}`);
  if (e.senzaGiocatore.length) {
    console.warn(`[stats]   ${e.senzaGiocatore.length} senza corrispondenza nel listone (fuori dalla Serie A):`);
    for (const s of e.senzaGiocatore) console.warn(`[stats]     id ${s.player_id}  ${s.nome}`);
  }
  console.log(`[stats]   in db per ${e.stagione}: ${e.inDb} righe`);
}

const d = getDb();
const copertura = d
  .prepare(
    `SELECT
       (SELECT count(*) FROM players WHERE assente_dal IS NULL) AS inListino,
       (SELECT count(*) FROM stats) AS righeStats,
       (SELECT count(DISTINCT player_id) FROM stats) AS giocatoriConStats`
  )
  .get();
console.log(`[stats] totale: ${copertura.righeStats} righe su ${copertura.giocatoriConStats} giocatori`);

if (problemi) process.exit(1);
