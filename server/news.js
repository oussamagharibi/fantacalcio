import { getDb, backup } from './db.js';
import { leggiFonti, risolviFeed, risolviPagine, FONTI_PATH } from './lib/fonti.js';
import { raccogli, associa, perGiocatore, salvaNota, GIORNI_MAX, CARATTERI_MINIMI } from './lib/notizie.js';
import { stimaCosto, costoReale, chiaveMancante, generaNota, conFonti, nuovoClient, MODELLO, PREZZO } from './lib/analisi.js';
import { raccogliSegnali, contaSegnali, FONTI_CON_PARSER } from './lib/fantacalcio.js';
import { raccogliInfortuni, FONTI_INFORTUNI } from './lib/infortuni.js';

/** Script batch del modulo notizie. Da lanciare PRIMA dell'asta, mai durante:
 *  fa decine di richieste con due secondi di pausa e puo' durare minuti.
 *  Se fallisce non rompe niente: players.note e' opzionale e l'app funziona
 *  identica senza. */
const ARGS = new Set(process.argv.slice(2));
const CONFERMATO = ARGS.has('--yes');
const SOLO_RACCOLTA = ARGS.has('--solo-raccolta');
const MIN_ARTICOLI = 2;

const log = (m) => console.log(`[news] ${m}`);
const sezione = (t) => console.log(`\n${'='.repeat(4)} ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`);

sezione('FONTI');
const { fonti, creato } = leggiFonti();
log(`file fonti: ${FONTI_PATH}${creato ? ' (creato ora con le fonti di default)' : ''}`);
await risolviFeed(fonti, (m) => log(m));
// L'url di Sky cambia ogni giornata: si riscopre a ogni giro.
await risolviPagine(fonti, (m) => log(m));
for (const f of fonti) {
  const stato = f.attiva ? 'attiva ' : 'spenta ';
  log(`  ${stato} ${f.nome.padEnd(26)} ${f.tipo.padEnd(7)} ${f.url ?? '(nessun url)'}${f.errore ? `  <- ${f.errore}` : ''}`);
}

/** Tutte le fonti che hanno un parser dedicato: restano fuori dal percorso
 *  generico, altrimenti finirebbero anche in articles e dentro associa(). */
const TUTTE_CON_PARSER = new Set([...FONTI_CON_PARSER, ...FONTI_INFORTUNI]);

const bak = backup('pre-news');
log(`backup db: ${bak}`);

sezione('SEGNALI DALLE PAGINE-ELENCO');
const esitiSegnali = await raccogliSegnali(fonti, (m) => log(m));
for (const e of esitiSegnali) {
  if (e.errore) {
    log(`${e.fonte.padEnd(26)} ERRORE: ${e.errore} (i segnali precedenti restano)`);
    continue;
  }
  log(
    `${e.fonte.padEnd(26)} voci lette: ${String(e.lette).padStart(4)} | abbinate: ${String(e.abbinate).padStart(4)} | ` +
      `non abbinate: ${String(e.nonAbbinati.length).padStart(3)}`
  );
  for (const n of e.nonAbbinati) log(`    non abbinato: "${n.nome}"${n.squadra ? ` (${n.squadra})` : ''} - ${n.motivo}`);
}
sezione('INFORTUNI, DUBBI, SQUALIFICHE E DIFFIDE');
const esitiInfortuni = await raccogliInfortuni(fonti, (m) => log(m));
for (const e of esitiInfortuni) {
  if (e.errore) {
    log(`${e.fonte.padEnd(26)} ERRORE: ${e.errore} (i segnali precedenti restano)`);
    continue;
  }
  log(`${e.fonte.padEnd(26)} ${e.url}`);
  const perTipo = Object.entries(e.perTipo).map(([t, n]) => `${t} ${n}`).join(', ') || 'niente';
  log(
    `${''.padEnd(26)} voci lette: ${String(e.lette).padStart(4)} (${perTipo}) | abbinate: ${String(e.abbinate).padStart(4)} | ` +
      `non abbinate: ${String(e.nonAbbinati.length).padStart(3)}`
  );
  for (const n of e.nonAbbinati) log(`    non abbinato: "${n.nome}"${n.squadra ? ` (${n.squadra})` : ''} - ${n.motivo}`);
}

for (const s of contaSegnali()) log(`segnali in archivio, ${s.tipo}: ${s.n}`);

// Le pagine con parser non devono restare anche in articles: la' finirebbero
// di nuovo dentro associa(), che e' proprio il percorso che stiamo scavalcando.
const ripulite = getDb()
  .prepare(`DELETE FROM articles WHERE fonte IN (${[...TUTTE_CON_PARSER].map(() => '?').join(',')})`)
  .run(...TUTTE_CON_PARSER).changes;
if (ripulite) log(`articoli rimossi perche' ora gestiti dai parser: ${ripulite}`);

