import { getDb } from './db.js';
import { cercaPagine, scegliPagina, salvaCarriera, ErroreLimite, FONTE } from './lib/wiki.js';
import { ErroreHttp } from './lib/web.js';
import { setTimeout as attendi } from 'node:timers/promises';

/** CLI: npm run wiki. Storico di carriera da Wikipedia in italiano.
 *
 *  ATTENZIONE: presenze e gol veri, di calcio. NON dati di fantacalcio: media
 *  voto e fantamedia non stanno su Wikipedia, arrivano solo dagli Excel di
 *  fantacalcio.it (npm run import-stats).
 *
 *  Una richiesta ogni due secondi: con 500 giocatori sono una ventina di
 *  minuti. Per questo il giro e' ripartibile - "--solo-mancanti" salta chi ha
 *  gia' la carriera, "--limite N" ne fa solo N. */
const ARGS = process.argv.slice(2);
const ha = (f) => ARGS.includes(f);
const valore = (f, d) => {
  const i = ARGS.indexOf(f);
  return i >= 0 && ARGS[i + 1] ? Number(ARGS[i + 1]) : d;
};
const LIMITE = valore('--limite', Infinity);
const SOLO_MANCANTI = ha('--solo-mancanti');

const log = (m) => console.log(`[wiki] ${m}`);

/** Wikipedia limita a raffica: due secondi fra le richieste non bastano quando
 *  la query porta anche il wikitext. Su 429 si aspetta e si riprova, invece di
 *  bruciare il giocatore e proseguire come se niente fosse. */
const ATTESE = [30_000, 60_000, 120_000];
async function conRiprova(fn, nome) {
  for (let tentativo = 0; ; tentativo++) {
    try {
      return await fn();
    } catch (e) {
      const limitato = e instanceof ErroreLimite || (e instanceof ErroreHttp && e.stato === 429);
      if (!limitato || tentativo >= ATTESE.length) throw e;
      const ms = ATTESE[tentativo];
      log(`limite raggiunto su ${nome}: aspetto ${ms / 1000}s e riprovo`);
      await attendi(ms);
    }
  }
}

/** Nel listone i nomi sono abbreviati ("Martinez L."): i pezzi puntati sono
 *  iniziali del nome proprio e nella ricerca fanno solo rumore. */
const cognomeDi = (nome) =>
  String(nome ?? '')
    .split(/\s+/)
    .filter((p) => p && !p.endsWith('.'))
    .join(' ')
    .trim();

const db = getDb();
const giocatori = db
  .prepare(
    `SELECT p.id, p.nome, p.squadra, p.ruolo,
            (SELECT count(*) FROM carriera c WHERE c.player_id = p.id) AS gia
       FROM players p
      WHERE p.assente_dal IS NULL
      ORDER BY p.quotazione DESC, p.nome`
  )
  .all()
  .filter((g) => !SOLO_MANCANTI || g.gia === 0)
  .slice(0, LIMITE === Infinity ? undefined : LIMITE);

log(`giocatori da cercare: ${giocatori.length}${SOLO_MANCANTI ? ' (solo quelli senza carriera)' : ''}`);
log(`fonte: ${FONTE} — presenze e gol reali, NON dati di fantacalcio`);

const esito = { trovati: 0, scartati: [], errori: [], righe: 0 };
let fermato = false;

for (const [i, g] of giocatori.entries()) {
  if (fermato) break;
  const cognome = cognomeDi(g.nome);
  try {
    const pagine = await conRiprova(() => cercaPagine(cognome, g.squadra), g.nome);
    const { pagina, righe, scartate } = scegliPagina(pagine, g.squadra, g.nome, g.ruolo, cognome);
    if (!pagina) {
      esito.scartati.push({ nome: g.nome, squadra: g.squadra, candidate: scartate });
      log(`${String(i + 1).padStart(3)}/${giocatori.length} ${g.nome.padEnd(20)} SCARTATO: ${scartate.map((s) => `"${s.titolo}" ${s.motivo}`).join(' | ') || 'nessun risultato'}`);
      continue;
    }
    const n = salvaCarriera(g.id, righe, `${FONTE} — ${pagina.titolo}`);
    esito.trovati++;
    esito.righe += n;
    log(`${String(i + 1).padStart(3)}/${giocatori.length} ${g.nome.padEnd(20)} "${pagina.titolo}" -> ${n} righe`);
  } catch (e) {
    if (e instanceof ErroreLimite) {
      log(`FERMO: ${e.message}`);
      log('Wikipedia sta limitando le richieste. Rilancia piu\' tardi con --solo-mancanti per riprendere da dove eri.');
      fermato = true;
      break;
    }
    const msg = e instanceof ErroreHttp ? `HTTP ${e.stato}` : e.message;
    esito.errori.push({ nome: g.nome, errore: msg });
    log(`${String(i + 1).padStart(3)}/${giocatori.length} ${g.nome.padEnd(20)} ERRORE: ${msg}`);
  }
}

console.log();
log(`trovati: ${esito.trovati} | scartati per mancato match: ${esito.scartati.length} | errori: ${esito.errori.length}`);
log(`righe di carriera scritte: ${esito.righe}`);
const tot = db.prepare('SELECT count(DISTINCT player_id) AS g, count(*) AS r FROM carriera').get();
log(`in archivio: ${tot.r} righe su ${tot.g} giocatori`);
if (esito.scartati.length) {
  log('non abbinati (nome come compare in players):');
  for (const s of esito.scartati) log(`    ${s.nome} (${s.squadra})`);
}
if (fermato) process.exit(1);
