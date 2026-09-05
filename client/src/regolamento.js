/** Il regolamento della lega, in forma di dato.
 *
 *  Sta qui e non in una pagina perche' non serve solo a essere letto: le
 *  sezioni 3, 4 e 8 producono i controlli che l'asta usa davvero. Testo e
 *  regole nello stesso posto vuol dire che non possono divergere.
 *
 *  Composizione della rosa e budget NON sono scritti qui: arrivano dalla
 *  configurazione della lega. Nel PDF quella tabella aveva i trattini - i
 *  numeri non erano leggibili nel file originale - e comunque un valore
 *  copiato a mano si sarebbe scollato dalla config al primo ritocco. */

// ---------------------------------------------------------------- sezione 4
export const MODULI = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1'];

/** Quanti difensori ammettono i moduli: si contano, non si scrivono. Se un
 *  giorno la lista dei moduli cambia, il minimo e il massimo la seguono. */
export const difensoriAmmessi = (moduli = MODULI) => {
  const n = moduli.map((m) => Number(m.split('-')[0]));
  return { min: Math.min(...n), max: Math.max(...n) };
};

// ---------------------------------------------------------------- sezione 8
export const MIN_DIFENSORI_MODIFICATORE = 4;

/** Le fasce del modificatore di difesa, dalla piu' alta alla piu' bassa: si
 *  scorre e vince la prima che accoglie il voto. */
export const FASCE_MODIFICATORE = [
  { da: 7, etichetta: 'MV ≥ 7', punti: 6 },
  { da: 6.5, a: 7, etichetta: 'MV ≥ 6,5 e < 7', punti: 3 },
  { da: 6, a: 6.5, etichetta: 'MV ≥ 6 e < 6,5', punti: 1 },
  { da: 0, a: 6, etichetta: 'MV < 6', punti: 0 },
];

/** In quale fascia cade una media voto. Solo portieri e difensori: il
 *  modificatore si calcola sul portiere e sui tre migliori difensori, gli
 *  altri ruoli non ci entrano e mostrarglielo sarebbe fuorviante. */
export function fasciaModificatore(mv, ruolo) {
  if (ruolo !== 'P' && ruolo !== 'D') return null;
  if (mv === null || mv === undefined || !Number.isFinite(Number(mv))) return null;
  return FASCE_MODIFICATORE.find((f) => Number(mv) >= f.da) ?? null;
}

// ---------------------------------------------------------------- sezione 3
/** Uno slot di ruolo e' pieno quando i presi hanno riempito i posti che la
 *  configurazione prevede. Comprare oltre non e' vietato dall'applicazione -
 *  in asta si decide al volo - ma va detto, citando la regola. */
export const slotPieno = (rosa, ruolo) =>
  (rosa?.presiPerRuolo?.[ruolo] ?? 0) >= (rosa?.slot?.[ruolo] ?? 0);

export const avvisoSlotPieno = (rosa, ruolo, nomeRuolo) =>
  slotPieno(rosa, ruolo)
    ? `${nomeRuolo}: ${rosa.presiPerRuolo[ruolo]} su ${rosa.slot[ruolo]} slot gia' occupati. ` +
      'La composizione della rosa (sezione 3) non ne prevede altri.'
    : null;

/** Meno di quattro difensori vuol dire modificatore mai attivo, qualunque
 *  formazione si schieri. E' un promemoria da asta, non un errore. */
export function promemoriaDifensori(rosa) {
  const presi = rosa?.presiPerRuolo?.D ?? 0;
  if (presi >= MIN_DIFENSORI_MODIFICATORE) return null;
  return {
    presi,
    mancanti: MIN_DIFENSORI_MODIFICATORE - presi,
    testo:
      `${presi} difensori in rosa. Il modificatore di difesa (sezione 8) si attiva solo schierandone ` +
      `almeno ${MIN_DIFENSORI_MODIFICATORE}.`,
  };
}

// ------------------------------------------------------------------ il testo
/** Le undici sezioni, come stanno nel regolamento. Non riassunte: dove il
 *  documento originale aveva un buco - la composizione della rosa, gli importi
 *  dei premi - il buco e' dichiarato, non riempito a occhio. */
