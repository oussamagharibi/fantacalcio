import { fantamedie, indisponibilita, paraRigori, rigorista, titolarita } from './giocatore.js';
import { FASCE_MODIFICATORE, MIN_DIFENSORI_MODIFICATORE, MODULI } from './regolamento.js';

/** La mia squadra a stagione cominciata.
 *
 *  Tutta la logica sta qui e non nel componente perche' e' la parte che decide
 *  chi gioca: un ordinamento sbagliato a schermo non si distingue da uno
 *  giusto, e la formazione consigliata e' un consiglio che poi si segue. */

const arrotonda = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

/** Fantamedia e media voto pesate sulle presenze: la media delle medie darebbe
 *  lo stesso peso a tre presenze e a trentotto. */
export function medie(g) {
  const righe = fantamedie(g).filter((s) => (s.pv ?? 0) > 0);
  if (!righe.length) return { fm: null, mv: null, presenze: 0 };
  const pv = righe.reduce((s, r) => s + r.pv, 0);
  const conMv = righe.filter((r) => r.mv !== null && r.mv !== undefined);
  return {
    fm: arrotonda(righe.reduce((s, r) => s + r.fm * r.pv, 0) / pv),
    mv: conMv.length
      ? arrotonda(conMv.reduce((s, r) => s + r.mv * r.pv, 0) / conMv.reduce((s, r) => s + r.pv, 0))
      : null,
    presenze: pv,
  };
}

export const RUOLI = ['P', 'D', 'C', 'A'];

/** Ogni giocatore della rosa con quello che serve a decidere se schierarlo. */
export function rosa(stato) {
  const perId = new Map((stato?.giocatori ?? []).map((g) => [g.id, g]));
  return (stato?.rosa?.presi ?? [])
    .map((p) => {
      const g = perId.get(p.player_id);
      if (!g) return null;
      const m = medie(g);
      const tit = titolarita(g);
      const ind = indisponibilita(g);
      const ballo = (stato?.ballottaggi ?? []).filter((b) => b.uno.id === g.id || b.due.id === g.id);
      return {
        id: g.id,
        nome: g.nome,
        ruolo: g.ruolo,
        squadra: g.squadra,
        prezzo: p.prezzo,
        fm: m.fm,
        mv: m.mv,
        presenze: m.presenze,
        // Assente non e' zero: chi non ha una titolarita' non e' un panchinaro,
        // e' uno di cui non sappiamo. Chi ordina lo mette in fondo, ma senza
        // fingere di aver letto uno zero.
        titolarita: tit ? tit.percentuale : null,
        titolare: tit ? tit.titolare : null,
        indisponibile: ind.gruppi.length ? ind.gruppi : null,
        rigorista: rigorista(g),
        paraRigori: paraRigori(g),
        ballottaggi: ballo.map((b) => {
          const altro = b.uno.id === g.id ? b.due : b.uno;
          return { con: altro.nome, suaTitolarita: altro.percentuale };
        }),
        g,
      };
    })
    .filter(Boolean);
}

export const perReparto = (r) => Object.fromEntries(RUOLI.map((x) => [x, r.filter((g) => g.ruolo === x)]));

/** Quanto e' costato ogni reparto, in crediti e in percentuale della spesa. */
export function spesaPerReparto(r) {
  const totale = r.reduce((s, g) => s + g.prezzo, 0);
  return {
    totale,
    perRuolo: RUOLI.map((x) => {
      const del = r.filter((g) => g.ruolo === x);
      const spesa = del.reduce((s, g) => s + g.prezzo, 0);
      return {
        ruolo: x,
        quanti: del.length,
        spesa,
        percentuale: totale > 0 ? arrotonda((100 * spesa) / totale, 1) : 0,
        piuCaro: del.slice().sort((a, b) => b.prezzo - a.prezzo)[0] ?? null,
      };
    }),
  };
}

// ------------------------------------------------------- prossimo turno

