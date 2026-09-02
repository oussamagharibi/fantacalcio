import { getDb, tx } from '../db.js';
import { leggiConfig } from './config.js';
import { carrierePerGiocatore } from './wiki.js';

/** Stato operativo dell'asta: chi e' ancora disponibile, la mia rosa, il
 *  massimo che posso permettermi. Nessuna rete qui dentro: durante l'asta si
 *  scrive solo su purchases e usciti. */

const RUOLI = ['P', 'D', 'C', 'A'];

/** I segnali di un giocatore arrivano concatenati in un campo solo. Separatori
 *  ASCII di campo e record: non possono comparire dentro un testo di redazione,
 *  a differenza di una virgola o di un pipe. */
const SEP_CAMPO = String.fromCharCode(31);
const SEP_VOCE = String.fromCharCode(30);

/** Tutti i giocatori con quello che serve a decidere, in una query sola.
 *  Del fatto che un giocatore sia stato comprato si tiene solo il "non e' piu'
 *  disponibile": da chi e a quanto non esce nemmeno dal server. Il tabellone
 *  delle altre squadre non e' cosa di questa applicazione, e un campo spedito
 *  al browser prima o poi qualcuno lo mostra. */
export function giocatori() {
  // Le ultime stagioni di carriera viaggiano dentro lo stato invece che a
  // richiesta: durante l'asta non si fanno chiamate di rete oltre alle
  // scritture, quindi quando si apre un lotto il dato deve essere gia' qui.
  const carriere = carrierePerGiocatore(5);
  return getDb()
    .prepare(
      `SELECT p.id, p.nome, p.squadra, p.ruolo, p.quotazione, p.quotazione_iniziale, p.fvm,
              p.rapporto_fvm, p.fascia, p.note, p.note_generated_at,
              t.player_id IS NOT NULL AS target,
              u.player_id IS NOT NULL AS uscito,
              a.player_id IS NOT NULL AS acquistato,
              (SELECT group_concat(s.tipo || char(31) || s.testo, char(30))
                 FROM segnali s WHERE s.player_id = p.id) AS segnali
         FROM players p
         LEFT JOIN targets t ON t.player_id = p.id
         LEFT JOIN usciti u ON u.player_id = p.id
         LEFT JOIN purchases a ON a.player_id = p.id
        WHERE p.assente_dal IS NULL
        ORDER BY p.quotazione DESC, p.nome`
    )
    .all()
    .map((r) => ({
      ...r,
      target: !!r.target,
      uscito: !!r.uscito,
      acquistato: !!r.acquistato,
      carriera: carriere.get(r.id) ?? [],
      segnali: (r.segnali ?? '')
        .split(SEP_VOCE)
        .filter(Boolean)
        .map((s) => {
          const [tipo, testo] = s.split(SEP_CAMPO);
          return { tipo, testo };
        }),
    }));
}

/** La mia rosa: budget speso, slot liberi per ruolo, e il massimo sostenibile.
 *  Il massimo e' il residuo meno gli slot ancora da riempire, piu' uno: quel
 *  che posso spendere ora tenendo da parte un credito per ogni buco rimasto. */
export function rosa() {
  const db = getDb();
  const c = leggiConfig();
  const mia = db.prepare('SELECT id, nome FROM teams WHERE nome = ?').get(c.miaSquadra ?? '');
  const slot = { P: c.slotP ?? 0, D: c.slotD ?? 0, C: c.slotC ?? 0, A: c.slotA ?? 0 };
  const presi = mia
    ? db
        .prepare(
          `SELECT a.id, a.prezzo, p.id AS player_id, p.nome, p.squadra, p.ruolo
             FROM purchases a JOIN players p ON p.id = a.player_id
            WHERE a.team_id = ? ORDER BY a.id`
        )
        .all(mia.id)
    : [];
  const spesa = presi.reduce((s, x) => s + x.prezzo, 0);
  const budget = c.budget ?? 0;
  const presiPerRuolo = Object.fromEntries(RUOLI.map((r) => [r, presi.filter((x) => x.ruolo === r).length]));
  const liberiPerRuolo = Object.fromEntries(RUOLI.map((r) => [r, Math.max(0, slot[r] - presiPerRuolo[r])]));
  const slotLiberi = RUOLI.reduce((s, r) => s + liberiPerRuolo[r], 0);
  const residuo = budget - spesa;
  return {
    squadra: c.miaSquadra ?? null,
    budget,
    spesa,
    residuo,
    slot,
    presiPerRuolo,
    liberiPerRuolo,
    slotLiberi,
    massimoSostenibile: slotLiberi > 0 ? Math.max(0, residuo - slotLiberi + 1) : residuo,
    presi,
  };
}

/** Quanti ne restano, per ruolo e per fascia. Sempre a schermo durante l'asta. */
export function restanti() {
  return getDb()
    .prepare(
      `SELECT p.ruolo, p.fascia, count(*) AS n
         FROM players p
         LEFT JOIN usciti u ON u.player_id = p.id
         LEFT JOIN purchases a ON a.player_id = p.id
        WHERE p.assente_dal IS NULL AND u.player_id IS NULL AND a.player_id IS NULL
        GROUP BY p.ruolo, p.fascia`
    )
    .all();
}

