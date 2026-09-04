/** Sezioni e punteggio della pagina dettaglio.
 *
 *  Sta fuori dal componente per due ragioni. La prima e' che una formula si
 *  prova da sola. La seconda e' che l'espandibile "come si calcola" deve
 *  leggere gli STESSI passi che producono il numero: se fossero due elenchi
 *  separati divergerebbero al primo ritocco, e la spiegazione mentirebbe. */

export const SCALA_FM = { min: 5.5, max: 8 };
/** Per gli xG la scala e' scelta qui, non deriva da niente: 0.05 xG ogni 90
 *  minuti e' un centrocampista che non tira, 0.55 e' un attaccante da doppia
 *  cifra. E' una stima piu' debole della fantamedia e va detto a chi legge. */
export const SCALA_XG90 = { min: 0.05, max: 0.55 };

const fra = (x, a, b) => Math.max(a, Math.min(b, x));
export const arrotonda = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** 1 stella al minimo della scala, 5 al massimo, lineare in mezzo. */
export const scala = (v, { min, max }) => fra(1 + ((v - min) * 4) / (max - min), 1, 5);

// -------------------------------------------------------------------- segnali

export const segnale = (g, tipo) => (g?.segnali ?? []).find((s) => s.tipo === tipo) ?? null;

export function titolarita(g) {
  const s = segnale(g, 'titolarita');
  if (!s) return null;
  const m = /(\d+)\s*%/.exec(s.testo ?? '');
  if (!m) return null;
  return { percentuale: Number(m[1]), titolare: /^titolare/i.test(s.testo), testo: s.testo };
}

export function rigorista(g) {
  const s = segnale(g, 'rigorista');
  if (!s) return null;
  const m = /#(\d+)/.exec(s.testo ?? '');
  return { ordine: m ? Number(m[1]) : null, testo: s.testo };
}

export const infortunio = (g) => segnale(g, 'infortunio');

/** I testi dei segnali arrivano da pagine web e portano ancora le entita'
 *  HTML ("meta&agrave;"). Si sciolgono qui, a mano e su un elenco chiuso:
 *  darli a innerHTML per farli sciogliere al browser vorrebbe dire iniettare
 *  in pagina del markup raccolto altrove. */
const ENTITA = {
  agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò',
  ugrave: 'ù', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};
export const sciogliEntita = (s) =>
  String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (t, n) => ENTITA[n.toLowerCase()] ?? t);

// ------------------------------------------------------- attendibilita' dei xG

/** Una riga che dichiara partite giocate e zero minuti viene da un file che la
 *  colonna dei minuti non ce l'aveva: quello zero non e' un dato, e' un buco.
 *  Mostrarlo sarebbe uno "zero finto", che e' esattamente quello che questa
 *  pagina non deve fare. */
export function minutiVeri(r) {
  if (!r || r.minuti === null || r.minuti === undefined) return null;
  if (r.minuti === 0 && (r.partite ?? 0) > 0) return null;
  return r.minuti > 0 ? r.minuti : null;
}

/** Gli altri contatori facoltativi seguono la stessa sorte: se i minuti sono
 *  palesemente assenti, uno zero in assist o npg viene dallo stesso buco. */
export function contatoreVero(r, campo) {
  const v = r?.[campo];
  if (v === null || v === undefined) return null;
  if (v === 0 && minutiVeri(r) === null) return null;
  return v;
}

export const xgPer90 = (r) => {
  const m = minutiVeri(r);
  return m && r.xg !== null && r.xg !== undefined ? (r.xg * 90) / m : null;
};

// ------------------------------------------------------------------- sezioni

export const fantamedie = (g) => (g?.stats ?? []).filter((s) => s.fm !== null && s.fm !== undefined);
export const stagioniXg = (g) => (g?.xgStagioni ?? []).filter((r) => r.gol !== null || r.xg !== null);

/** Rigori dallo storico fanta, sommati sulle stagioni che ne hanno.
 *  La percentuale si calcola qui e non si salva: deriva da due colonne della
 *  stessa riga, e una percentuale in archivio prima o poi resta indietro
 *  rispetto ai numeri da cui viene.
 *  Zero tirati non e' "0%": e' nessun rigore, e non si mostra affatto. */
