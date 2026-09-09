import { MIN_DIFENSORI_MODIFICATORE } from './regolamento.js';
import { disponibile, RUOLI } from './squadra.js';
import { SQUADRE } from './squadre.js';

/** Cosa tenere, cosa mettere sul mercato, cosa lasciare andare.
 *
 *  Tutto quello che c'e' qui e' un giudizio RELATIVO alla mia rosa, non un
 *  valore assoluto: dire che un giocatore "vale 40 crediti" richiederebbe di
 *  sapere quanto lo pagherebbero gli altri, e non lo so. Dire che rende meno
 *  di quanto e' costato RISPETTO agli altri miei, quello si': i venticinque
 *  prezzi li ho pagati io lo stesso giorno con lo stesso budget.
 *
 *  E quando manca lo storico non si tira a indovinare. Sei dei miei
 *  venticinque sono al primo anno in Serie A: metterli in fondo perche' non
 *  hanno una fantamedia sarebbe punire un dato mancante come se fosse un dato
 *  brutto. */

const arrotonda = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const fra = (v, a, b) => Math.max(a, Math.min(b, v));
const articolo = (s) => { const d = SQUADRE[s]?.di ?? 'del'; return d.endsWith("'") ? d : d + ' '; };

/** Le scale su cui si normalizza il rendimento.
 *  Due, perche' i numeri sono diversi: una fantamedia da 8 e' eccezionale, una
 *  media voto da 8 non esiste. */
export const SCALA_FM = { min: 5.5, max: 8 };
export const SCALA_MV = { min: 5.5, max: 7 };

const normalizza = (v, s) => (typeof v === 'number' ? fra((v - s.min) / (s.max - s.min), 0, 1) : null);

/** Il rendimento atteso, fra 0 e 1.
 *
 *  Per portieri e difensori si guarda la MEDIA VOTO e non la fantamedia: il
 *  modificatore di difesa si calcola sulla MV, e li' un difensore da 6,8 di
 *  media vale piu' di uno che ha preso due gol di testa su corner.
 *  Per centrocampisti e attaccanti la fantamedia, che i bonus li incorpora
 *  gia' ed e' quello che porta a casa.
 *
 *  La titolarita' moltiplica: il miglior giocatore del mondo al 20% di impiego
 *  rende un quinto. Un infortunio in corso porta a zero, perche' domenica non
 *  gioca - e resta scritto perche', cosi' non sembra un giudizio sul giocatore. */
export function rendimento(g) {
  const usaMv = g.ruolo === 'P' || g.ruolo === 'D';
  const grezzo = usaMv ? g.mv : g.fm;
  const base = normalizza(grezzo, usaMv ? SCALA_MV : SCALA_FM);
  const tit = g.titolarita;

  if (!disponibile(g))
    return { valore: 0, base, fonte: usaMv ? 'mv' : 'fm', motivo: 'indisponibile: domenica non gioca', completo: base !== null };
  if (base === null)
    return {
      valore: null,
      base: null,
      fonte: 'nessuna',
      // Non e' zero: e' un dato che non ho. La differenza conta, perche' zero
      // vorrebbe dire "non rende" e questo vuol dire "non lo so".
      motivo: `nessuno storico in archivio: giudicabile solo sulla titolarita'${tit === null ? ', che pero\' manca anche lei' : ` (${tit}%)`}`,
      completo: false,
      soloTitolarita: tit === null ? null : arrotonda(tit / 100),
    };
  if (tit === null)
    return { valore: null, base, fonte: usaMv ? 'mv' : 'fm', motivo: 'nessuna titolarita\' stimata', completo: false };
  return { valore: arrotonda(base * (tit / 100)), base: arrotonda(base), fonte: usaMv ? 'mv' : 'fm', motivo: null, completo: true };
}

/** Il percentile di un valore dentro una lista: 0 il piu' basso, 100 il piu'
 *  alto. Serve a mettere sulla stessa riga due cose che non hanno la stessa
 *  unita' - un rendimento e un prezzo. */
const percentili = (valori) => {
  const ordinati = valori.slice().sort((a, b) => a - b);
  return (v) => {
    if (ordinati.length < 2) return 50;
    const sotto = ordinati.filter((x) => x < v).length;
    const uguali = ordinati.filter((x) => x === v).length;
    return arrotonda((100 * (sotto + (uguali - 1) / 2)) / (ordinati.length - 1), 0);
  };
};

/** Quanto e' scarsa la soglia oltre cui si dice "rende meno di quanto costa".
 *  Venticinque punti di percentile sono uno scarto grosso: con venticinque
 *  giocatori vuol dire sei posizioni di differenza fra dove sta per prezzo e
 *  dove sta per resa. Sotto, e' rumore. */
export const SCARTO_NOTEVOLE = 25;

/** La classifica interna: rendimento contro prezzo, entrambi come posizione
 *  dentro la mia rosa. */
