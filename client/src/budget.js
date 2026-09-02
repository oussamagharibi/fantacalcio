/** Aritmetica del budget. Sta fuori dai componenti perche' e' la parte che
 *  vale la pena verificare da sola: durante un rilancio questi numeri sono
 *  l'unica cosa che si guarda. */

const it = (n, decimali = 1) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: decimali });

/** Quota sul budget totale. In asta la cifra secca dice poco, "un quinto di
 *  quello che ho" dice tutto. */
export const percentuale = (parte, totale) => it(totale > 0 ? (100 * parte) / totale : 0);

/** Crediti medi per ogni slot ancora da riempire. Con zero slot liberi non si
 *  divide: restano i crediti cosi' come sono. */
export const perSlot = (crediti, slot) => it(slot > 0 ? crediti / slot : crediti);

/** Come cambierebbe la situazione se chiudessi a questo prezzo. Si ricalcola a
 *  ogni tasto, non alla conferma: serve a decidere se rilanciare, e dopo
 *  sarebbe inutile. Ritorna null se non c'e' un prezzo valido da proiettare. */
export function proiezionePrezzo(rosa, prezzo) {
  if (prezzo === '' || prezzo === null || prezzo === undefined) return null;
  const p = Number(prezzo);
  if (!Number.isFinite(p) || p < 0) return null;
  const residuoDopo = rosa.residuo - p;
  const slotDopo = Math.max(0, rosa.slotLiberi - 1);
  return {
    prezzo: p,
    quotaBudget: percentuale(p, rosa.budget),
    residuoDopo,
    residuoDopoPct: percentuale(residuoDopo, rosa.budget),
    slotDopo,
    perSlotDopo: perSlot(residuoDopo, slotDopo),
    /** Oltre il massimo sostenibile la rosa non si chiude piu' a un credito
     *  per slot: e' la soglia che fa diventare rossi i numeri. */
    oltre: p > rosa.massimoSostenibile,
  };
}