/** Chi dei miei gioca il prossimo turno, contro chi, in casa o fuori.
 *
 *  Il calendario arriva dalla pagina delle probabili formazioni: se nessuno ha
 *  ancora aggiornato le fonti, partite e vuota e la pagina omette la sezione.
 *  Un turno inventato sarebbe peggio di nessun turno: si schiera guardandolo. */
export function prossimoTurno(r, partite) {
  if (!partite?.length) return null;
  const perSquadra = new Map();
  for (const p of partite) {
    perSquadra.set(p.casa, { avversario: p.ospite, casa: true, partita: p });
    perSquadra.set(p.ospite, { avversario: p.casa, casa: false, partita: p });
  }
  const righe = [];
  const senzaPartita = [];
  for (const g of r) {
    const c = perSquadra.get(g.squadra);
    if (!c) {
      // La sua squadra non gioca in questo turno: succede col turno infrasettimanale
      // spezzato, e va detto invece di lasciarlo sparire dalla lista.
      senzaPartita.push(g);
      continue;
    }
    righe.push({ ...g, avversario: c.avversario, casa: c.casa, partita: c.partita });
  }
  const giornata = partite[0]?.giornata ?? null;
  return {
    giornata,
    stagione: partite[0]?.stagione ?? null,
    // Raggruppati per partita: se il Genoa gioca male, i miei tre del Genoa
    // vanno male insieme, e vederli insieme lo ricorda.
    perPartita: partite
      .map((p) => ({
        partita: p,
        miei: righe.filter((g) => g.partita.id === p.id).sort(megliore),
      }))
      .filter((x) => x.miei.length)
      .sort((a, b) => b.miei.length - a.miei.length),
    quanti: righe.length,
    disponibili: righe.filter(disponibile).length,
    senzaPartita,
  };
}

// ---------------------------------------------------------------- allarmi

export const TITOLARITA_BASSA = 50;

/** Gli allarmi, dal piu' grave al meno. La gravita' e' un numero e non un
 *  ordine scritto a mano: se domani si aggiunge un tipo, si mette il suo peso
 *  e il resto si ordina da solo. */
const GRAVITA = { infortunio: 3, squalifica: 3, dubbio: 2, titolarita: 2, ballottaggio: 1 };

export function allarmi(r) {
  const fuori = [];
  for (const g of r) {
    for (const gr of g.indisponibile ?? [])
      fuori.push({
        tipo: gr.tipo,
        gravita: GRAVITA[gr.tipo] ?? 1,
        g,
        testo: `${gr.etichetta}: ${gr.righe[0]?.testo ?? ''}`,
        fonti: gr.righe.map((x) => x.fonte).filter(Boolean),
      });
    if (g.titolarita !== null && g.titolarita < TITOLARITA_BASSA && !(g.indisponibile ?? []).length)
      fuori.push({
        tipo: 'titolarita',
        gravita: GRAVITA.titolarita,
        g,
        testo: `titolarita' al ${g.titolarita}%: sotto il ${TITOLARITA_BASSA}%`,
        fonti: [],
      });
    for (const b of g.ballottaggi)
      fuori.push({
        tipo: 'ballottaggio',
        gravita: GRAVITA.ballottaggio,
        g,
        testo: `in ballottaggio con ${b.con}${b.suaTitolarita !== null ? ` (lui al ${b.suaTitolarita}%)` : ''}`,
        fonti: [],
      });
  }
  return fuori.sort((a, b) => b.gravita - a.gravita || (a.g.nome ?? '').localeCompare(b.g.nome ?? '', 'it'));
}

// -------------------------------------------------------------- formazione

/** L'ordine con cui si sceglie chi gioca, dichiarato una volta sola.
 *  Prima la titolarita' - e' il dato di questa settimana - poi la fantamedia,
 *  che e' storia. Chi non ha titolarita' finisce dopo chi ce l'ha, a qualunque
 *  percentuale: non e' uno zero, e' un dato che manca. */
