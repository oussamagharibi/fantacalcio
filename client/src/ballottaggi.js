/** Chi e' in ballottaggio con chi, dal punto di vista di un giocatore.
 *
 *  Sta fuori dal componente perche' e' la parte che vale la pena provare da
 *  sola: la riga va letta dalla parte giusta - il mio giocatore a sinistra con
 *  la SUA percentuale, l'altro a destra con la SUA - e sbagliare verso vuol
 *  dire mostrare a chi guarda il numero di un altro. */

/** Le voci che riguardano questo giocatore, girate perche' sia sempre lui il
 *  primo. Il sito mette in prima posizione chi ritiene titolare; qui l'ordine
 *  che conta e' un altro: prima chi sto guardando. */
export function perGiocatore(ballottaggi, playerId) {
  const righe = [];
  for (const b of ballottaggi ?? []) {
    if (b.uno.id === playerId) righe.push({ ...b, io: b.uno, altro: b.due, favorito: true });
    else if (b.due.id === playerId) righe.push({ ...b, io: b.due, altro: b.uno, favorito: false });
  }
  return righe;
}

/** Tutti i ballottaggi che toccano la mia rosa, uno per riga.
 *  Se due miei giocatori fossero in ballottaggio fra loro la voce comparirebbe
 *  due volte, una per parte: e' giusto cosi', sono due righe che mi riguardano
 *  da due lati diversi. */
export function perRosa(ballottaggi, presi) {
  const miei = new Set((presi ?? []).map((p) => p.player_id));
  const righe = [];
  for (const id of miei) righe.push(...perGiocatore(ballottaggi, id));
  return righe.sort((a, b) => a.io.nome.localeCompare(b.io.nome, 'it'));
}

/** Come si scrive una percentuale che puo' non esserci. Un dato mancante non
 *  e' uno zero e non e' "100 meno l'altro": e' un trattino. */
export const scriviPercentuale = (p) => (typeof p === 'number' ? `${p}%` : '-');

/** Le due percentuali sono indipendenti: vengono ognuna dalla riga del suo
 *  giocatore nella lista titolari, non dalla stessa torta. Quando non fanno
 *  100 non c'e' niente da correggere, e conviene dirlo invece di lasciare
 *  pensare a un errore. */
export const sommaStrana = (b) =>
  typeof b?.io?.percentuale === 'number' &&
  typeof b?.altro?.percentuale === 'number' &&
  b.io.percentuale + b.altro.percentuale !== 100;
