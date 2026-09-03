import fs from 'node:fs';
import path from 'node:path';
import { getDb, backup, perLog, DATA_DIR } from './db.js';
import { permesso, scarica, ErroreHttp } from './lib/web.js';
import {
  FONTE,
  PAGINA,
  abbina,
  campiMancanti,
  estremiScarto,
  leggiContenuto,
  normalizzaRiga,
  salvaXg,
  stagioneDa,
  stagioniInArchivio,
} from './lib/understat.js';

/** CLI: npm run xg. Expected goals da Understat.
 *
 *  ATTENZIONE: xG e' calcio vero, non fantacalcio. Non e' un voto e non e' una
 *  fantamedia: e' quanto valevano le occasioni avute. Il confronto con i gol
 *  fatti dice se uno ha reso sopra o sotto quello che si e' costruito.
 *
 *  DA DOVE ARRIVANO I DATI. Non dalla rete: understat.com pubblica un robots.txt
 *  con "Disallow: /", cioe' vieta l'accesso automatico a tutto il sito, e la
 *  regola di questo progetto e' rispettarlo. In piu' la pagina non contiene
 *  piu' la variabile playersData: e' un guscio di 18 KB che carica i dati da
 *  JavaScript, quindi anche ignorando robots non ci sarebbe niente da leggere.
 *  Il file lo salvi tu dal browser (l'esportazione json/csv sotto la tabella,
 *  oppure la pagina intera se un giorno playersData tornasse) e lo metti in
 *  data/understat/. */

const ARGS = process.argv.slice(2);
const ha = (f) => ARGS.includes(f);
const valore = (f) => {
  const i = ARGS.indexOf(f);
  return i >= 0 ? ARGS[i + 1] : null;
};

const CARTELLA = path.join(DATA_DIR, 'understat');
const log = (m) => console.log(`[xg] ${m}`);

/** Da quale stagione viene un file. Esplicita con --stagione, altrimenti
 *  dall'anno nel nome del file: "serie_a_2025.json" -> 2025-2026. Se non si
 *  capisce si rifiuta, invece di scrivere righe sotto la stagione sbagliata. */
function stagioneDelFile(file, esplicita) {
  if (esplicita) return stagioneDa(String(esplicita).slice(0, 4));
  const m = /(20\d{2})/.exec(path.basename(file));
  return m ? stagioneDa(m[1]) : null;
}

function fileDaUsare() {
  const singolo = valore('--file');
  if (singolo) return [singolo];
  if (!fs.existsSync(CARTELLA)) return [];
  return fs
    .readdirSync(CARTELLA)
    .filter((f) => /\.(json|csv|html?|txt)$/i.test(f))
    .map((f) => path.join(CARTELLA, f))
    .sort();
}

/** Il tentativo di rete esiste per dare una risposta, non per aggirare la
 *  regola: chiede il permesso a robots.txt e si ferma li'. */
async function provaRete(anno) {
  const url = PAGINA(anno);
  if (!(await permesso(url))) {
    log(`rete: ${url} e' vietato dal robots.txt di ${FONTE} ("Disallow: /"). Non lo scarico.`);
    return null;
  }
  try {
    const { testo } = await scarica(url);
    return testo;
  } catch (e) {
    log(`rete: ${e instanceof ErroreHttp ? `HTTP ${e.stato}` : e.message}`);
    return null;
  }
}

function istruzioni() {
  console.log();
  log('Nessun file da leggere. Come procurarseli, una volta per stagione:');
  log(`  1. apri ${PAGINA(2025)} nel browser`);
  log('  2. sotto la tabella dei giocatori scegli il formato json e salva');
  log(`  3. metti il file in ${CARTELLA} con l'anno nel nome, per esempio serie_a_2025.json`);
  log('  4. rilancia npm run xg');
  log('Vale anche per /2024. Con --file <percorso> --stagione 2025 si legge un file qualsiasi.');
  log('Con --azzera si svuota xg prima di ricominciare (fa un backup).');
}

// ------------------------------------------------------------------ esecuzione

const db = getDb();

/** --azzera: via tutte le righe di xg prima di ricominciare. Serve quando le
 *  righe in archivio sono state scritte da una versione precedente del lettore,
 *  o quando restano stagioni di cui non si ha piu' il file: un upsert le
 *  aggiornerebbe soltanto dove ripassa, lasciando indietro le altre.
 *  Con backup, perche' cancellare va fatto potendo tornare indietro. */