export function rigoriFanta(g) {
  const righe = (g?.stats ?? []).filter((r) => (r.rig_tirati ?? 0) > 0);
  if (!righe.length) return null;
  const segnati = righe.reduce((s, r) => s + (r.rig_segnati ?? 0), 0);
  const tirati = righe.reduce((s, r) => s + r.rig_tirati, 0);
  return {
    segnati,
    tirati,
    sbagliati: tirati - segnati,
    percentuale: arrotonda((100 * segnati) / tirati, 1),
    stagioni: righe.map((r) => r.stagione),
  };
}

/** Il rendimento di un portiere non si legge negli expected goals: un portiere
 *  non si costruisce occasioni, e il suo xG e' zero anche nella stagione in cui
 *  para tutto. Si legge in quanti gol prende ogni volta che scende in campo.
 *
 *  gs/pv per stagione, e sul totale la media pesata sulle partite: fare la
 *  media delle medie darebbe lo stesso peso a una stagione da 3 presenze e a
 *  una da 38.
 *
 *  Serve pv > 0, altrimenti non e' una media ma una divisione per zero: senza
 *  presenze la sezione non si mostra affatto. */
export function golSubiti(g) {
  if (g?.ruolo !== 'P') return null;
  const righe = (g?.stats ?? []).filter((r) => (r.pv ?? 0) > 0 && r.gs !== null && r.gs !== undefined);
  if (!righe.length) return null;
  const pv = righe.reduce((s, r) => s + r.pv, 0);
  const gs = righe.reduce((s, r) => s + r.gs, 0);
  return {
    stagioni: righe.map((r) => ({ stagione: r.stagione, pv: r.pv, gs: r.gs, media: arrotonda(r.gs / r.pv, 2) })),
    pv,
    gs,
    media: arrotonda(gs / pv, 2),
  };
}

const nucleo = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** La squadra del listone contro quella dell'ultima stagione di carriera.
 *  Serve a vedere a colpo d'occhio chi si e' mosso a mercato: il rendimento
 *  passato l'ha fatto altrove, con altri compagni e un altro ruolo in campo.
 *  Il confronto e' largo di proposito - "Inter" contro "Internazionale" - e in
 *  caso di dubbio NON segnala: un falso cambio di squadra e' peggio di un
 *  cambio non segnalato. */
const stessaSquadra = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

export function cambioSquadra(g) {
  const righe = (g?.carriera ?? []).filter((r) => r.squadra && r.stagione);
  if (!righe.length || !g?.squadra) return null;
  const anno = (r) => Number(String(r.stagione).slice(-4)) || 0;
  /** Si guardano TUTTE le righe dell'ultimo anno, non una sola. Dentro lo
   *  stesso anno l'ordine fra le etichette e' alfabetico e non cronologico
   *  ("ago.2026" prima di "lug.-ago.2026"), quindi prenderne una a caso
   *  significa a volte prendere il club sbagliato: e' cosi' che Beto, che nel
   *  2026 ha righe sia all'Everton sia alla Fiorentina, risultava trasferito
   *  mentre e' proprio dove il listone lo mette.
   *  Se una qualsiasi delle righe recenti nomina la squadra attuale, non c'e'
   *  niente da segnalare: nel dubbio si tace, un falso cambio e' peggio di un
   *  cambio non detto. */
  const ultimoAnno = Math.max(...righe.map(anno));
  const recenti = righe.filter((r) => anno(r) === ultimoAnno);
  const attuale = nucleo(g.squadra);
  if (!attuale || recenti.some((r) => stessaSquadra(attuale, nucleo(r.squadra))))
    return { attuale: g.squadra, precedente: null, stagione: null, cambiata: false };

  // Fra le righe recenti vince quella con piu' presenze: e' il club dove ha
  // davvero giocato, non una comparsata in coppa.
  const principale = recenti.reduce((a, b) => ((b.presenze ?? 0) > (a.presenze ?? 0) ? b : a));
  return {
    attuale: g.squadra,
    precedente: principale.squadra,
    stagione: principale.stagione,
    cambiata: true,
  };
}

/** Quali blocchi hanno qualcosa da dire. Una sezione senza dato non si mostra:
 *  niente riquadri di trattini. */
export function sezioni(g) {
  return {
    listone: true,
    storicoFanta: fantamedie(g).length > 0,
    xg: stagioniXg(g).length > 0,
    rigorista: !!rigorista(g),
    titolarita: !!titolarita(g),
    infortunio: !!infortunio(g),
    carriera: (g?.carriera ?? []).length > 0,
    golSubiti: !!golSubiti(g),
    rigori: !!rigoriFanta(g),
    cambioSquadra: !!cambioSquadra(g)?.cambiata,
    nota: !!g?.note,
  };
}

