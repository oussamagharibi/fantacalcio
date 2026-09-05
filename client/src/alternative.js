import { statoGiocatore } from './azioni.js';
import { titolarita } from './giocatore.js';
import { SQUADRE, RUOLI } from './squadre.js';

/** Gli altri giocatori della stessa squadra e dello stesso ruolo.
 *
 *  E' un filtro locale su dati gia' in memoria: aprire un lotto non deve fare
 *  una richiesta di rete, perche' si apre un lotto mentre qualcuno sta gia'
 *  rilanciando.
 *
 *  E' un'informazione DEDOTTA, non dichiarata: la fonte dice chi gioca con che
 *  probabilita', non chi sostituisce chi. Nel Classic due attaccanti della
 *  stessa squadra scendono in campo insieme tutte le settimane, quindi
 *  chiamarli "riserve" o "panchinari" sarebbe scrivere una cosa che i dati non
 *  dicono. Sono altri dello stesso ruolo: nient'altro. */

export const MASSIMO = 4;

/** Ordinamento: prima chi gioca di piu'. Chi non ha una percentuale finisce in
 *  fondo - assente non vuol dire zero - e a pari merito decide la quotazione. */
const perTitolarita = (a, b) => {
  if (a.percentuale === null) return b.percentuale === null ? b.g.quotazione - a.g.quotazione : 1;
  if (b.percentuale === null) return -1;
  return b.percentuale - a.percentuale || b.g.quotazione - a.g.quotazione || a.g.nome.localeCompare(b.g.nome, 'it');
};

/** C'e' un ballottaggio dichiarato fra questi due? E' la sola cosa che la fonte
 *  afferma davvero; tutto il resto di questa lista e' dedotto. */
export const ballottaggioFra = (ballottaggi, unoId, dueId) =>
  (ballottaggi ?? []).find(
    (b) =>
      (b.uno.id === unoId && b.due.id === dueId) || (b.uno.id === dueId && b.due.id === unoId)
  ) ?? null;

export function alternative(giocatori, g, presi = [], ballottaggi = [], massimo = MASSIMO) {
  if (!g) return [];
  return (giocatori ?? [])
    .filter((x) => x.id !== g.id && x.squadra === g.squadra && x.ruolo === g.ruolo && !x.assente_dal)
    .map((x) => ({
      g: x,
      percentuale: titolarita(x)?.percentuale ?? null,
      stato: statoGiocatore(x, presi).stato,
      ballottaggio: ballottaggioFra(ballottaggi, g.id, x.id),
    }))
    .sort(perTitolarita)
    .slice(0, massimo);
}

/** "altri attaccanti del Sassuolo". L'articolo viene dalla tabella delle
 *  squadre: e' genere grammaticale, non si ricava dal nome. */
export function etichetta(g) {
  const ruolo = (RUOLI[g?.ruolo]?.nome ?? '').toLowerCase();
  const di = SQUADRE[g?.squadra]?.di ?? 'del';
  return `altri ${ruolo} ${di}${di.endsWith("'") ? '' : ' '}${g?.squadra ?? ''}`;
}

export const ETICHETTE_STATO = {
  disponibile: 'disponibile',
  me: 'in rosa',
  uscito: 'uscito',
};
