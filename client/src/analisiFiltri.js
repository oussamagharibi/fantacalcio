import { statoGiocatore } from './azioni.js';

/** Ricerca e filtri della pagina Analisi. Stanno fuori dal componente perche'
 *  sono la parte che vale la pena provare da sola: sei criteri combinabili
 *  dentro un reparto alla volta, e un errore qui e' invisibile a occhio.
 *
 *  Tutto sui dati gia' in memoria: nessuna chiamata di rete mentre si digita. */

const senzaAccenti = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** I filtri partono vuoti e vivono in App: cambiando tab restano quelli, e
 *  ognuno filtra il proprio reparto. */
export const FILTRI_VUOTI = {
  cerca: '',
  fasce: [],
  squadra: '',
  soloTarget: false,
  soloSegnali: false,
  soloDisponibili: false,
};

/** Le fasce sono a selezione multipla: un chip acceso si spegne, uno spento si
 *  accende, e la lista vuota vuol dire "tutte". */
export const commutaFascia = (fasce, f) => (fasce.includes(f) ? fasce.filter((x) => x !== f) : [...fasce, f].sort());

export const squadreDi = (giocatori) =>
  [...new Set(giocatori.filter((g) => !g.assente_dal).map((g) => g.squadra))].sort((a, b) => a.localeCompare(b, 'it'));

/** Chi e' uscito dal listino non si compra piu': resta nello stato per la
 *  pagina Listone, ma qui non entra nemmeno nel totale del reparto. */
export const perReparto = (giocatori, ruolo) => giocatori.filter((g) => !g.assente_dal && g.ruolo === ruolo);

export function filtra(giocatori, filtri = {}, presi = []) {
  const { cerca = '', fasce = [], squadra = '', soloTarget = false, soloSegnali = false, soloDisponibili = false } = filtri;
  const q = senzaAccenti(cerca).trim();
  return giocatori
    .filter((g) => !q || senzaAccenti(g.nome).includes(q))
    .filter((g) => !fasce.length || fasce.includes(g.fascia))
    .filter((g) => !squadra || g.squadra === squadra)
    .filter((g) => !soloTarget || g.target)
    .filter((g) => !soloSegnali || (g.segnali?.length ?? 0) > 0)
    .filter((g) => !soloDisponibili || statoGiocatore(g, presi).stato === 'disponibile');
}

/** Quanti filtri sono accesi: serve a mostrare "azzera" solo quando c'e'
 *  qualcosa da azzerare. */
export const quantiAttivi = (f = {}) =>
  (f.cerca ? 1 : 0) +
  (f.fasce?.length ? 1 : 0) +
  (f.squadra ? 1 : 0) +
  (f.soloTarget ? 1 : 0) +
  (f.soloSegnali ? 1 : 0) +
  (f.soloDisponibili ? 1 : 0);
