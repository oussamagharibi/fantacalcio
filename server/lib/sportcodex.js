import { scarica, ErroreHttp } from './web.js';
import { getDb } from '../db.js';
import { normalizza } from './testo.js';

/** La classifica di Serie A da SportCodex.
 *
 *  Serve a pesare l'avversario, non a fare il tifoso: un mio difensore contro
 *  una squadra che segna poco ha piu' probabilita' di clean sheet, che in
 *  questa lega vale +1 piu' quello che sposta il modificatore.
 *
 *  ------------------------------------------------------------------------
 *  ECCEZIONE A robots.txt, dichiarata invece che nascosta.
 *
 *  sportcodexai.com/robots.txt contiene "Disallow: /api/", e la regola di
 *  questo progetto e' rispettare robots.txt. Qui si passa lo stesso, per un
 *  motivo solo: il sito e' di chi usa questa applicazione, e l'istruzione di
 *  usare quell'endpoint viene dal proprietario. robots.txt e' quello che il
 *  proprietario dice ai crawler di terzi; non e' un lucchetto contro se'
 *  stesso.
 *
 *  L'eccezione e' NARROW di proposito: un host, un prefisso, scritti qui
 *  sotto. Non esiste un interruttore "ignora robots" - ogni altra fonte
 *  continua a passare da scaricaSePermesso. Se il sito cambia proprietario,
 *  questa e' la riga da cancellare.
 *  ------------------------------------------------------------------------ */
export const ORIGINE = 'https://sportcodexai.com';
export const ENDPOINT = `${ORIGINE}/api/leagues`;
/** L'endpoint sta dietro /api/, che robots vieta ai crawler. Vedi sopra. */
export const ECCEZIONE_ROBOTS = { host: 'sportcodexai.com', prefisso: '/api/leagues/', motivo: 'sito del proprietario, endpoint indicato da lui' };

/** Serie A. La pagina /leagues chiama fetch('/api/leagues/'+codice) con i
 *  codici di football-data: PL, PD, SA, BL1, FL1, CL. */
export const CODICE_SERIE_A = 'SA';

export const FONTE = 'SportCodex';

/** Quanto tenere buona una classifica gia' scaricata. Cambia dopo le partite,
 *  non fra un premere il pulsante e l'altro: rifarla a ogni giro sarebbe una
 *  richiesta al sito per niente. */
export const VALIDITA_MS = 6 * 60 * 60 * 1000;
const CHIAVE = 'sportcodex-serie-a';

/** Le squadre come le scrive SportCodex non sono sempre come le scrive il
 *  listone: "Como 1907", "Venezia FC". Si abbina sul nome normalizzato dopo
 *  aver tolto le appendici societarie, e SOLO se il risultato e' uno e uno
 *  solo. Due squadre che collassano sullo stesso nome restano non abbinate:
 *  meglio nessun dato che quello della squadra sbagliata. */
const APPENDICI = /\b(?:f\.?c\.?|a\.?c\.?|s\.?s\.?|u\.?s\.?|a\.?s\.?|calcio|1\d{3})\b/g;
export const chiave = (nome) => normalizza(nome).replace(APPENDICI, ' ').replace(/[^a-z0-9]/g, '');

export function abbina(righe, squadre) {
  const perChiave = new Map();
  for (const s of squadre) {
    const k = chiave(s);
    if (perChiave.has(k)) perChiave.set(k, null); // ambigua: si annulla
    else perChiave.set(k, s);
  }
  const abbinate = [];
  const scartate = [];
  for (const r of righe) {
    const s = perChiave.get(chiave(r.name));
    if (!s) {
      scartate.push({ nome: r.name, motivo: s === null ? 'nome ambiguo fra due squadre del listone' : 'non e\' una squadra del listone' });
      continue;
    }
    abbinate.push({ ...r, squadra: s });
  }
  return { abbinate, scartate };
}

/** Dalla riga grezza a quello che serve per pesare un avversario.
 *  golSubitiPerPartita e' il numero che conta: una squadra che ne prende pochi
 *  e' un avversario difficile per i miei attaccanti, una che ne prende tanti
 *  regala clean sheet ai miei difensori quando la incontrano. */
export const conMedie = (r) => ({
  squadra: r.squadra,
  posizione: r.position,
  punti: r.points,
  giocate: r.played,
  golFatti: r.gf,
  golSubiti: r.ga,
  golFattiPerPartita: r.played ? Number((r.gf / r.played).toFixed(2)) : null,
  golSubitiPerPartita: r.played ? Number((r.ga / r.played).toFixed(2)) : null,
});

/** Scarica e normalizza. Non lancia: torna sempre un oggetto che dice com'e'
 *  andata, perche' chi la chiama deve poter proseguire senza. */
export async function scaricaClassifica(codice = CODICE_SERIE_A) {
  const url = `${ENDPOINT}/${codice}`;
  let testo;
  try {
    ({ testo } = await scarica(url, 'application/json'));
  } catch (e) {
    // 403 e 429: si salta e si logga, non si insiste.
    const motivo = e instanceof ErroreHttp ? `l'endpoint ha risposto ${e.stato}` : `non raggiungibile (${e.message})`;
    return { ok: false, motivo, url };
  }
  let j;
  try {
    j = JSON.parse(testo);
  } catch {
    return { ok: false, motivo: 'la risposta non e\' JSON: il formato dell\'endpoint e\' cambiato', url };
  }
  const tabella = j?.tables?.[0]?.table;
  if (!Array.isArray(tabella) || !tabella.length)
    return { ok: false, motivo: 'la risposta non contiene una classifica', url };
  const squadre = getDb().prepare('SELECT DISTINCT squadra FROM players WHERE assente_dal IS NULL').all().map((r) => r.squadra);
  const { abbinate, scartate } = abbina(tabella, squadre);
  if (!abbinate.length) return { ok: false, motivo: 'nessuna squadra della classifica corrisponde al listone', url, scartate };
  return {
    ok: true,
    url,
    competizione: j.competition ?? j.name ?? null,
    aggiornataIl: j.lastUpdated ?? null,
    righe: abbinate.map(conMedie),
    scartate,
  };
}

/** Con la cache: un premere il pulsante non deve valere una richiesta al sito
 *  se quella di stamattina dice ancora la stessa cosa. */
export async function classifica({ forza = false, adesso = Date.now() } = {}) {
  if (!forza) {
    const c = daArchivio();
    if (c && adesso - Date.parse(c.presaIl) < VALIDITA_MS) return { ...c, daCache: true };
  }
  const r = await scaricaClassifica();
  if (r.ok) {
    const con = { ...r, presaIl: new Date(adesso).toISOString() };
    salva(con);
    return { ...con, daCache: false };
  }
  // Fallita adesso: se in archivio c'e' quella di ieri e' meglio di niente,
  // ma va detto che e' vecchia invece di spacciarla per fresca.
  const vecchia = daArchivio();
  if (vecchia) return { ...vecchia, daCache: true, vecchia: true, motivoAggiornamento: r.motivo };
  return r;
}

function salva(c) {
  getDb()
    .prepare('INSERT INTO meta (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore')
    .run(CHIAVE, JSON.stringify(c));
}

export function daArchivio() {
  try {
    const r = getDb().prepare('SELECT valore FROM meta WHERE chiave = ?').get(CHIAVE);
    return r?.valore ? JSON.parse(r.valore) : null;
  } catch {
    return null;
  }
}
