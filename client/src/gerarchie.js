/** Le gerarchie titolare/vice dichiarate da una fonte, dal punto di vista di
 *  un giocatore.
 *
 *  Sono una cosa diversa dalle alternative dedotte da squadra e ruolo: qui
 *  qualcuno ha scritto che X e' il vice di Y, e il modello lo ha letto li'.
 *  Percio' portano sempre con se' da dove vengono, quando, e quanto sono
 *  sicure - una riga a certezza "media" e' una deduzione dalla formazione, non
 *  una dichiarazione, e chi guarda deve poterlo sapere. */

/** Quelle che si mostrano in asta: certezza alta o media. Le basse restano in
 *  archivio ma non entrano in una schermata dove si decide quanto spendere. */
export const CERTEZZE_MOSTRATE = ['alta', 'media'];

export const ETICHETTE_CERTEZZA = {
  alta: 'dichiarato dal testo',
  media: 'dedotto dalla formazione',
  bassa: 'incerto',
};

/** Le righe che riguardano questo giocatore, girate perche' sia sempre lui il
 *  primo. Se e' lui il titolare l'altro e' il suo vice; se e' lui l'alternativa
 *  l'altro e' il titolare davanti a cui sta. */
export function perGiocatore(gerarchie, playerId, certezze = CERTEZZE_MOSTRATE) {
  const righe = [];
  for (const g of gerarchie ?? []) {
    if (certezze && !certezze.includes(g.certezza)) continue;
    if (g.titolare.id === playerId) righe.push({ ...g, io: g.titolare, altro: g.alternativa, ruoloMio: 'titolare' });
    else if (g.alternativa.id === playerId) righe.push({ ...g, io: g.alternativa, altro: g.titolare, ruoloMio: 'alternativa' });
  }
  return righe;
}

/** Come si legge la riga. Il verso conta: "il suo vice e' X" e "sta dietro a X"
 *  sono due frasi diverse, e scambiarle direbbe il contrario. */
export const frase = (r) =>
  r.ruoloMio === 'titolare' ? 'il suo vice sarebbe' : 'sarebbe il vice di';
