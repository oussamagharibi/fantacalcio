/** Stato di ogni giocatore nell'asta in corso, filtri e riepilogo. Fuori dal
 *  componente perche' e' la parte che vale la pena verificare da sola. */

import { ORDINE_RUOLI } from './squadre.js';
import { statoGiocatore } from './azioni.js';

const senzaAccenti = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// I tre stati vivono in azioni.js insieme alle azioni che li cambiano.
export { STATI } from './azioni.js';

/** Tre stati, non uno di piu'. "Uscito" non porta prezzo ne' squadra perche'
 *  l'applicazione non li registra: quando un giocatore va a un altro
 *  partecipante si preme un tasto solo. Inventare due colonne vuote sarebbe
 *  peggio che ammettere che il dato non c'e'.
 *  Un acquisto che non risulta nella mia rosa e' comunque fuori dall'asta:
 *  vale "Uscito", che e' esattamente quello che se ne sa. */
export function conStato(giocatori, presi) {
  return giocatori.filter((g) => !g.assente_dal).map((g) => ({ ...g, ...statoGiocatore(g, presi) }));
}

export function filtra(righe, { stato = null, ruolo = null, squadra = '', fascia = null, cerca = '', soloObiettivi = false } = {}) {
  const q = senzaAccenti(cerca).trim();
  return righe
    .filter((g) => !stato || g.stato === stato)
    .filter((g) => !ruolo || g.ruolo === ruolo)
    .filter((g) => !squadra || g.squadra === squadra)
    .filter((g) => fascia === null || g.fascia === fascia)
    .filter((g) => !q || senzaAccenti(g.nome).includes(q))
    .filter((g) => !soloObiettivi || g.target);
}

/** Quanto listone e' gia' andato, in totale e ruolo per ruolo. */
export function riepilogo(righe) {
  const vuoto = () => ({ disponibile: 0, me: 0, uscito: 0 });
  const totali = vuoto();
  const perRuolo = Object.fromEntries(ORDINE_RUOLI.map((r) => [r, vuoto()]));
  for (const g of righe) {
    totali[g.stato]++;
    if (perRuolo[g.ruolo]) perRuolo[g.ruolo][g.stato]++;
  }
  const totale = righe.length;
  const andati = totali.me + totali.uscito;
  return {
    totale,
    ...totali,
    andati,
    percentualeAndata: totale > 0 ? Math.round((1000 * andati) / totale) / 10 : 0,
    perRuolo,
    spesa: righe.reduce((s, g) => s + (g.prezzo ?? 0), 0),
  };
}