export const megliore = (a, b) => {
  const ta = a.titolarita;
  const tb = b.titolarita;
  if (ta !== null && tb !== null && ta !== tb) return tb - ta;
  if (ta !== null && tb === null) return -1;
  if (ta === null && tb !== null) return 1;
  return (b.fm ?? -1) - (a.fm ?? -1) || (b.prezzo ?? 0) - (a.prezzo ?? 0);
};

export const disponibile = (g) => !(g.indisponibile ?? []).length;

/** La fascia del modificatore in cui cade una media voto. */
export const fascia = (mv) => (typeof mv === 'number' ? FASCE_MODIFICATORE.find((f) => mv >= f.da) ?? null : null);

/** Il modificatore atteso: media di portiere e tre migliori difensori.
 *
 *  Si calcola solo con almeno MIN_DIFENSORI_MODIFICATORE difensori schierati,
 *  che e' la regola. Con tre non vale zero: non si applica affatto, ed e' una
 *  differenza che va detta invece di sommata.
 *  Serve la media voto di tutti e quattro: se a uno manca, il numero non e'
 *  quello su cui la lega calcolera' il bonus, e allora non si mostra. */
export function modificatore(undici) {
  const dif = undici.filter((g) => g.ruolo === 'D');
  const por = undici.find((g) => g.ruolo === 'P') ?? null;
  if (dif.length < MIN_DIFENSORI_MODIFICATORE)
    return { attivo: false, motivo: `serve schierare almeno ${MIN_DIFENSORI_MODIFICATORE} difensori`, punti: 0, media: null };
  const gruppo = [por, ...dif.slice().sort((a, b) => (b.mv ?? -1) - (a.mv ?? -1)).slice(0, 3)];
  const senzaMv = gruppo.filter((g) => !g || g.mv === null);
  if (senzaMv.length)
    return {
      attivo: true,
      punti: null,
      media: null,
      // Chi manca, non solo quanti: e un dato che si puo andare a prendere,
      // e senza il nome non si sa dove guardare.
      senzaMv: senzaMv.map((g) => g?.nome ?? '(nessun portiere)'),
      motivo: `manca la media voto di ${senzaMv.map((g) => g?.nome ?? 'un portiere').join(', ')}: il modificatore non si puo' stimare`,
      gruppo,
    };
  const media = arrotonda(gruppo.reduce((s, g) => s + g.mv, 0) / 4);
  const f = fascia(media);
  return { attivo: true, media, punti: f?.punti ?? 0, fascia: f, gruppo, motivo: null };
}

/** L'undici migliore per un modulo, secondo il criterio dichiarato sopra. */
export function undiciPer(modulo, r) {
  const [d, c, a] = modulo.split('-').map(Number);
  const quanti = { P: 1, D: d, C: c, A: a };
  const usabili = r.filter(disponibile);
  const schierati = [];
  const mancanti = [];
  for (const ruolo of RUOLI) {
    const ordinati = usabili.filter((g) => g.ruolo === ruolo).sort(megliore);
    const presi = ordinati.slice(0, quanti[ruolo]);
    schierati.push(...presi);
    if (presi.length < quanti[ruolo]) mancanti.push({ ruolo, servono: quanti[ruolo], ho: presi.length });
  }
  const dentro = new Set(schierati.map((g) => g.id));
  return {
    modulo,
    undici: schierati,
    completa: mancanti.length === 0,
    mancanti,
    esclusi: r.filter((g) => !dentro.has(g.id)),
    modificatore: modificatore(schierati),
  };
}

/** Il punteggio con cui si confrontano i moduli: la somma delle fantamedie
 *  dell'undici piu' il modificatore atteso.
 *  Il modificatore entra nel totale ma resta anche a se': un modulo a tre
 *  difensori perde sei punti prima di giocare, e nasconderlo dentro una somma
 *  vorrebbe dire far sparire proprio la cosa che decide. */