// -------------------------------------------------------------------- stelle

export const MOTIVO_INSUFFICIENTE = 'dati insufficienti per un punteggio';
export const SPIEGAZIONE_PORTIERE =
  "per un portiere gli xG non dicono niente: misurano le occasioni che uno si costruisce, non le parate. " +
  'Le stelle di un portiere si accendono solo con almeno una stagione di fantamedia (npm run import-stats)';
export const SPIEGAZIONE_GENERICA =
  'serve almeno la fantamedia storica (npm run import-stats) oppure gli xG con i minuti giocati (npm run xg)';

const insufficiente = (spiegazione) => ({
  disponibile: false,
  motivo: MOTIVO_INSUFFICIENTE,
  spiegazione,
  passi: [],
  totale: null,
  base: null,
});

/** Il punteggio, con la lista dei passi che lo compongono. Il totale non e'
 *  calcolato a parte: e' la somma dei delta dei passi, troncata fra 1 e 5.
 *  Cosi' quello che si legge nell'espandibile E' il conto. */
export function stelle(g) {
  const fm = fantamedie(g);
  const ultimo = stagioniXg(g).at(-1) ?? null;
  const passi = [];
  let base = null;
  let debole = false;

  if (fm.length) {
    const media = fm.reduce((s, x) => s + x.fm, 0) / fm.length;
    const v = scala(media, SCALA_FM);
    base = { tipo: 'fantamedia', valore: arrotonda(media, 2), stagioni: fm.map((x) => x.stagione) };
    passi.push({
      voce: 'base: fantamedia media',
      dettaglio: `${arrotonda(media, 2)} su ${fm.length} ${fm.length === 1 ? 'stagione' : 'stagioni'} (${fm.map((x) => x.stagione).join(', ')}), scalata da ${SCALA_FM.min} = 1 stella a ${SCALA_FM.max} = 5 stelle`,
      delta: arrotonda(v, 2),
    });
  } else if (g?.ruolo === 'P') {
    /** Un portiere non si costruisce occasioni: il suo xG e' zero o quasi anche
     *  nella stagione in cui para tutto. Scalarlo darebbe una stella scarsa a
     *  chiunque stia fra i pali, che e' un numero peggiore di nessun numero.
     *  Per i portieri l'unica base onesta e' la fantamedia. */
    return insufficiente(SPIEGAZIONE_PORTIERE);
  } else {
    const per90 = xgPer90(ultimo);
    if (per90 === null) return insufficiente(SPIEGAZIONE_GENERICA);
    const v = scala(per90, SCALA_XG90);
    debole = true;
    base = { tipo: 'xg', valore: arrotonda(per90, 2), stagioni: [ultimo.stagione] };
    passi.push({
      voce: 'base: xG ogni 90 minuti',
      dettaglio: `${arrotonda(per90, 2)} nel ${ultimo.stagione}, scalato da ${SCALA_XG90.min} = 1 stella a ${SCALA_XG90.max} = 5 stelle. Stima piu' debole della fantamedia: dice quante occasioni si costruisce, non quanto ha reso al fantacalcio`,
      delta: arrotonda(v, 2),
    });
  }

  const scarto = ultimo?.scarto_xg;
  if (scarto !== null && scarto !== undefined && scarto <= -1)
    passi.push({
      voce: 'sottoperforma gli xG',
      dettaglio: `scarto ${arrotonda(scarto, 2)} nel ${ultimo.stagione}: ha segnato meno di quanto valevano le occasioni, statisticamente e' atteso in crescita`,
      delta: 0.5,
    });

  const rig = rigorista(g);
  if (rig)
    passi.push({
      voce: 'rigorista',
      dettaglio: rig.ordine ? `${rig.testo}: bonus quasi garantiti` : rig.testo,
      delta: 0.5,
    });

  const tit = titolarita(g);
  if (tit && tit.percentuale >= 70)
    passi.push({
      voce: 'titolare fisso',
      dettaglio: `${tit.percentuale}% di impiego stimato, sopra la soglia del 70%`,
      delta: 0.3,
    });

  const inf = infortunio(g);
  if (inf) passi.push({ voce: 'infortunio in corso', dettaglio: inf.testo, delta: -1 });

  const grezzo = passi.reduce((s, p) => s + p.delta, 0);
  const totale = arrotonda(fra(grezzo, 1, 5), 1);
  return { disponibile: true, motivo: null, passi, grezzo: arrotonda(grezzo, 2), totale, base, debole };
}
