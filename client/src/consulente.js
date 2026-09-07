import { statoGiocatore } from './azioni.js';
import { fantamedie, golSubiti, indisponibilita, rigoriFanta, rigorista, stagioniXg, titolarita } from './giocatore.js';
import { alternative } from './alternative.js';
import { perGiocatore as gerarchieDi } from './gerarchie.js';
import { FASCE_MODIFICATORE } from './regolamento.js';

/** Il contesto da mandare al consulente.
 *
 *  Si costruisce da quello che il browser ha gia': nessuna richiesta in piu'
 *  mentre si sta battendo un giocatore. E' un modulo a parte perche' e' la
 *  parte che vale la pena provare da sola - un campo sbagliato qui diventa un
 *  consiglio sbagliato, e a schermo non si vedrebbe la differenza.
 *
 *  Regola sopra tutte: quello che non c'e' non si stima. Un campo assente
 *  viaggia come null e il modello ha istruzione di dirlo invece di inventarlo.
 *  Riempirlo con uno zero o con una media qui sarebbe il modo piu' rapido di
 *  farsi dare un consiglio sicuro di se' e sbagliato. */

const arrotonda = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

/** La fantamedia e la media voto sulle stagioni in archivio, pesate sulle
 *  presenze: la media delle medie darebbe lo stesso peso a tre presenze e a
 *  trentotto. */
function medie(g) {
  const righe = fantamedie(g).filter((s) => (s.pv ?? 0) > 0);
  if (!righe.length) return { fm: null, mv: null, presenze: 0, stagioni: [] };
  const pv = righe.reduce((s, r) => s + r.pv, 0);
  const conMv = righe.filter((r) => r.mv !== null && r.mv !== undefined);
  return {
    fm: arrotonda(righe.reduce((s, r) => s + r.fm * r.pv, 0) / pv),
    mv: conMv.length ? arrotonda(conMv.reduce((s, r) => s + r.mv * r.pv, 0) / conMv.reduce((s, r) => s + r.pv, 0)) : null,
    presenze: pv,
    stagioni: righe.map((r) => ({
      stagione: r.stagione,
      presenze: r.pv,
      mv: r.mv ?? null,
      fm: r.fm ?? null,
      gol: r.gol ?? null,
      assist: r.assist ?? null,
      ammonizioni: r.amm ?? null,
      espulsioni: r.esp ?? null,
    })),
  };
}

/** Tutto quello che si sa di un giocatore, nella forma piu' compatta che resti
 *  leggibile. I portieri portano i gol subiti al posto degli expected goals:
 *  un portiere non si costruisce occasioni, e il suo xG e' zero anche nella
 *  stagione in cui para tutto. */
export function schedaGiocatore(g, stato) {
  if (!g) return null;
  const m = medie(g);
  const tit = titolarita(g);
  const ind = indisponibilita(g);
  const rig = rigorista(g);
  const rigori = rigoriFanta(g);
  const subiti = golSubiti(g);
  const xg = stagioniXg(g).map((r) => ({
    stagione: r.stagione,
    partite: r.partite ?? null,
    minuti: r.minuti ?? null,
    gol: r.gol ?? null,
    xg: arrotonda(r.xg),
    assist: r.assist ?? null,
    xa: arrotonda(r.xa),
  }));
  return {
    nome: g.nome,
    ruolo: g.ruolo,
    squadra: g.squadra,
    fantamediaStorica: m.fm,
    mediaVoto: m.mv,
    presenzeInArchivio: m.presenze,
    stagioni: m.stagioni,
    // Dati di calcio vero, non di fanta: quanto valevano le occasioni avute.
    xg: g.ruolo === 'P' ? null : xg,
    golSubitiPerPartita: subiti ? subiti.media : null,
    titolarita: tit ? { percentuale: tit.percentuale, titolare: tit.titolare } : null,
    indisponibile: ind.gruppi.length
      ? ind.gruppi.map((x) => ({ tipo: x.tipo, righe: x.righe.map((r) => ({ testo: r.testo, fonte: r.fonte })) }))
      : null,
    rigorista: rig ? rig.ordine ?? true : null,
    rigoriStorici: rigori ? { segnati: rigori.segnati, tirati: rigori.tirati, percentuale: rigori.percentuale } : null,
    ballottaggi: (stato?.ballottaggi ?? [])
      .filter((b) => b.uno.id === g.id || b.due.id === g.id)
      .map((b) => {
        const io = b.uno.id === g.id ? b.uno : b.due;
        const altro = b.uno.id === g.id ? b.due : b.uno;
        return { con: altro.nome, titolaritaMia: io.percentuale, titolaritaSua: altro.percentuale, nota: b.nota };
      }),
    viceDichiarato: gerarchieDi(stato?.gerarchie, g.id, null).map((r) => ({
      verso: r.ruoloMio === 'titolare' ? 'il suo vice sarebbe' : 'sarebbe il vice di',
      chi: r.altro.nome,
      certezza: r.certezza,
      fonte: r.fonte,
    })),
  };
}

