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
