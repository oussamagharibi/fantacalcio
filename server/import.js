import { getDb } from './db.js';
import { importaDaFile, ErroreListone, LISTONE_PATH } from './lib/listone.js';

/** CLI: npm run import. Legge solo il file locale, non tocca mai la rete:
 *  deve funzionare anche quando fantacalcio.it e' irraggiungibile. */
const file = process.argv[2] ?? LISTONE_PATH;

try {
  const r = importaDaFile(file);
  console.log(`[import] file      : ${file}`);
  console.log(`[import] foglio    : "${r.foglio}" (intestazione alla riga ${r.rigaHeader})`);
  console.log(`[import] backup db : ${r.backupDb}`);
  console.log(
    `[import] righe lette: ${r.righeLette} | inserite: ${r.inserite} | aggiornate: ${r.aggiornate} | scartate: ${r.scartate.length}`
  );
  for (const s of r.scartate) console.warn(`[import] SCARTATA riga ${s.riga}: ${s.motivo} -> ${JSON.stringify(s.dati)}`);

  const perRuolo = getDb().prepare('SELECT ruolo, count(*) AS n FROM players GROUP BY ruolo ORDER BY ruolo').all();
  console.log(`[import] in db     : ${r.totale} giocatori (${perRuolo.map((x) => `${x.ruolo}=${x.n}`).join(' ')})`);
} catch (e) {
  if (e instanceof ErroreListone) {
    console.error(`[import] ERRORE: ${e.message}`);
    if (e.righeGrezze) {
      console.error('[import] prime righe grezze del foglio:');
      e.righeGrezze.forEach((riga, i) => console.error(`  riga ${i + 1}: ${JSON.stringify(riga)}`));
    }
  } else {
    console.error(`[import] ERRORE: ${e.message}`);
  }
  process.exit(1);
}
