import { getDb, tx } from '../db.js';

export const CHIAVI = ['budget', 'numeroSquadre', 'slotP', 'slotD', 'slotC', 'slotA', 'nomiSquadre', 'miaSquadra'];
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

/** Quanti giocatori ci sono in archivio, in totale e per ruolo. perRuolo ha
 *  sempre tutte e quattro le chiavi, anche a zero: cosi' chi legge non deve
 *  distinguere fra "ruolo assente" e "nessun giocatore di quel ruolo". */
export function contaGiocatori() {
  const perRuolo = Object.fromEntries(RUOLI.map((r) => [r, 0]));
  let totale = 0;
  for (const r of getDb().prepare('SELECT ruolo, count(*) AS n FROM players GROUP BY ruolo').all()) {
    if (r.ruolo in perRuolo) perRuolo[r.ruolo] = r.n;
    totale += r.n;
  }
  return { totale, perRuolo };
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

  const numeroSquadre = intero(input.numeroSquadre);
  if (numeroSquadre === null || numeroSquadre < 2)
    return err('numeroSquadre', 'numeroSquadre deve essere un intero maggiore o uguale a 2');

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

  if (!Array.isArray(input.nomiSquadre)) return err('nomiSquadre', 'nomiSquadre deve essere una lista');
  const nomiSquadre = input.nomiSquadre.map((n) => String(n ?? '').trim());
  if (nomiSquadre.length !== numeroSquadre)
    return err('nomiSquadre', `numeroSquadre e' ${numeroSquadre} ma nomiSquadre ha ${nomiSquadre.length} elementi`);
  const iVuoto = nomiSquadre.indexOf('');
  if (iVuoto >= 0) return err('nomiSquadre', `il nome della squadra ${iVuoto + 1} e' vuoto`);
  const visti = new Set();
  for (const n of nomiSquadre) {
    const k = n.toLowerCase();
    if (visti.has(k)) return err('nomiSquadre', `nome squadra duplicato: "${n}"`);
    visti.add(k);
  }

  const miaSquadra = String(input.miaSquadra ?? '').trim();
  if (!nomiSquadre.includes(miaSquadra))
    return err('miaSquadra', `miaSquadra "${miaSquadra}" non e' tra i nomi squadra inseriti`);

  return {
    ok: true,
    valori: {
      budget,
      numeroSquadre,
      slotP: slot.P,
      slotD: slot.D,
      slotC: slot.C,
      slotA: slot.A,
      nomiSquadre,
      miaSquadra,
    },
  };
}

/** Idempotente: dopo la chiamata teams contiene esattamente nomiSquadre.
 *  La DELETE e' sicura perche' questo codice e' raggiungibile solo a config
 *  sbloccata, cioe' con purchases vuota: nessuna riga puo' referenziare un team. */
function sincronizzaTeams(d, nomiSquadre) {
  const ph = nomiSquadre.map(() => '?').join(',');
  const rimosse = d.prepare(`DELETE FROM teams WHERE nome NOT IN (${ph})`).run(...nomiSquadre).changes;
  const ins = d.prepare('INSERT OR IGNORE INTO teams (nome) VALUES (?)');
  let inserite = 0;
  for (const n of nomiSquadre) inserite += ins.run(n).changes;
  return { inserite, rimosse, totale: d.prepare('SELECT count(*) AS n FROM teams').get().n };
}

export function salvaConfig(valori) {
  return tx((d) => {
    const up = d.prepare(
      'INSERT INTO config (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore'
    );
    for (const k of CHIAVI) up.run(k, JSON.stringify(valori[k]));
    return sincronizzaTeams(d, valori.nomiSquadre);
  });
}