export function classifica(r) {
  const conValore = r.map((g) => ({ g, res: rendimento(g) })).filter((x) => x.res.valore !== null);
  const pRes = percentili(conValore.map((x) => x.res.valore));
  const pPrezzo = percentili(r.map((g) => g.prezzo));

  return r
    .map((g) => {
      const res = rendimento(g);
      const rangoPrezzo = pPrezzo(g.prezzo);
      if (res.valore === null)
        return { ...g, res, rangoPrezzo, rangoResa: null, scarto: null, giudizio: 'non confrontabile' };
      const rangoResa = pRes(res.valore);
      const scarto = arrotonda(rangoResa - rangoPrezzo, 0);
      return {
        ...g,
        res,
        rangoPrezzo,
        rangoResa,
        scarto,
        giudizio: scarto >= SCARTO_NOTEVOLE ? 'rende piu del prezzo' : scarto <= -SCARTO_NOTEVOLE ? 'rende meno del prezzo' : 'in linea',
      };
    })
    .sort((a, b) => (b.res.valore ?? -1) - (a.res.valore ?? -1) || b.prezzo - a.prezzo);
}

// -------------------------------------------------------------- i tre gruppi

export const TIT_ALTA = 70;
export const TIT_BASSA = 30;

/** I criteri, scritti una volta e mostrati accanto al gruppo che producono.
 *  Un elenco di nomi senza il criterio che li ha messi li' e' un oracolo: si
 *  crede o non si crede, e non si puo' discutere. */
export const CRITERI = {
  intoccabili: `titolarita' almeno ${TIT_ALTA}%, nessun problema in corso, e rendimento non sotto il prezzo`,
  valutare: `titolarita' fra ${TIT_BASSA}% e ${TIT_ALTA}%, oppure ballottaggio aperto, oppure resa sotto il prezzo di almeno ${SCARTO_NOTEVOLE} posizioni percentuali`,
  sacrificabili: `infortunio in corso, oppure titolarita' sotto il ${TIT_BASSA}%`,
};

export function gruppi(r) {
  const c = classifica(r);
  const intoccabili = [];
  const valutare = [];
  const sacrificabili = [];
  for (const g of c) {
    const perche = [];
    if (!disponibile(g)) {
      perche.push(`${(g.indisponibile ?? [])[0]?.etichetta?.toLowerCase() ?? 'indisponibile'} in corso`);
      sacrificabili.push({ ...g, perche });
      continue;
    }
    if (g.titolarita !== null && g.titolarita < TIT_BASSA) {
      perche.push(`titolarita' al ${g.titolarita}%: non entra`);
      sacrificabili.push({ ...g, perche });
      continue;
    }
    if (g.scarto !== null && g.scarto <= -SCARTO_NOTEVOLE)
      perche.push(`pagato piu' di quanto rende: ${g.rangoPrezzo}° percentile di prezzo, ${g.rangoResa}° di resa`);
    if (g.ballottaggi.length) perche.push(`ballottaggio aperto con ${g.ballottaggi.map((b) => b.con).join(', ')}`);
    if (g.titolarita !== null && g.titolarita < TIT_ALTA) perche.push(`titolarita' al ${g.titolarita}%: non e' un punto fermo`);
    if (g.titolarita === null) perche.push('nessuna titolarita\' stimata: non si sa se gioca');

    if (perche.length) valutare.push({ ...g, perche });
    else
      intoccabili.push({
        ...g,
        perche: [
          `titolarita' al ${g.titolarita}%`,
          g.scarto === null
            ? "nessuno storico, ma gioca: il rendimento non e' confrontabile col prezzo"
            : g.scarto >= SCARTO_NOTEVOLE
              ? `rende piu' del prezzo (+${g.scarto} percentili)`
              : 'resa in linea col prezzo',
        ],
      });
  }
  return { intoccabili, valutare, sacrificabili, criteri: CRITERI };
}

// ---------------------------------------------------------------- squilibri

/** Quanto scostamento fra quota di spesa e quota di slot vale un avviso.
 *  Dieci punti percentuali su un budget di cinquecento crediti sono cinquanta
 *  crediti spostati da un reparto a un altro: si vede in campo. */
export const SCOSTAMENTO = 10;
/** Da qui in su una giornata storta di quella squadra si sente tutta insieme. */
export const CONCENTRAZIONE = 3;
/** Sotto questa media voto il blocco difensivo non prende nemmeno la fascia
 *  piu' bassa del modificatore. */
export const MV_MINIMA_MODIFICATORE = 6;

