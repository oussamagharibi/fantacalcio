import { getDb, tx } from '../db.js';
import { leggiConfig } from './config.js';

/** La rosa come cosa che si corregge a mano, non solo come esito dell'asta.
 *
 *  L'asta e' finita, e da qui in poi la rosa cambia per svincoli e scambi:
 *  serve poter aggiungere, togliere e ritoccare un prezzo senza passare dalle
 *  azioni d'asta, che hanno altri controlli (un giocatore "uscito" non si puo'
 *  comprare, l'annulla toglie l'ultima azione in ordine di tempo). Quelle
 *  regole servono durante l'asta e sono d'intralcio dopo.
 *
 *  Resta una regola sola, e non e' negoziabile: un giocatore non puo' stare in
 *  rosa due volte. */

const adesso = () => new Date().toISOString();

const miaSquadra = () => {
  const c = leggiConfig();
  return getDb().prepare('SELECT id, nome FROM teams WHERE nome = ?').get(c.miaSquadra ?? '') ?? null;
};

/** Aggiunge o corregge: se il giocatore c'e' gia' si cambia il prezzo, se non
 *  c'e' si inserisce. Un solo verbo per due gesti che chi usa l'applicazione
 *  non distingue - "questo l'ho pagato 12" vale in tutti e due i casi. */
export function metti(playerId, prezzo) {
  const db = getDb();
  const mia = miaSquadra();
  if (!mia) return { ok: false, errore: "la mia squadra non e' configurata" };
  const g = db.prepare('SELECT id, nome, ruolo FROM players WHERE id = ?').get(playerId);
  if (!g) return { ok: false, errore: 'giocatore inesistente' };
  const p = Number(prezzo);
  if (!Number.isInteger(p) || p < 0) return { ok: false, errore: 'prezzo non valido' };

  const esistente = db.prepare('SELECT id, prezzo FROM purchases WHERE player_id = ?').get(playerId);
  if (esistente) {
    if (esistente.prezzo === p) return { ok: true, azione: 'invariato', nome: g.nome, prezzo: p };
    db.prepare('UPDATE purchases SET prezzo = ? WHERE id = ?').run(p, esistente.id);
    return { ok: true, azione: 'prezzo', nome: g.nome, prezzo: p, prima: esistente.prezzo };
  }
  // Chi entra in rosa non e' piu' "uscito": le due cose si escludono, e
  // lasciare la vecchia riga vorrebbe dire un giocatore in due stati insieme.
  db.prepare('DELETE FROM usciti WHERE player_id = ?').run(playerId);
  db.prepare('INSERT INTO purchases (player_id, team_id, prezzo, created_at) VALUES (?, ?, ?, ?)').run(
    playerId,
    mia.id,
    p,
    adesso()
  );
  return { ok: true, azione: 'aggiunto', nome: g.nome, ruolo: g.ruolo, prezzo: p };
}

/** Toglie dalla rosa. Non lo segna come "uscito": svincolarlo vuol dire che
 *  non e' piu' mio, non che l'ha preso qualcun altro. */
export function togli(playerId) {
  const db = getDb();
  const g = db.prepare('SELECT id, nome FROM players WHERE id = ?').get(playerId);
  if (!g) return { ok: false, errore: 'giocatore inesistente' };
  const changes = db.prepare('DELETE FROM purchases WHERE player_id = ?').run(playerId).changes;
  if (!changes) return { ok: false, errore: `${g.nome} non e' in rosa` };
  return { ok: true, azione: 'tolto', nome: g.nome };
}

/** Carica una rosa intera in un colpo solo, per nome.
 *
 *  Serve quando l'asta e' stata fatta altrove: si arriva con venticinque nomi
 *  e un prezzo, non con venticinque id. Gli stessi guardiani usati per le
 *  fonti - nome esatto dentro il listone, poi il solo cognome - e un nome
 *  ambiguo NON si assegna: si riporta com'e', perche' due omonimi con lo
 *  stesso cognome sono esattamente il caso in cui indovinare costa caro. */
const normalizza = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cognomeDi = (n) => normalizza(n).split(' ').filter((x) => !x.endsWith('.')).join(' ');

export function abbinaPerNome(voci) {
  const giocatori = getDb().prepare('SELECT id, nome, squadra, ruolo FROM players').all();
  const perNome = new Map();
  const perCognome = new Map();
  for (const p of giocatori) {
    const n = normalizza(p.nome);
    perNome.set(n, [...(perNome.get(n) ?? []), p]);
    const c = cognomeDi(p.nome);
    perCognome.set(c, [...(perCognome.get(c) ?? []), p]);
  }
  const abbinate = [];
  const problemi = [];
  for (const v of voci) {
    const esatti = perNome.get(normalizza(v.nome)) ?? [];
    const candidati = esatti.length ? esatti : perCognome.get(cognomeDi(v.nome)) ?? [];
    if (candidati.length === 1) {
      abbinate.push({ ...v, player_id: candidati[0].id, giocatore: candidati[0], via: esatti.length ? 'nome esatto' : 'cognome' });
      continue;
    }
    problemi.push({
      ...v,
      motivo: candidati.length ? `${candidati.length} omonimi` : 'nome non trovato nel listone',
      candidati: candidati.map((c) => ({ id: c.id, nome: c.nome, squadra: c.squadra, ruolo: c.ruolo })),
    });
  }
  return { abbinate, problemi };
}

/** Tutto o niente: se anche un solo nome non si risolve non si scrive nulla.
 *  Una rosa a ventiquattro sembra completa e non lo e', e il buco lo si scopre
 *  la settimana dopo guardando la formazione. */
export function caricaRosa(voci, { sostituisci = true } = {}) {
  const { abbinate, problemi } = abbinaPerNome(voci);
  if (problemi.length) return { ok: false, problemi, abbinate: abbinate.length };
  const mia = miaSquadra();
  if (!mia) return { ok: false, errore: "la mia squadra non e' configurata", problemi: [] };
  const scritte = tx((d) => {
    if (sostituisci) d.prepare('DELETE FROM purchases WHERE team_id = ?').run(mia.id);
    const ins = d.prepare('INSERT INTO purchases (player_id, team_id, prezzo, created_at) VALUES (?, ?, ?, ?)');
    const quando = adesso();
    let n = 0;
    for (const a of abbinate) {
      d.prepare('DELETE FROM usciti WHERE player_id = ?').run(a.player_id);
      ins.run(a.player_id, mia.id, a.prezzo, quando);
      n++;
    }
    return n;
  });
  return { ok: true, scritte, abbinate, problemi: [], spesa: abbinate.reduce((s, a) => s + a.prezzo, 0) };
}