if (ha('--azzera')) {
  const prima = db.prepare('SELECT stagione, count(*) AS n FROM xg GROUP BY stagione ORDER BY stagione').all();
  if (prima.length) {
    const copia = backup('pre-azzera-xg');
    log(`backup in ${perLog(copia)}`);
    for (const s of prima) log(`  tolgo ${s.n} righe della stagione ${s.stagione}`);
    log(`righe cancellate: ${db.prepare('DELETE FROM xg').run().changes}`);
  } else log('xg era gia vuota');
}

const giocatori = db
  .prepare('SELECT id, nome, squadra, ruolo, quotazione FROM players WHERE assente_dal IS NULL ORDER BY nome')
  .all();

log(`fonte: ${FONTE} — expected goals, dati reali di calcio, NON fantacalcio`);
log(`giocatori in listino da abbinare: ${giocatori.length}`);

let file = fileDaUsare();
if (!file.length && ha('--rete')) {
  const anno = valore('--stagione') ?? 2025;
  const testo = await provaRete(anno);
  if (testo) {
    fs.mkdirSync(CARTELLA, { recursive: true });
    const dove = path.join(CARTELLA, `serie_a_${anno}.html`);
    fs.writeFileSync(dove, testo);
    log(`scaricato in ${dove}`);
    file = [dove];
  }
}

if (!file.length) {
  istruzioni();
  process.exit(1);
}

let scritte = 0;
const stagioniFatte = [];

for (const f of file) {
  console.log();
  const stagione = stagioneDelFile(f, valore('--stagione'));
  if (!stagione) {
    log(`${path.basename(f)}: non capisco a quale stagione appartiene. Metti l'anno nel nome del file o usa --stagione.`);
    continue;
  }
  if (!fs.existsSync(f)) {
    log(`${f}: non esiste`);
    continue;
  }
  const { righe: grezze, formato, motivo } = leggiContenuto(fs.readFileSync(f, 'utf8'));
  if (!grezze) {
    log(`${path.basename(f)}: non riesco a leggerlo — ${motivo}`);
    continue;
  }
  const righe = grezze.map(normalizzaRiga).filter(Boolean);
  log(`${path.basename(f)} -> stagione ${stagione}, formato ${formato}, ${righe.length} righe di giocatori`);
  const senzaSquadra = righe.filter((r) => !r.squadra).length;
  if (senzaSquadra)
    log(`  ATTENZIONE: ${senzaSquadra} righe senza squadra. Senza squadra il guardiano non regge e non verranno abbinate.`);
  const mancanti = campiMancanti(righe);
  if (mancanti.length) log(`  campi assenti nel file, resteranno a null: ${mancanti.join(', ')}`);

  const { abbinati, ambigui, senzaCandidati } = abbina(giocatori, righe);
  const n = salvaXg(stagione, abbinati);
  scritte += n;
  stagioniFatte.push({ stagione, abbinati: abbinati.length, ambigui: ambigui.length, righe: righe.length });

  log(`  abbinati ${abbinati.length}/${giocatori.length} · scartati per ambiguita' ${ambigui.length} · senza riscontro ${senzaCandidati.length}`);
  log(`  righe scritte in xg: ${n}`);

  // Ogni scarto va detto per nome: e' l'unico modo di accorgersi che un
  // guardiano e' troppo stretto o troppo largo.
  for (const a of ambigui)
    log(`  SCARTATO ${a.giocatore.nome} (${a.giocatore.squadra}) — ${a.candidati.length} candidati: ${a.candidati.map((c) => `"${c.nome}" [${c.squadra}]`).join(', ')}`);

  const esempi = abbinati.slice(0, 10);
  if (esempi.length) {
    log('  primi abbinamenti:');
    for (const e of esempi)
      log(`    ${e.giocatore.nome.padEnd(22)} <- "${e.riga.nome}" [${e.riga.squadra}] ${e.riga.gol} gol / ${e.riga.xg} xG`);
  }
}

console.log();
log(`totale righe scritte: ${scritte}`);
for (const s of stagioniInArchivio()) log(`in archivio: ${s.stagione} -> ${s.n} giocatori`);

for (const { stagione } of stagioniFatte) {
  const { sotto, sopra } = estremiScarto(stagione);
  if (!sotto.length) continue;
  console.log();
  log(`${stagione} — hanno segnato MENO di quanto valevano le occasioni (il listone puo' sottovalutarli):`);
  for (const r of sotto) log(`    ${r.nome.padEnd(22)} ${r.gol} gol / ${r.xg} xG = ${r.scarto_xg}  (${r.minuti}')`);
  log(`${stagione} — hanno segnato PIU' del previsto (statisticamente tornera' giu'):`);
  for (const r of sopra) log(`    ${r.nome.padEnd(22)} ${r.gol} gol / ${r.xg} xG = +${r.scarto_xg}  (${r.minuti}')`);
}
