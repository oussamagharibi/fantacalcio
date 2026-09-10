/** Le regole delle foto, senza browser dentro.
 *
 *  Sta separato dal componente e dal canvas di proposito: quanto costa un
 *  invio, quante immagini si accettano e quali si rifiutano sono decisioni che
 *  si possono sbagliare in silenzio, e qui si possono provare senza un DOM. */

/** Le stesse due costanti del server (server/lib/immagini.js). Sono duplicate
 *  perche' servono PRIMA di parlare col server - la stima si mostra mentre si
 *  scelgono i file - e il server le ricontrolla comunque su quello che riceve:
 *  qui decidono cosa mandare, la' cosa accettare. */
export const LATO_MASSIMO = 1568;
export const MAX_FOTO = 20;

export const TIPI_AMMESSI = ['image/jpeg', 'image/png', 'image/webp'];
export const ESTENSIONI = 'jpg, png, webp';

/** Un'immagine costa larghezza per altezza diviso 750. Una schermata di
 *  telefono ridotta a 1568 sul lato lungo sta intorno ai 1.500 token: e' il
 *  numero da cui e' partita la richiesta, e viene da questa formula, non da
 *  una costante scritta a mano. */
export const tokenImmagine = (larghezza, altezza) => {
  if (!larghezza || !altezza) return 0;
  const d = nuoveDimensioni(larghezza, altezza);
  return Math.ceil((d.larghezza * d.altezza) / 750);
};

/** Quanto diventa grande dopo il ridimensionamento. Sotto la soglia non si
 *  tocca: ingrandire aggiungerebbe token senza aggiungere informazione. */
export function nuoveDimensioni(larghezza, altezza, lato = LATO_MASSIMO) {
  const lungo = Math.max(larghezza, altezza);
  if (!lungo || lungo <= lato) return { larghezza, altezza, ridimensionata: false };
  const scala = lato / lungo;
  return {
    larghezza: Math.max(1, Math.round(larghezza * scala)),
    altezza: Math.max(1, Math.round(altezza * scala)),
    ridimensionata: true,
  };
}

/** Quali file entrano e quali no, dato quello che c'e' gia'.
 *
 *  Rifiutare in silenzio e' il modo peggiore di rispettare un limite: chi ha
 *  selezionato venticinque foto deve vedere quali cinque sono rimaste fuori e
 *  perche', non ritrovarsene venti senza spiegazione. */
export function accetta(gia, files, massimo = MAX_FOTO) {
  const accettate = [];
  const rifiutate = [];
  let spazio = Math.max(0, massimo - gia.length);
  for (const f of files) {
    if (!TIPI_AMMESSI.includes(f.type)) {
      rifiutate.push({ nome: f.name, motivo: `formato non ammesso (${f.type || 'sconosciuto'}): servono ${ESTENSIONI}` });
      continue;
    }
    if (gia.some((g) => g.nome === f.name && g.byteOriginali === f.size)) {
      rifiutate.push({ nome: f.name, motivo: "gia' caricata" });
      continue;
    }
    if (spazio === 0) {
      rifiutate.push({ nome: f.name, motivo: `oltre il limite di ${massimo} immagini` });
      continue;
    }
    spazio--;
    accettate.push(f);
  }
  return { accettate, rifiutate };
}

/** Il preventivo, dichiarato come stima e non come prezzo.
 *
 *  L'input e' misurabile prima: le immagini si contano dai pixel, il testo
 *  dalla rosa. L'output no - dipende da quanto scrive il modello - e quel
 *  pezzo resta un'ipotesi, per questo si tiene separato nel risultato. */
export const TOKEN_TESTO_BASE = 400;
export const TOKEN_PER_GIOCATORE = 12;
export const TOKEN_OUTPUT_PER_GIOCATORE = 40;
export const TOKEN_OUTPUT_RIASSUNTO = 300;

export function stima(foto, quantiGiocatori, prezzo = null) {
  const tokenFoto = foto.reduce((a, f) => a + tokenImmagine(f.larghezza, f.altezza), 0);
  const tokenTesto = TOKEN_TESTO_BASE + quantiGiocatori * TOKEN_PER_GIOCATORE;
  const input = tokenFoto + tokenTesto;
  const output = quantiGiocatori * TOKEN_OUTPUT_PER_GIOCATORE + TOKEN_OUTPUT_RIASSUNTO;
  return {
    immagini: foto.length,
    tokenFoto,
    tokenTesto,
    tokenInput: input,
    tokenOutput: output,
    dollari: prezzo ? (input / 1e6) * prezzo.input + (output / 1e6) * prezzo.output : null,
  };
}

/** Le tariffe le sa il server e le serve /api/consumo: qui si prende quella
 *  del modello in uso invece di riscriverla, cosi' la stima e il conto non
 *  possono divergere. null quando non si sa: allora non si stima. */
export const prezzoDi = (tariffe, modello) => tariffe?.find((t) => t.modello === modello) ?? null;

export const STATI = {
  titolare: { etichetta: 'titolare', classe: 'ok' },
  ballottaggio: { etichetta: 'in ballottaggio', classe: 'forse' },
  panchina: { etichetta: 'in panchina', classe: 'no' },
  'non-compare': { etichetta: 'non compare', classe: 'assente' },
};

/** Le voci che vale la pena guardare per prime: chi compare nelle immagini,
 *  e fra questi chi porta qualcosa di confermabile. Chi non compare non
 *  sparisce - era una richiesta esplicita, "dillo invece di dedurlo" - ma sta
 *  in fondo, sotto la sua riga. */
export function ordina(voci) {
  const peso = (v) => (v.stato === 'non-compare' ? 3 : v.segnale ? 0 : v.nota ? 1 : 2);
  return [...voci].sort((a, b) => peso(a) - peso(b) || (a.nome ?? '').localeCompare(b.nome ?? '', 'it'));
}

export const nonCompaiono = (voci) => voci.filter((v) => v.stato === 'non-compare');
export const compaiono = (voci) => voci.filter((v) => v.stato !== 'non-compare');

/** Una voce e' gia' stata presa se in segnali c'e' la stessa coppia
 *  (giocatore, tipo) firmata dalle foto. Il testo puo' essere cambiato - una
 *  conferma nuova sovrascrive la vecchia - e non fa parte del confronto. */
export const gia = (confermati, voce) =>
  !!voce.segnale && confermati.some((c) => c.player_id === voce.player_id && c.tipo === voce.segnale.tipo);