/** Quello che serve per giudicare il modificatore di difesa: la media voto del
 *  portiere e dei tre difensori migliori, che e' esattamente il gruppo su cui
 *  il regolamento lo calcola. */
export function difesaPerModificatore(presi, stato) {
  const dati = (ruolo) =>
    presi
      .filter((p) => p.ruolo === ruolo)
      .map((p) => {
        const g = stato.giocatori.find((x) => x.id === p.player_id);
        return { nome: p.nome, mv: medie(g).mv };
      });
  const portieri = dati('P');
  const difensori = dati('D')
    .slice()
    .sort((a, b) => (b.mv ?? -1) - (a.mv ?? -1));
  const gruppo = [...portieri.slice(0, 1), ...difensori.slice(0, 3)].filter((x) => x.mv !== null);
  return {
    portiere: portieri[0] ?? null,
    difensoriMigliori: difensori.slice(0, 3),
    difensoriInRosa: difensori.length,
    // Senza quattro medie voto la media non e' quella su cui si calcola il
    // modificatore: si dice quanti ne mancano invece di darne una parziale.
    mediaGruppo: gruppo.length === 4 ? arrotonda(gruppo.reduce((s, x) => s + x.mv, 0) / 4) : null,
    quantiSenzaMediaVoto: [...portieri.slice(0, 1), ...difensori.slice(0, 3)].filter((x) => x.mv === null).length,
    fasce: FASCE_MODIFICATORE,
  };
}

export function costruisciContesto(stato, config, lotto) {
  const presi = stato.rosa.presi;
  const perId = new Map(stato.giocatori.map((g) => [g.id, g]));

  const rosa = presi.map((p) => ({
    ...schedaGiocatore(perId.get(p.player_id), stato),
    prezzoPagato: p.prezzo,
  }));

  // Quanti ne restano, per ruolo e per fascia: dice quanto e' urgente riempire
  // un buco e quanto costera' farlo piu' tardi.
  const restanti = {};
  for (const r of stato.restanti) {
    restanti[r.ruolo] ??= { totale: 0, perFascia: {} };
    restanti[r.ruolo].totale += r.n;
    restanti[r.ruolo].perFascia[r.fascia ?? 'senza fascia'] = r.n;
  }

  const perSquadra = {};
  for (const p of presi) perSquadra[p.squadra] = (perSquadra[p.squadra] ?? 0) + 1;

  return {
    lega: {
      squadre: config?.config?.numeroSquadre ?? null,
      crediti: stato.rosa.budget,
      composizioneRosa: stato.rosa.slot,
      miaSquadra: stato.rosa.squadra,
    },
    budget: {
      speso: stato.rosa.spesa,
      residuo: stato.rosa.residuo,
      massimoSostenibile: stato.rosa.massimoSostenibile,
      slotPieni: stato.rosa.presiPerRuolo,
      slotLiberi: stato.rosa.liberiPerRuolo,
      slotLiberiTotali: stato.rosa.slotLiberi,
    },
    rosa,
    giocatoriPerSquadra: perSquadra,
    difesa: difesaPerModificatore(presi, stato),
    lotto: lotto
      ? {
          ...schedaGiocatore(lotto, stato),
          quotazione: lotto.quotazione,
          fvm: lotto.fvm,
          fascia: lotto.fascia,
          alternativeStessaSquadraStessoRuolo: alternative(stato.giocatori, lotto, presi, stato.ballottaggi).map((a) => ({
            nome: a.g.nome,
            quotazione: a.g.quotazione,
            titolarita: a.percentuale,
            stato: a.stato,
            inBallottaggioConLui: !!a.ballottaggio,
          })),
        }
      : null,
    restantiPerRuoloEFascia: restanti,
    obiettiviAncoraLiberi: stato.giocatori
      .filter((g) => g.target && !g.assente_dal && statoGiocatore(g, presi).stato === 'disponibile')
      .map((g) => ({ nome: g.nome, ruolo: g.ruolo, squadra: g.squadra, quotazione: g.quotazione, fascia: g.fascia })),
  };
}