/** statsVuote dice all'interfaccia di avvisare che manca lo storico fanta:
 *  Wikipedia da' presenze e gol, la fantamedia solo gli Excel di fantacalcio.it. */
export const stato = () => ({
  giocatori: giocatori(),
  rosa: rosa(),
  restanti: restanti(),
  statsVuote: getDb().prepare('SELECT count(*) AS n FROM stats').get().n === 0,
});

// -------------------------------------------------------------------- azioni

/** Timestamp scritto dall'applicazione, al millesimo. Il CURRENT_TIMESTAMP di
 *  SQLite si ferma al secondo: due azioni nello stesso secondo risultano pari
 *  merito, e l'annulla finirebbe per togliere quella sbagliata. */
const adesso = () => new Date().toISOString();

/** I due formati possono convivere in un db gia' usato: le righe vecchie hanno
 *  "2026-09-01 18:19:00", le nuove la T di ISO. Si confrontano normalizzati,
 *  perche' lo spazio ordina prima della T e falserebbe il paragone. */
const perConfronto = (t) => String(t ?? '').replace(' ', 'T');

/** purchases resta append-only: registrare e' una INSERT, annullare una DELETE
 *  dell'ultima riga. Nessun UPDATE, nessuna riga corretta a posteriori. */
export function registraAcquisto(playerId, prezzo) {
  const db = getDb();
  const c = leggiConfig();
  const mia = db.prepare('SELECT id FROM teams WHERE nome = ?').get(c.miaSquadra ?? '');
  if (!mia) return { ok: false, errore: "la mia squadra non e' configurata" };
  const g = db.prepare('SELECT id, nome FROM players WHERE id = ?').get(playerId);
  if (!g) return { ok: false, errore: 'giocatore inesistente' };
  if (db.prepare('SELECT 1 FROM purchases WHERE player_id = ?').get(playerId))
    return { ok: false, errore: `${g.nome} risulta gia' acquistato` };
  if (db.prepare('SELECT 1 FROM usciti WHERE player_id = ?').get(playerId))
    return { ok: false, errore: `${g.nome} e' gia' uscito dalla lista` };
  const info = db
    .prepare('INSERT INTO purchases (player_id, team_id, prezzo, created_at) VALUES (?, ?, ?, ?)')
    .run(playerId, mia.id, prezzo, adesso());
  return { ok: true, azione: { tipo: 'acquisto', id: Number(info.lastInsertRowid), nome: g.nome, prezzo } };
}

/** "Preso da altri": esce dalla lista e basta. Nessun prezzo, nessuna squadra:
 *  inventarli per riempire due colonne sarebbe peggio che non saperli. */
export function registraUscita(playerId) {
  const db = getDb();
  const g = db.prepare('SELECT id, nome FROM players WHERE id = ?').get(playerId);
  if (!g) return { ok: false, errore: 'giocatore inesistente' };
  if (db.prepare('SELECT 1 FROM usciti WHERE player_id = ?').get(playerId))
    return { ok: false, errore: `${g.nome} e' gia' uscito` };
  if (db.prepare('SELECT 1 FROM purchases WHERE player_id = ?').get(playerId))
    return { ok: false, errore: `${g.nome} risulta acquistato da me` };
  const info = db.prepare('INSERT INTO usciti (player_id, created_at) VALUES (?, ?)').run(playerId, adesso());
  return { ok: true, azione: { tipo: 'uscita', id: Number(info.lastInsertRowid), nome: g.nome } };
}

/** Annulla l'ultima azione, qualunque delle due sia: si confrontano gli ultimi
 *  inserimenti delle due tabelle e vince il piu' recente. */
export function annullaUltima() {
  const db = getDb();
  // Dentro una tabella l'ordine e' l'id: AUTOINCREMENT e' monotono e non
  // dipende dall'orologio. Fra le due tabelle decide il timestamp.
  const acquisto = db
    .prepare(
      `SELECT a.id, a.prezzo, a.created_at, p.nome
         FROM purchases a JOIN players p ON p.id = a.player_id
        ORDER BY a.id DESC LIMIT 1`
    )
    .get();
  const uscita = db
    .prepare(
      `SELECT u.id, u.created_at, p.nome
         FROM usciti u JOIN players p ON p.id = u.player_id
        ORDER BY u.id DESC LIMIT 1`
    )
    .get();
  if (!acquisto && !uscita) return { ok: false, errore: 'niente da annullare' };
  const vinceAcquisto = acquisto && (!uscita || perConfronto(acquisto.created_at) > perConfronto(uscita.created_at));
  return tx((d) => {
    if (vinceAcquisto) {
      d.prepare('DELETE FROM purchases WHERE id = ?').run(acquisto.id);
      return { ok: true, annullata: { tipo: 'acquisto', nome: acquisto.nome, prezzo: acquisto.prezzo } };
    }
    d.prepare('DELETE FROM usciti WHERE id = ?').run(uscita.id);
    return { ok: true, annullata: { tipo: 'uscita', nome: uscita.nome } };
  });
}

export function commutaTarget(playerId) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId))
    return { ok: false, errore: 'giocatore inesistente' };
  if (db.prepare('DELETE FROM targets WHERE player_id = ?').run(playerId).changes) return { ok: true, target: false };
  db.prepare('INSERT INTO targets (player_id) VALUES (?)').run(playerId);
  return { ok: true, target: true };
}
