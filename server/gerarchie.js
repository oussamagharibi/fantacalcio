import { backup } from './db.js';
import { leggiFonti } from './lib/fonti.js';
import { MODELLO, PREZZO, costoReale, scriviCosto } from './lib/analisi.js';
import { segmenta, stima, estrai, nuovoClient, chiaveMancante, PAGINE_GERARCHIE } from './lib/gerarchie.js';

/** Estrazione delle gerarchie titolare/vice. Costa: una chiamata a Claude per
 *  squadra, venti per pagina. Percio' si stampa sempre la stima e si esegue
 *  solo con --yes.
 *
 *  --solo-segmentazione si ferma prima di qualunque chiamata: serve a
 *  controllare che le venti sezioni si trovino ancora, dopo un restyling del
 *  sito, senza spendere niente. */
const ARGS = new Set(process.argv.slice(2));
const CONFERMATO = ARGS.has('--yes');
const SOLO_SEGMENTAZIONE = ARGS.has('--solo-segmentazione');

const log = (m) => console.log(`[gerarchie] ${m}`);
const sezione = (t) => console.log(`\n==== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`);

sezione('SEGMENTAZIONE');
const { fonti } = leggiFonti();
for (const p of PAGINE_GERARCHIE) {
  const f = fonti.find((x) => x.nome === p.fonte);
  log(`${f?.attiva ? 'attiva' : 'spenta'}  ${p.fonte.padEnd(32)} ${f?.url ?? '(nessun url)'}`);
}
const esiti = await segmenta(fonti, log);

let bloccante = false;
for (const e of esiti) {
  if (e.errore) {
    log(`${e.fonte}: ${e.errore}`);
    continue;
  }
  log(`${e.fonte.padEnd(32)} ${e.sezioni.length} sezioni`);
  for (const s of e.sezioni) log(`    ${s.squadra.padEnd(11)} ${String(s.testo.length).padStart(5)} caratteri`);
  if (e.mancanti.length) {
    // Il modulo si regge sulla segmentazione: senza una sezione per squadra i
    // nomi tornerebbero a incrociarsi, che e' il motivo per cui questo
    // percorso esiste al posto di quello sugli articoli.
    log(`ATTENZIONE ${e.fonte}: mancano ${e.mancanti.length} squadre (${e.mancanti.join(', ')})`);
    bloccante = true;
  }
}
if (bloccante) log('Una o piu' + "' pagine non si segmentano per intero: le squadre mancanti non verranno estratte.");

sezione('COSTO');
const s = stima(esiti);
log(`modello: ${MODELLO} ${PREZZO ? `($${PREZZO.input}/1M input, $${PREZZO.output}/1M output)` : "(modello fuori tariffario: nessuna stima)"}`);
log(`chiamate da fare: ${s.chiamate} (una per squadra per pagina)`);
log(`token stimati: ~${s.tokenInput.toLocaleString('it-IT')} input + ~${s.tokenOutput.toLocaleString('it-IT')} output`);
log(`costo stimato: ~${scriviCosto(s.dollari)}  (stima locale, il costo reale arriva dai campi usage)`);

if (SOLO_SEGMENTAZIONE) {
  log('--solo-segmentazione: mi fermo qui, nessuna chiamata fatta.');
  process.exit(0);
}
if (chiaveMancante()) {
  log('ANTHROPIC_API_KEY non impostata: nessuna estrazione. Imposta la chiave e rilancia.');
  process.exit(0);
}
if (!CONFERMATO) {
  log('Nessuna chiamata fatta: rilancia con --yes per confermare la spesa.');
  process.exit(0);
}

const bak = backup('pre-gerarchie');
log(`backup db: ${bak}`);

sezione('ESTRAZIONE');
const { riepilogo, uso } = await estrai(esiti, nuovoClient(), log);

sezione('RIEPILOGO');
for (const r of riepilogo)
  log(`${r.fonte.padEnd(32)} ${r.squadre} squadre | coppie abbinate: ${r.abbinate} | scritte: ${r.scritte} | rimosse dal giro precedente: ${r.rimossi}`);
log(`token reali: ${uso.input.toLocaleString('it-IT')} input + ${uso.output.toLocaleString('it-IT')} output`);
log(`costo reale: ${scriviCosto(costoReale(uso))}`);
process.exit(0);