export function squilibri(r, formazioneConsigliata) {
  const totale = r.reduce((s, g) => s + g.prezzo, 0);
  const avvisi = [];

  // 1. Reparti: la quota di spesa contro la quota di rosa. Non contro una
  //    media inventata: il riferimento e' quanti giocatori quel reparto occupa.
  const reparti = RUOLI.map((ruolo) => {
    const del = r.filter((g) => g.ruolo === ruolo);
    const spesa = del.reduce((s, g) => s + g.prezzo, 0);
    const quotaSpesa = totale ? arrotonda((100 * spesa) / totale, 1) : 0;
    const quotaRosa = r.length ? arrotonda((100 * del.length) / r.length, 1) : 0;
    return { ruolo, quanti: del.length, spesa, quotaSpesa, quotaRosa, scostamento: arrotonda(quotaSpesa - quotaRosa, 1) };
  });
  for (const x of reparti) {
    if (Math.abs(x.scostamento) < SCOSTAMENTO) continue;
    avvisi.push({
      tipo: 'reparto',
      gravita: 2,
      titolo: x.scostamento > 0 ? `Troppo speso in ${x.ruolo}` : `Speso poco in ${x.ruolo}`,
      testo: `${x.quanti} giocatori su ${r.length} (${x.quotaRosa}% della rosa) si prendono il ${x.quotaSpesa}% dei crediti: ${x.scostamento > 0 ? '+' : ''}${x.scostamento} punti.`,
    });
  }

  // 2. Concentrazione: quanti miei nella stessa squadra di Serie A.
  const perSquadra = {};
  for (const g of r) (perSquadra[g.squadra] ??= []).push(g);
  const concentrazione = Object.entries(perSquadra)
    .map(([squadra, gg]) => ({ squadra, quanti: gg.length, nomi: gg.map((g) => g.nome), spesa: gg.reduce((s, g) => s + g.prezzo, 0) }))
    .sort((a, b) => b.quanti - a.quanti || b.spesa - a.spesa);
  for (const c of concentrazione.filter((x) => x.quanti >= CONCENTRAZIONE))
    avvisi.push({
      tipo: 'concentrazione',
      gravita: c.quanti >= CONCENTRAZIONE + 1 ? 3 : 2,
      // L'articolo viene dalla tabella delle squadre, dove sta gia': e'
      // genere grammaticale, non si ricava dal nome.
      titolo: `${c.quanti} giocatori ${articolo(c.squadra)}${c.squadra}`,
      testo: `${c.nomi.join(', ')} — ${c.spesa} crediti. Una giornata storta di quella squadra la prendi tutta insieme.`,
    });

  // 3. Copertura: se un titolare salta, ho un'alternativa vera?
  const servono = formazioneConsigliata
    ? Object.fromEntries(RUOLI.map((x) => [x, formazioneConsigliata.undici.filter((g) => g.ruolo === x).length]))
    : { P: 1, D: 3, C: 5, A: 2 };
  const copertura = RUOLI.map((ruolo) => {
    const del = r.filter((g) => g.ruolo === ruolo);
    const affidabili = del.filter((g) => disponibile(g) && (g.titolarita ?? 0) >= 50);
    return { ruolo, inRosa: del.length, affidabili: affidabili.length, servono: servono[ruolo] ?? 0, nomi: affidabili.map((g) => g.nome) };
  });
  for (const c of copertura) {
    if (c.affidabili > c.servono) continue;
    avvisi.push({
      tipo: 'copertura',
      gravita: c.affidabili < c.servono ? 3 : 2,
      titolo: `Copertura sottile in ${c.ruolo}`,
      testo:
        c.affidabili < c.servono
          ? `il modulo consigliato ne schiera ${c.servono}, ma ne hai ${c.affidabili} disponibili sopra il 50% di titolarita'.`
          : `ne hai esattamente ${c.affidabili} sopra il 50%: se ne salta uno, il ricambio e' sotto.`,
    });
  }

  // 4. Il blocco difensivo: portiere e tre migliori difensori.
  const dif = r
    .filter((g) => g.ruolo === 'D' && disponibile(g))
    .sort((a, b) => (b.mv ?? -1) - (a.mv ?? -1))
    .slice(0, MIN_DIFENSORI_MODIFICATORE - 1);
  const por = r.filter((g) => g.ruolo === 'P' && disponibile(g)).sort((a, b) => (b.titolarita ?? -1) - (a.titolarita ?? -1))[0] ?? null;
  const gruppo = [por, ...dif].filter(Boolean);
  const conMv = gruppo.filter((g) => g.mv !== null);
  const media = conMv.length === gruppo.length && gruppo.length === MIN_DIFENSORI_MODIFICATORE
    ? arrotonda(gruppo.reduce((s, g) => s + g.mv, 0) / gruppo.length)
    : null;
  const difesa = {
    gruppo,
    media,
    senzaMv: gruppo.filter((g) => g.mv === null).map((g) => g.nome),
    sottoSoglia: media !== null && media < MV_MINIMA_MODIFICATORE,
  };
  if (difesa.senzaMv.length)
    avvisi.push({
      tipo: 'difesa',
      gravita: 2,
      titolo: 'Il blocco difensivo non si puo\' valutare',
      testo: `manca la media voto di ${difesa.senzaMv.join(', ')}. Il modificatore vale fino a +6 e senza quei numeri non si sa se lo prendi.`,
    });
  else if (difesa.sottoSoglia)
    avvisi.push({
      tipo: 'difesa',
      gravita: 3,
      titolo: 'Il blocco difensivo sta sotto la soglia',
      testo: `media ${difesa.media} su ${gruppo.map((g) => g.nome).join(', ')}: sotto ${MV_MINIMA_MODIFICATORE} il modificatore non da' niente.`,
    });

  return {
    avvisi: avvisi.sort((a, b) => b.gravita - a.gravita),
    reparti,
    concentrazione,
    copertura,
    difesa,
  };
}
