import { getDb, backup } from '../db.js';
import { leggiFonti, risolviFeed, risolviPagine, FONTI_PATH } from './fonti.js';
import { raccogli, associa, perGiocatore, salvaNota, GIORNI_MAX, CARATTERI_MINIMI } from './notizie.js';
import { stimaCosto, costoReale, chiaveMancante, generaNota, conFonti, nuovoClient, MODELLO, PREZZO } from './analisi.js';
import { raccogliSegnali, contaSegnali, FONTI_CON_PARSER, PAGINE } from './fantacalcio.js';
import { raccogliInfortuni, FONTI_INFORTUNI, PAGINE_INFORTUNI } from './infortuni.js';

/** L'aggiornamento completo delle fonti, in un modulo invece che in uno script.
 *
 *  Serve a due padroni: "npm run news" da riga di comando e il pulsante
 *  "Aggiorna tutto" della pagina Analisi. Prima il pulsante lanciava lo script
 *  come processo figlio e leggeva il suo stdout: online quello voleva dire un
 *  secondo processo Node nella stessa istanza, un secondo scrittore sullo
 *  stesso file SQLite, e un avanzamento ricavato leggendo righe di testo.
 *  Adesso la corsa gira qui dentro e riempie una struttura: chi guarda vede
 *  fonte per fonte, e gli errori sono campi, non frasi da riconoscere.
 *
 *  Non tocca listone, statistiche e xG: quelli sono file, si caricano a mano. */

const MIN_ARTICOLI = 2;

/** Tutte le fonti con un parser dedicato: restano fuori dal percorso generico,
 *  altrimenti finirebbero anche in articles e dentro associa(). */
export const TUTTE_CON_PARSER = new Set([...FONTI_CON_PARSER, ...FONTI_INFORTUNI]);

/** Da messaggio tecnico a frase che si puo' leggere a schermo.
 *  I raccoglitori appiattiscono gia' l'errore in una stringa ("HTTP 403",
 *  "nessun url: non scoperto"), quindi qui si parte da li'. */
export function leggibile(messaggio) {
  const t = String(messaggio ?? '').trim();
  if (!t) return 'errore senza motivo';
  const http = /\bHTTP (\d{3})\b/.exec(t);
  if (http) {
    const s = Number(http[1]);
    if (s === 403) return '403: il sito nega l\'accesso';
    if (s === 404) return '404: la pagina non esiste piu\'';
    if (s === 429) return '429: troppe richieste, il sito ci sta rallentando';
    if (s >= 500) return `${s}: errore del sito, non nostro`;
    return `HTTP ${s}`;
  }
  if (/timeout|timed out|aborted|AbortError/i.test(t)) return 'timeout: nessuna risposta entro 20 secondi';
  if (/robots/i.test(t)) return 'robots.txt del sito vieta questa pagina';
  if (/nessun url|url mancante|non scoperto|nessun link|struttura non riconosciuta/i.test(t))
    return `feed non trovato: ${t}`;
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(t)) return 'sito irraggiungibile dalla rete';
  return t;
}

/** Lo stato che la pagina interroga. Nasce completo: le fonti compaiono tutte
 *  subito in "attesa", cosi' si vede da principio quante sono e quali. */
export function nuovoStato() {
  return {
    inCorso: true,
    esito: 'in-corso',
    avviatoIl: new Date().toISOString(),
    finitoIl: null,
    fase: 'fonti',
    fonti: [],
    avvisi: [],
    note: { stato: 'attesa', motivo: null, fatte: 0, fallite: 0, totali: null },
    riepilogo: null,
    errore: null,
    righe: [],
  };
}

const ETICHETTE_FASE = {
  fonti: 'scopro gli indirizzi delle fonti',
  segnali: 'titolarita\' e rigoristi',
  infortuni: 'infortuni, dubbi, squalifiche e diffide',
  articoli: 'articoli dai feed',
  associazione: 'associo gli articoli ai giocatori',
  note: 'note AI',
  fine: 'finito',
};
export { ETICHETTE_FASE };

/** L'aggiornamento vero.
 *  `stato` viene riempito man mano; `su` e' chiamata a ogni cambiamento perche'
 *  chi ospita la corsa possa salvarlo; `log` riceve le righe di dettaglio. */