sezione('RACCOLTA ARTICOLI');
const esiti = await raccogli(
  fonti.filter((f) => !TUTTE_CON_PARSER.has(f.nome)),
  (m) => log(m)
);
for (const e of esiti) {
  log(
    `${e.nome.padEnd(26)} trovati: ${String(e.trovati ?? 0).padStart(3)} | scaricati: ${String(e.scaricati).padStart(3)} | ` +
      `gia' presenti: ${String(e.saltatiGiaPresenti).padStart(3)} | scartati per data (>${GIORNI_MAX}gg): ${String(e.scartatiPerData).padStart(3)}` +
      (e.errori.length ? ` | errori: ${e.errori.length}` : '')
  );
  for (const err of e.errori) log(`    errore: ${err}`);
}
const totali = getDb().prepare('SELECT count(*) AS n FROM articles').get().n;
log(`articoli in archivio: ${totali}`);

sezione('ASSOCIAZIONE NOME-ARTICOLO');
const { articoli, associazioni, ambigui, troppoCorti, scartatiSenzaSquadra, nonRisolvibili } = associa();
log(`articoli negli ultimi ${GIORNI_MAX} giorni: ${articoli.length}`);
log(`associazioni trovate: ${associazioni.length}`);
const cadute = scartatiSenzaSquadra.univoci + scartatiSenzaSquadra.ambigui;
log(
  `cadute per il filtro squadra: ${cadute} ` +
    `(${scartatiSenzaSquadra.univoci} con cognome univoco, ${scartatiSenzaSquadra.ambigui} con cognome ambiguo)`
);
for (const s of scartatiSenzaSquadra.esempi) {
  log(`    scartata: ${s.nome.padEnd(18)} (${s.squadra}) non citata in [${s.fonte}] ${String(s.titolo).slice(0, 44)}${s.ambiguo ? '  AMBIGUO' : ''}`);
}
log(`ambiguita' non risolvibile, associazioni scartate: ${nonRisolvibili.length}`);
for (const n of nonRisolvibili.slice(0, 10)) {
  log(`    ambiguita' non risolvibile: "${n.cognome}" -> ${n.giocatori.join(' | ')} in [${n.fonte}] ${String(n.titolo).slice(0, 40)}`);
}
log(`cognomi sotto i ${CARATTERI_MINIMI} caratteri, esclusi: ${troppoCorti.length}${troppoCorti.length ? ` (${troppoCorti.slice(0, 8).map((g) => g.nome).join(', ')}${troppoCorti.length > 8 ? ', ...' : ''})` : ''}`);
if (ambigui.length) {
  log(`cognomi ambigui: ${ambigui.length} - li separa la squadra citata; dove non e' citata l'associazione cade`);
  for (const a of ambigui) log(`    "${a.cognome}" -> ${a.giocatori.map((g) => `${g.nome} (${g.squadra})`).join(' | ')}`);
}
for (const a of associazioni.slice(0, 10)) {
  log(`    ${a.nome.padEnd(20)} <- [${a.fonte}] ${(a.titolo ?? a.url).slice(0, 60)}${a.ambiguo ? '  (AMBIGUO)' : ''}`);
}

const daAnalizzare = perGiocatore(associazioni, MIN_ARTICOLI);
sezione('ANALISI');
log(`giocatori con almeno ${MIN_ARTICOLI} articoli: ${daAnalizzare.length}`);

if (SOLO_RACCOLTA) {
  log('--solo-raccolta: mi fermo qui.');
  process.exit(0);
}
if (!daAnalizzare.length) {
  log('nessun giocatore da analizzare: niente da generare.');
  process.exit(0);
}

const stima = stimaCosto(daAnalizzare);
log(`modello: ${MODELLO} ($${PREZZO.input}/1M input, $${PREZZO.output}/1M output)`);
log(`chiamate da fare: ${stima.chiamate}`);
log(`token stimati: ~${stima.tokenInput.toLocaleString('it-IT')} input + ~${stima.tokenOutput.toLocaleString('it-IT')} output`);
log(`costo stimato: ~$${stima.dollari.toFixed(4)}  (stima locale, il costo reale arriva dai campi usage)`);

if (chiaveMancante()) {
  log('ANTHROPIC_API_KEY non impostata: articoli raccolti e salvati, generazione delle note SALTATA.');
  log('Imposta la chiave in .env e rilancia per generare le note.');
  process.exit(0);
}
if (!CONFERMATO) {
  log('Nessuna nota generata: rilancia con --yes per confermare la spesa.');
  process.exit(0);
}

const client = nuovoClient();
const uso = { input: 0, output: 0 };
let fatte = 0;
let falliti = 0;
for (const g of daAnalizzare) {
  const r = await generaNota(client, g);
  if (!r.ok) {
    falliti++;
    log(`${g.nome}: ${r.errore}`);
    continue;
  }
  uso.input += r.uso.input;
  uso.output += r.uso.output;
  salvaNota(g.player_id, conFonti(r.testo, g.articoli));
  fatte++;
  log(`${g.nome.padEnd(20)} nota salvata (${g.articoli.length} articoli, ${r.uso.input}+${r.uso.output} token)`);
}
log(`note generate: ${fatte} | fallite: ${falliti}`);
log(`token reali: ${uso.input.toLocaleString('it-IT')} input + ${uso.output.toLocaleString('it-IT')} output`);
log(`costo reale: $${costoReale(uso).toFixed(4)}`);
