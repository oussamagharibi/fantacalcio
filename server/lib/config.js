import { getDb, tx } from '../db.js';

/** L'applicazione tiene solo la MIA rosa: gli altri partecipanti non servono
 *  a nulla, quindi non si chiedono. numeroSquadre e nomiSquadre non fanno piu'
 *  parte della configurazione; se restano in un db vecchio, vengono ignorate. */
export const CHIAVI = ['budget', 'slotP', 'slotD', 'slotC', 'slotA', 'miaSquadra'];
const RUOLI = ['P', 'D', 'C', 'A'];

export function leggiConfig() {
  const out = {};
  for (const r of getDb().prepare('SELECT chiave, valore FROM config').all()) {
    try {
      out[r.chiave] = JSON.parse(r.valore);
    } catch {
      out[r.chiave] = r.valore;
    }
  }
  return out;
}

export const numeroAcquisti = () => getDb().prepare('SELECT count(*) AS n FROM purchases').get().n;

/** La config e' bloccata dal primo acquisto: cambiare il budget a meta' asta
 *  renderebbe incoerenti i calcoli gia' fatti. Si sblocca solo con POST /api/reset. */
export const bloccata = () => numeroAcquisti() > 0;

export const configurata = (c = leggiConfig()) => CHIAVI.every((k) => c[k] !== undefined && c[k] !== null);

/** Quanti giocatori ci sono in archivio. perRuolo ha sempre tutte e quattro le
 *  chiavi, anche a zero: cosi' chi legge non deve distinguere fra "ruolo assente"
 *  e "nessun giocatore di quel ruolo".
 *  perRuolo conta solo chi e' ancora in listino (assente_dal IS NULL), perche' e'
 *  il numero che serve in asta; totale comprende anche gli usciti, che restano in
 *  archivio perche' possono essere gia' stati acquistati. */
export function contaGiocatori() {
  const perRuolo = Object.fromEntries(RUOLI.map((r) => [r, 0]));
  let totale = 0;
  let attivi = 0;
  const righe = getDb()
    .prepare('SELECT ruolo, assente_dal IS NULL AS attivo, count(*) AS n FROM players GROUP BY ruolo, assente_dal IS NULL')
    .all();
  for (const r of righe) {
    totale += r.n;
    if (!r.attivo) continue;
    attivi += r.n;
    if (r.ruolo in perRuolo) perRuolo[r.ruolo] = r.n;
  }
  return { totale, attivi, nonPiuInListino: totale - attivi, perRuolo };
}

export function statoConfig() {
  const config = leggiConfig();
  return {
    configurata: configurata(config),
    bloccata: bloccata(),
    acquisti: numeroAcquisti(),
    squadre: getDb().prepare('SELECT count(*) AS n FROM teams').get().n,
    giocatori: contaGiocatori(),
    config,
  };
}

const intero = (v) =>
  Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : null;

export function validaConfig(input) {
  const err = (campo, errore) => ({ ok: false, campo, errore });

  const budget = intero(input.budget);
  if (budget === null || budget <= 0) return err('budget', 'budget deve essere un intero maggiore di 0');

  const slot = {};
  for (const r of RUOLI) {
    const v = intero(input[`slot${r}`]);
    if (v === null || v < 0) return err(`slot${r}`, `slot${r} deve essere un intero maggiore o uguale a 0`);
    slot[r] = v;
  }
  const slotTotali = RUOLI.reduce((s, r) => s + slot[r], 0);
  if (slotTotali === 0) return err('slotP', 'la rosa non puo essere vuota: almeno uno slot deve essere maggiore di 0');
  if (slotTotali > budget)
    return err(
      'budget',
      `slot totali (${slotTotali}) maggiori del budget (${budget}): la rosa non sarebbe completabile nemmeno a 1 credito per slot`
    );

  const miaSquadra = String(input.miaSquadra ?? '').trim();
  if (!miaSquadra) return err('miaSquadra', 'serve il nome della mia squadra');

  return {
    ok: true,
    valori: { budget, slotP: slot.P, slotD: slot.D, slotC: slot.C, slotA: slot.A, miaSquadra },
  };
}

/** teams resta, ma con una riga sola: la mia squadra. La tabella serve ancora
 *  perche' purchases.team_id la referenzia; un elenco di partecipanti che non
 *  si usa mai era solo un modulo in piu' da compilare.
 *  La DELETE e' sicura perche' questo codice e' raggiungibile solo a config
 *  sbloccata, cioe' con purchases vuota: nessuna riga puo' referenziare un team. */
function sincronizzaTeams(d, miaSquadra) {
  const rimosse = d.prepare('DELETE FROM teams WHERE nome <> ?').run(miaSquadra).changes;
  const inserite = d.prepare('INSERT OR IGNORE INTO teams (nome) VALUES (?)').run(miaSquadra).changes;
  return { inserite, rimosse, totale: d.prepare('SELECT count(*) AS n FROM teams').get().n };
}

export function salvaConfig(valori) {
  return tx((d) => {
    const up = d.prepare(
      'INSERT INTO config (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore'
    );
    for (const k of CHIAVI) up.run(k, JSON.stringify(valori[k]));
    // Un db preparato con una versione precedente conserva numeroSquadre e
    // nomiSquadre. Nessuno le legge piu', ma leggiConfig() prende tutte le
    // righe: resterebbero in GET /api/config, cioe' i nomi degli altri
    // partecipanti spediti al browser senza che servano a niente.
    const ph = CHIAVI.map(() => '?').join(',');
    d.prepare(`DELETE FROM config WHERE chiave NOT IN (${ph})`).run(...CHIAVI);
    return sincronizzaTeams(d, valori.miaSquadra);
  });
}