export function sezioniRegolamento({ rosa } = {}) {
  const slot = rosa?.slot ?? {};
  const budget = rosa?.budget ?? null;
  const totaleSlot = ['P', 'D', 'C', 'A'].reduce((s, r) => s + (slot[r] ?? 0), 0);
  const dif = difensoriAmmessi();

  return [
    {
      n: 1,
      titolo: 'Impostazione della competizione',
      voci: [
        ['Modalità competizione', 'Classic'],
        ['Numero squadre', '10'],
        ['Fonte voti', 'Redazione Fantacalcio'],
        // Dalla config: e' lo stesso budget con cui l'asta fa i conti.
        ['Totale crediti per asta', budget === null ? null : String(budget), 'config'],
        ['Scambi', 'Consentiti'],
      ],
    },
    {
      n: 2,
      titolo: 'Asta iniziale e asta di riparazione',
      paragrafi: [
        "Asta iniziale: verrà effettuata in modalità Online sul Tool di FantaLab prima dell'inizio delle competizioni. La modalità d'asta sarà a chiamata per ordine di ruolo.",
        'Asta di riparazione: fine mercato invernale (data da definire).',
      ],
      voci: [
        ['Numero svincoli', 'Illimitato'],
        ['Crediti aggiuntivi', '50'],
        ['Crediti svincolo', 'min (V.Acq, FVMp 500)'],
        ['Ordine svincoli', '1° – 10°'],
        ['Ordine chiamate', '10° – 1°'],
      ],
    },
    {
      n: 3,
      titolo: 'Composizione della rosa',
      voci: [
        ['Portieri', slot.P == null ? null : String(slot.P), 'config'],
        ['Difensori', slot.D == null ? null : String(slot.D), 'config'],
        ['Centrocampisti', slot.C == null ? null : String(slot.C), 'config'],
        ['Attaccanti', slot.A == null ? null : String(slot.A), 'config'],
        ['Totale', totaleSlot ? String(totaleSlot) : null, 'config'],
      ],
      nota:
        'Nel PDF questi numeri erano illeggibili. Qui arrivano dalla configurazione della lega: ' +
        "sono gli stessi slot con cui l'asta conta i posti liberi.",
    },
    {
      n: 4,
      titolo: 'Formazioni e sostituzioni',
      voci: [
        ['Moduli consentiti', MODULI.join(' | ')],
        ['Difensori schierabili', `da ${dif.min} a ${dif.max}`],
        ['Numero sostituzioni', '5'],
        ['Cambio modulo', 'No'],
      ],
      paragrafi: [
        'Mancato inserimento formazione: verrà recuperata la formazione della settimana precedente.',
      ],
    },
    {
      n: 5,
      titolo: 'Partite sospese o rinviate',
      paragrafi: [
        'Qualora vengano rinviate tre o più partite, si attenderà il recupero e il completamento delle gare prima di procedere al calcolo della giornata.',
        'Qualora invece vengano rinviate una o due partite, la giornata verrà regolarmente completata assegnando il 6 politico ai giocatori di movimento e il 5 politico ai portieri appartenenti alle squadre coinvolte nelle partite rinviate.',
      ],
    },
    {
      n: 6,
      titolo: 'Soglie gol',
      paragrafi: ['Verrà attribuito un gol ogni 4 punti, con fasce che partono da 66 punti a salire.'],
      tabella: {
        intestazione: ['Punti', '66', '70', '74', '78', '82', '86'],
        righe: [['Gol', '1', '2', '3', '4', '5', '6']],
      },
    },
    {
      n: 7,
      titolo: 'Bonus e malus',
      paragrafi: ['Validi in tutte le competizioni della lega.'],
      tabella: {
        intestazione: ['Evento', 'Punti'],
        righe: [
          ['Gol (compresi i rigori)', '+3'],
          ['Rigore parato', '+3'],
          ['Assist', '+1'],
          ['Bonus clean sheet', '+1'],
          ['Gol subito', '−1'],
          ['Rigore sbagliato', '−3'],
          ['Espulsione', '−1'],
          ['Ammonizione', '−0,5'],
          ['Autogol', '−2'],
        ],
      },
    },
    {
      n: 8,
      titolo: 'Modificatore di difesa',
      paragrafi: [
        `Si attiva schierando almeno ${MIN_DIFENSORI_MODIFICATORE} difensori. Il calcolo avviene sul voto (senza bonus e malus) e coinvolge sempre il portiere e i 3 migliori difensori schierati.`,
      ],
      tabella: {
        intestazione: ['Media voto (MV)', 'Modificatore'],
        righe: FASCE_MODIFICATORE.map((f) => [f.etichetta, `${f.punti} pt`]),
      },
    },
    {
      n: 9,
      titolo: 'Scambi',
      elenco: [
        'Gli scambi tra le squadre sono consentiti per tutta la durata del campionato, ad eccezione delle ultime 5 giornate.',
        'Ogni squadra potrà effettuare un massimo di 5 scambi di giocatori nel corso della stagione.',
        'Un giocatore, una volta ceduto tramite scambio, non potrà più essere riacquistato dalla squadra di provenienza originaria nel corso della stagione, né essere scambiato nuovamente con la squadra di provenienza.',
        "Affinché uno scambio sia valido ed effettivo per la giornata successiva, dovrà essere annunciato almeno 48 ore prima dell'inizio della giornata di campionato.",
        'Tutti gli scambi dovranno essere comunicati e notificati a tutti i partecipanti tramite la chat WhatsApp ufficiale della lega.',
      ],
    },
    {
      n: 10,
      titolo: 'Competizioni',
      paragrafi: [
        'Nella lega saranno presenti 2 competizioni.',
        'Campionato: campionato tradizionale a scontri diretti.',
        'Formula 1 / Gran Premio: classifica basata sul modello della Formula 1. Ad ogni piazzamento di giornata vengono assegnati dei punti.',
      ],
      tabella: {
        intestazione: ['Piazzamento', '1°', '2°', '3°', '4°', '5°', '6°', '7°'],
        righe: [['Punti giornata', '25', '18', '12', '10', '8', '4', '2']],
      },
      nota:
        "Nel file di origine i punti giornata sono 25, 18, 12, 10, 8, 4, 2; l'abbinamento esatto ai piazzamenti va confermato sul regolamento originale.",
    },
    {
      n: 11,
      titolo: 'Premi',
      paragrafi: [
        'Per le 2 competizioni saranno attribuiti premi distribuiti per posizione, dal 1° al 10° posto, sia per il Campionato sia per la Formula 1 / Gran Premio.',
      ],
      nota: 'Gli importi non erano leggibili nel file di origine.',
    },
  ];
}
