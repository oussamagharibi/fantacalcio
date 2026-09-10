/** Come si scrivono token e costi a schermo.
 *
 *  Sta fuori dai componenti perche' le stesse due regole valgono nel pannello
 *  dell'asta e nella sezione Dati, e perche' la seconda e' facile da sbagliare
 *  in silenzio: un costo che non c'e' non e' zero. */

export const ETICHETTE_TIPO = {
  // Il consulente in asta non c'e' piu'. L'etichetta resta perche' in
  // archivio possono esserci ancora le sue righe, e una riga senza nome
  // diventa un costo di cui non si sa piu' la provenienza.
  consulente: 'Consulente in asta (rimosso)',
  note: 'Note AI',
  foto: 'Analisi da foto',
};

export const token = (n) => Number(n ?? 0).toLocaleString('it-IT');

/** Quattro decimali: una singola domanda costa due centesimi, e con due
 *  decimali sarebbero tutte "$0,02". */
export const dollari = (x) => `$${Number(x ?? 0).toFixed(4)}`;

/** Un costo assente non e' un costo di zero: e' un modello fuori tariffario.
 *  Scriverlo "$0,0000" farebbe credere che quelle chiamate siano state gratis. */
export function costo(riga) {
  if (!riga || riga.chiamate === 0) return '—';
  if (riga.senzaCosto > 0 && riga.costo === null) return 'non calcolabile';
  const base = dollari(riga.costo);
  return riga.senzaCosto > 0 ? `${base} + ${riga.senzaCosto} senza tariffa` : base;
}

/** La somma di piu' righe, tenendo separato quello che non si puo' sommare. */
export function somma(righe = []) {
  return righe.reduce(
    (a, r) => ({
      chiamate: a.chiamate + (r.chiamate ?? 0),
      input: a.input + (r.input ?? 0),
      output: a.output + (r.output ?? 0),
      costo: a.costo + (r.costo ?? 0),
      senzaCosto: a.senzaCosto + (r.senzaCosto ?? 0),
    }),
    { chiamate: 0, input: 0, output: 0, costo: 0, senzaCosto: 0 }
  );
}
