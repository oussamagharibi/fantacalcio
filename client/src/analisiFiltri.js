import { statoGiocatore } from './azioni.js';
import { paraRigori, rigorista } from './giocatore.js';

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
  // Un filtro solo per i rigoristi: primi e secondi insieme. Due caselle
  // separate avrebbero chiesto di sapere in anticipo quale gerarchia
  // interessa, quando la domanda vera e "chi li calcia in questa squadra".
  soloRigoristi: false,
  // Solo nel reparto Portieri: negli altri la colonna e vuota per
  // costruzione e il filtro non avrebbe niente da filtrare.
  soloParaRigori: false,
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
  const {
    cerca = '',
    fasce = [],
    squadra = '',
    soloTarget = false,
    soloSegnali = false,
    soloDisponibili = false,
    soloRigoristi = false,
    soloParaRigori = false,
  } = filtri;
  const q = senzaAccenti(cerca).trim();
  return giocatori
    .filter((g) => !q || senzaAccenti(g.nome).includes(q))
    .filter((g) => !fasce.length || fasce.includes(g.fascia))
    .filter((g) => !squadra || g.squadra === squadra)
    .filter((g) => !soloTarget || g.target)
    .filter((g) => !soloSegnali || (g.segnali?.length ?? 0) > 0)
    .filter((g) => !soloDisponibili || statoGiocatore(g, presi).stato === 'disponibile')
    .filter((g) => !soloRigoristi || !!rigorista(g))
    .filter((g) => !soloParaRigori || !!paraRigori(g))
    // I para-rigori si guardano per confrontarli: chi ne ha di piu sta in
    // cima, o la lista costringe a cercarlo.
    .sort((a, b) => (soloParaRigori ? (paraRigori(b)?.totale ?? 0) - (paraRigori(a)?.totale ?? 0) : 0));
}

/** Quanti filtri sono accesi: serve a mostrare "azzera" solo quando c'e'
 *  qualcosa da azzerare. */
export const quantiAttivi = (f = {}) =>
  (f.cerca ? 1 : 0) +
  (f.fasce?.length ? 1 : 0) +
  (f.squadra ? 1 : 0) +
  (f.soloTarget ? 1 : 0) +
  (f.soloSegnali ? 1 : 0) +
  (f.soloDisponibili ? 1 : 0) +
  (f.soloRigoristi ? 1 : 0) +
  (f.soloParaRigori ? 1 : 0);