export async function aggiorna({ stato, conNote = true, soloRaccolta = false, log = () => {}, su = () => {} } = {}) {
  const s = stato ?? nuovoStato();
  const dillo = (m) => {
    log(m);
    s.righe.push(m);
    if (s.righe.length > 600) s.righe.splice(0, s.righe.length - 600);
  };
  const fase = (f) => {
    s.fase = f;
    su(s);
  };
  const riga = (nome) => s.fonti.find((f) => f.nome === nome);
  const avvisa = (m) => {
    if (!s.avvisi.includes(m)) s.avvisi.push(m);
    dillo(m);
    su(s);
  };

  // ------------------------------------------------------------------ fonti
  fase('fonti');
  const { fonti, creato } = leggiFonti();
  dillo(`file fonti: ${FONTI_PATH}${creato ? ' (creato ora con le fonti di default)' : ''}`);
  await risolviFeed(fonti, dillo);
  // L'url di Sky cambia ogni giornata: si riscopre a ogni giro.
  await risolviPagine(fonti, dillo);

  const attive = fonti.filter((f) => f.attiva);
  const nomiAttivi = new Set(attive.map((f) => f.nome));
  // L'ordine e' quello in cui verranno lette davvero: la lista a schermo
  // avanza dall'alto in basso invece di accendersi a caso.
  const ordine = [
    ...PAGINE.filter((p) => nomiAttivi.has(p.fonte)).map((p) => ({ nome: p.fonte, gruppo: 'segnali' })),
    ...PAGINE_INFORTUNI.filter((p) => nomiAttivi.has(p.fonte)).map((p) => ({ nome: p.fonte, gruppo: 'infortuni' })),
    ...attive.filter((f) => !TUTTE_CON_PARSER.has(f.nome)).map((f) => ({ nome: f.nome, gruppo: 'articoli' })),
  ];
  s.fonti = ordine.map(({ nome, gruppo }) => {
    const f = fonti.find((x) => x.nome === nome);
    return { nome, gruppo, tipo: f?.tipo ?? 'pagina', url: f?.url ?? null, stato: 'attesa', dettaglio: null, errore: null, righe: 0 };
  });
  dillo(`fonti attive: ${s.fonti.length} (${attive.length - s.fonti.length ? 'alcune senza percorso' : 'tutte in coda'})`);
  for (const f of fonti) {
    dillo(`  ${f.attiva ? 'attiva ' : 'spenta '} ${f.nome.padEnd(26)} ${String(f.tipo).padEnd(7)} ${f.url ?? '(nessun url)'}${f.errore ? `  <- ${f.errore}` : ''}`);
  }
  su(s);

  const bak = backup('pre-news');
  dillo(`backup db: ${bak}`);

  /** Una fonte alla volta, non tutte in blocco: e' l'unico modo di dire "questa
   *  sta girando adesso" mentre gira. La pausa di due secondi sta nella coda di
   *  web.js e vale lo stesso, quindi spezzare il giro non cambia l'educazione. */
  const conRiga = async (nome, fn) => {
    const r = riga(nome);
    r.stato = 'in-corso';
    su(s);
    try {
      await fn(r);
      if (r.stato === 'in-corso') r.stato = 'ok';
    } catch (e) {
      r.stato = 'errore';
      r.errore = leggibile(e?.message ?? e);
      dillo(`${nome}: ${r.errore} - salto la fonte, le altre proseguono`);
    }
    su(s);
    return r;
  };

  // ---------------------------------------------------- segnali (parser)
  fase('segnali');
  for (const { nome } of ordine.filter((o) => o.gruppo === 'segnali')) {
    await conRiga(nome, async (r) => {
      const [e] = await raccogliSegnali([fonti.find((f) => f.nome === nome)], dillo);
      if (!e) throw new Error('nessun parser per questa fonte');
      if (e.errore) {
        r.stato = 'errore';
        r.errore = leggibile(e.errore);
        dillo(`${nome.padEnd(26)} ERRORE: ${r.errore} (i segnali precedenti restano)`);
        return;
      }
      r.righe = e.abbinate;
      r.dettaglio = `${e.abbinate} giocatori abbinati su ${e.lette} letti`;
      dillo(`${nome.padEnd(26)} voci lette: ${String(e.lette).padStart(4)} | abbinate: ${String(e.abbinate).padStart(4)} | non abbinate: ${String(e.nonAbbinati.length).padStart(3)}`);
      for (const n of e.nonAbbinati) dillo(`    non abbinato: "${n.nome}"${n.squadra ? ` (${n.squadra})` : ''} - ${n.motivo}`);
    });
  }

  // -------------------------------------------------------- infortuni
  fase('infortuni');
  for (const { nome } of ordine.filter((o) => o.gruppo === 'infortuni')) {
    await conRiga(nome, async (r) => {
      const [e] = await raccogliInfortuni([fonti.find((f) => f.nome === nome)], dillo);
      if (!e) throw new Error('fonte non riconosciuta');
      if (e.errore) {
        r.stato = 'errore';
        r.errore = leggibile(e.errore);
        dillo(`${nome.padEnd(26)} ERRORE: ${r.errore} (i segnali precedenti restano)`);
        return;
      }
      r.url = e.url;
      r.righe = e.abbinate;
      const perTipo = Object.entries(e.perTipo).map(([t, n]) => `${t} ${n}`).join(', ') || 'niente';
      r.dettaglio = `${e.abbinate} giocatori abbinati su ${e.lette} letti (${perTipo})`;
      dillo(`${nome.padEnd(26)} ${e.url}`);
      dillo(`${''.padEnd(26)} voci lette: ${String(e.lette).padStart(4)} (${perTipo}) | abbinate: ${String(e.abbinate).padStart(4)} | non abbinate: ${String(e.nonAbbinati.length).padStart(3)}`);
      for (const n of e.nonAbbinati) dillo(`    non abbinato: "${n.nome}"${n.squadra ? ` (${n.squadra})` : ''} - ${n.motivo}`);
    });
  }
  for (const c of contaSegnali()) dillo(`segnali in archivio, ${c.tipo}: ${c.n}`);

  // Le pagine con parser non devono restare anche in articles: la' finirebbero
  // di nuovo dentro associa(), che e' proprio il percorso che stiamo scavalcando.
  const ripulite = getDb()
    .prepare(`DELETE FROM articles WHERE fonte IN (${[...TUTTE_CON_PARSER].map(() => '?').join(',')})`)
    .run(...TUTTE_CON_PARSER).changes;
  if (ripulite) dillo(`articoli rimossi perche' ora gestiti dai parser: ${ripulite}`);

  // --------------------------------------------------------- articoli
  fase('articoli');
  for (const { nome } of ordine.filter((o) => o.gruppo === 'articoli')) {
    await conRiga(nome, async (r) => {
      const [e] = await raccogli([fonti.find((f) => f.nome === nome)], dillo);
      if (!e) throw new Error('fonte non leggibile');
      // Un errore su un singolo articolo non fa fallire la fonte: fallisce se
      // non e' arrivato niente.
      if (e.errori.length && e.scaricati === 0) {
        r.stato = 'errore';
        r.errore = leggibile(e.errori[0]);
        return;
      }
      r.righe = e.scaricati;
      r.dettaglio = `${e.scaricati} articoli nuovi su ${e.trovati ?? 0} trovati${e.saltatiGiaPresenti ? `, ${e.saltatiGiaPresenti} gia' presenti` : ''}`;
      if (e.errori.length) r.errore = `${e.errori.length} articoli non scaricati: ${leggibile(e.errori[0])}`;
      dillo(`${nome.padEnd(26)} trovati: ${String(e.trovati ?? 0).padStart(3)} | scaricati: ${String(e.scaricati).padStart(3)} | gia' presenti: ${String(e.saltatiGiaPresenti).padStart(3)} | scartati per data (>${GIORNI_MAX}gg): ${String(e.scartatiPerData).padStart(3)}${e.errori.length ? ` | errori: ${e.errori.length}` : ''}`);
      for (const err of e.errori) dillo(`    errore: ${err}`);
    });
  }
  const totaliArticoli = getDb().prepare('SELECT count(*) AS n FROM articles').get().n;
  dillo(`articoli in archivio: ${totaliArticoli}`);

  // ------------------------------------------------------ associazione
  fase('associazione');
  const { articoli, associazioni, ambigui, troppoCorti, scartatiSenzaSquadra, nonRisolvibili } = associa();
  dillo(`articoli negli ultimi ${GIORNI_MAX} giorni: ${articoli.length}`);
  dillo(`associazioni trovate: ${associazioni.length}`);
  const cadute = scartatiSenzaSquadra.univoci + scartatiSenzaSquadra.ambigui;
  dillo(`cadute per il filtro squadra: ${cadute} (${scartatiSenzaSquadra.univoci} con cognome univoco, ${scartatiSenzaSquadra.ambigui} con cognome ambiguo)`);
  for (const x of scartatiSenzaSquadra.esempi) {
    dillo(`    scartata: ${x.nome.padEnd(18)} (${x.squadra}) non citata in [${x.fonte}] ${String(x.titolo).slice(0, 44)}${x.ambiguo ? '  AMBIGUO' : ''}`);
  }
  dillo(`ambiguita' non risolvibile, associazioni scartate: ${nonRisolvibili.length}`);
  for (const n of nonRisolvibili.slice(0, 10)) {
    dillo(`    ambiguita' non risolvibile: "${n.cognome}" -> ${n.giocatori.join(' | ')} in [${n.fonte}] ${String(n.titolo).slice(0, 40)}`);
  }
  dillo(`cognomi sotto i ${CARATTERI_MINIMI} caratteri, esclusi: ${troppoCorti.length}${troppoCorti.length ? ` (${troppoCorti.slice(0, 8).map((g) => g.nome).join(', ')}${troppoCorti.length > 8 ? ', ...' : ''})` : ''}`);
  if (ambigui.length) {
    dillo(`cognomi ambigui: ${ambigui.length} - li separa la squadra citata; dove non e' citata l'associazione cade`);
    for (const a of ambigui) dillo(`    "${a.cognome}" -> ${a.giocatori.map((g) => `${g.nome} (${g.squadra})`).join(' | ')}`);
  }
  for (const a of associazioni.slice(0, 10)) {
    dillo(`    ${a.nome.padEnd(20)} <- [${a.fonte}] ${(a.titolo ?? a.url).slice(0, 60)}${a.ambiguo ? '  (AMBIGUO)' : ''}`);
  }

  const daAnalizzare = perGiocatore(associazioni, MIN_ARTICOLI);
  dillo(`giocatori con almeno ${MIN_ARTICOLI} articoli: ${daAnalizzare.length}`);

  // -------------------------------------------------------------- note
  s.note.totali = daAnalizzare.length;
  const chiudi = (statoNote, motivo) => {
    s.note.stato = statoNote;
    s.note.motivo = motivo;
    if (motivo && statoNote === 'saltata') avvisa(motivo);
    else if (motivo) dillo(motivo);
  };

  if (soloRaccolta) chiudi('saltata', 'Richiesta la sola raccolta: note non generate.');
  else if (!daAnalizzare.length) chiudi('niente-da-fare', 'Nessun giocatore ha abbastanza articoli: non c\'e\' niente da analizzare.');
  // Prima "non richieste", poi "chiave assente": a chi non ha chiesto le note
  // non serve sapere che manca una chiave che non stava usando.
  else if (!conNote) chiudi('saltata', 'Generazione delle note non richiesta: raccolta completata.');
  else if (chiaveMancante())
    chiudi(
      'saltata',
      'ANTHROPIC_API_KEY non impostata sul server: le note AI non sono state rigenerate. Le fonti sono comunque aggiornate.'
    );
  else {
    fase('note');
    s.note.stato = 'in-corso';
    su(s);
    const stima = stimaCosto(daAnalizzare);
    dillo(`modello: ${MODELLO} ($${PREZZO.input}/1M input, $${PREZZO.output}/1M output)`);
    dillo(`chiamate da fare: ${stima.chiamate}`);
    dillo(`costo stimato: ~$${stima.dollari.toFixed(4)}  (stima locale, il costo reale arriva dai campi usage)`);

    const client = nuovoClient();
    const uso = { input: 0, output: 0 };
    for (const g of daAnalizzare) {
      const r = await generaNota(client, g);
      if (!r.ok) {
        s.note.fallite++;
        dillo(`${g.nome}: ${r.errore}`);
      } else {
        uso.input += r.uso.input;
        uso.output += r.uso.output;
        salvaNota(g.player_id, conFonti(r.testo, g.articoli));
        s.note.fatte++;
        dillo(`${g.nome.padEnd(20)} nota salvata (${g.articoli.length} articoli, ${r.uso.input}+${r.uso.output} token)`);
      }
      su(s);
    }
    s.note.costo = costoReale(uso);
    chiudi('fatta', `note generate: ${s.note.fatte} | fallite: ${s.note.fallite} | costo reale: $${costoReale(uso).toFixed(4)}`);
    if (s.note.fallite) avvisa(`${s.note.fallite} note non sono state generate: l'API ha risposto con un errore.`);
  }

  // ---------------------------------------------------------- riepilogo
  fase('fine');
  const ok = s.fonti.filter((f) => f.stato === 'ok');
  const ko = s.fonti.filter((f) => f.stato === 'errore');
  s.riepilogo = {
    fontiTotali: s.fonti.length,
    fontiOk: ok.length,
    fontiKo: ko.length,
    righeScritte: s.fonti.reduce((n, f) => n + (f.righe ?? 0), 0),
    articoliInArchivio: totaliArticoli,
    note: { ...s.note },
  };
  s.esito = 'finita';
  dillo(`riepilogo: ${ok.length} fonti riuscite, ${ko.length} fallite, ${s.riepilogo.righeScritte} righe scritte`);
  for (const f of ko) dillo(`  fallita: ${f.nome} - ${f.errore}`);
  su(s);
  return s;
}