export function valuta(f) {
  const somma = f.undici.reduce((s, g) => s + (g.fm ?? 0), 0);
  const senzaFm = f.undici.filter((g) => g.fm === null).length;
  const bonus = f.modificatore.punti ?? 0;
  return {
    ...f,
    sommaFm: arrotonda(somma),
    senzaFm,
    bonus,
    // Il bonus incerto non e un bonus a zero: entra nel totale come zero
    // perche qualcosa bisogna pur sommare, ma chi legge deve sapere che quel
    // numero e un pavimento e non una stima.
    bonusIncerto: f.modificatore.attivo && f.modificatore.punti === null,
    totale: arrotonda(somma + bonus),
  };
}

/** Tutti i moduli, valutati e ordinati. Il consigliato e' il primo, e il
 *  perche' si legge dai numeri accanto. */
export function formazioni(r, moduli = MODULI) {
  const valutate = moduli.map((m) => valuta(undiciPer(m, r)));
  const ordinate = valutate.slice().sort((a, b) => {
    if (a.completa !== b.completa) return a.completa ? -1 : 1;
    return b.totale - a.totale || b.bonus - a.bonus;
  });
  const migliore = ordinate[0] ?? null;
  const secondo = ordinate[1] ?? null;

  /** Il confronto che decide davvero: il miglior modulo a tre difensori contro
   *  il miglior modulo a quattro o cinque.
   *
   *  Sta fuori dal punteggio di proposito. Un modulo a tre rinuncia al
   *  modificatore, che vale fino a +6 - quanto due gol - e una somma che
   *  inghiotte quei sei punti fa sembrare la scelta una questione di decimali.
   *  Qui i due numeri restano separati: quanto guadagni in fantamedia, e quanto
   *  lasci sul tavolo in modificatore. */
  const conTre = ordinate.filter((f) => !f.modificatore.attivo)[0] ?? null;
  const conQuattro = ordinate.filter((f) => f.modificatore.attivo)[0] ?? null;
  const confrontoDifesa =
    conTre && conQuattro
      ? {
          tre: conTre,
          quattro: conQuattro,
          // Positivo = il modulo a tre rende di piu' in fantamedia.
          differenzaFm: arrotonda(conTre.sommaFm - conQuattro.sommaFm),
          modificatoreInGioco: conQuattro.modificatore.punti,
          // Quando la media voto di un difensore manca non si sa quanto vale il
          // modificatore, e allora non si puo' dire quale dei due conviene:
          // si dice che non si sa.
          incerto: conQuattro.modificatore.punti === null,
          nomiSenzaMv: conQuattro.modificatore.senzaMv ?? [],
        }
      : null;

  return {
    tutte: valutate,
    ordinate,
    consigliato: migliore,
    confrontoDifesa,
    /** Perche' quello e non un altro: la differenza col secondo, spezzata fra
     *  quanto viene dai giocatori e quanto dal modificatore. */
    perche: migliore && secondo
      ? {
          contro: secondo.modulo,
          differenza: arrotonda(migliore.totale - secondo.totale),
          daFm: arrotonda(migliore.sommaFm - secondo.sommaFm),
          daModificatore: migliore.bonus - secondo.bonus,
        }
      : null,
  };
}

/** La panchina: chi entra prima, con cinque sostituzioni.
 *  Ordine per probabilita' di scendere in campo, cioe' titolarita'; chi e'
 *  indisponibile va in fondo, perche' non entra affatto. */
export const SOSTITUZIONI = 5;

export function panchina(r, undici) {
  const dentro = new Set(undici.map((g) => g.id));
  return r
    .filter((g) => !dentro.has(g.id))
    .sort((a, b) => {
      const da = disponibile(a);
      const db = disponibile(b);
      if (da !== db) return da ? -1 : 1;
      return megliore(a, b);
    })
    .map((g, i) => ({ ...g, entraProbabile: i < SOSTITUZIONI && disponibile(g) }));
}
