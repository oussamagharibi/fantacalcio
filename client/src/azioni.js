import { getStato, postAcquisto, postAnnulla, postTarget, postUscita } from './api.js';

/** Lo stato di un giocatore nell'asta e le tre azioni che lo cambiano, in un
 *  posto solo.
 *
 *  Serviva gia' alla pagina Situazione; ora che le stesse azioni compaiono in
 *  Analisi, Listone e nella scheda, la definizione non puo' piu' stare dentro
 *  una pagina. Quattro schermate che scrivono le stesse righe in quattro modi
 *  sarebbero quattro modi di sbagliare. */

/** Tre stati, non uno di piu'.
 *  "Uscito" non porta prezzo ne' squadra perche' l'applicazione non li
 *  registra: quando un giocatore va a un altro partecipante si preme un tasto
 *  solo. Un acquisto che non risulta nella mia rosa e' comunque fuori
 *  dall'asta, e vale "uscito": e' esattamente quello che se ne sa. */
export function statoGiocatore(g, presi = []) {
  const mio = presi.find((p) => p.player_id === g?.id);
  if (mio) return { stato: 'me', prezzo: mio.prezzo };
  if (g?.uscito || g?.acquistato) return { stato: 'uscito', prezzo: null };
  return { stato: 'disponibile', prezzo: null };
}

export const STATI = [
  { chiave: 'disponibile', etichetta: 'Disponibile' },
  { chiave: 'me', etichetta: 'Preso da me' },
  { chiave: 'uscito', etichetta: 'Uscito' },
];

/** Le tre azioni. Chiamano gli endpoint dell'asta e restituiscono lo stato
 *  aggiornato che il server rimanda indietro: chi chiama lo rimette in circolo
 *  e la pagina si aggiorna senza ricaricare.
 *  Sta qui e non dentro il componente perche' anche il rilascio del
 *  trascinamento, in Situazione, deve poter registrare un'uscita: due copie
 *  della stessa chiamata erano gia' una di troppo. */
export async function eseguiAzione({ tipo, g, prezzo }) {
  if (tipo === 'acquisto') {
    const n = Number(prezzo);
    if (prezzo === '' || prezzo === null || !Number.isInteger(n) || n < 0) throw new Error('prezzo non valido');
    return { stato: await postAcquisto(g.id, n), messaggio: `${g.nome} preso a ${n}` };
  }
  if (tipo === 'uscita') return { stato: await postUscita(g.id), messaggio: `${g.nome} preso da altri` };
  const risposta = await postAnnulla(g.id);
  const a = risposta.annullata;
  return {
    stato: risposta,
    messaggio:
      a.tipo === 'acquisto'
        ? `annullato: ${a.nome} a ${a.prezzo}, torna disponibile`
        : `annullato: ${a.nome} torna disponibile`,
  };
}

/** Marca o smarca un obiettivo. Sta qui accanto alle altre azioni perche' la
 *  stella ora si preme da quattro schermate diverse.
 *  L'endpoint risponde solo con il nuovo valore della stella, non con lo stato
 *  completo come fanno acquisto e uscita: per aggiornare le altre pagine senza
 *  ricaricare serve rileggere lo stato, e quel giro sta qui una volta sola. */
export async function commutaObiettivo(g) {
  const r = await postTarget(g.id);
  return {
    stato: await getStato(),
    messaggio: r.target ? `${g.nome} segnato come obiettivo` : `${g.nome} non e' piu' un obiettivo`,
  };
}
