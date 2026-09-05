import { scaricaSePermesso, ErroreHttp } from './web.js';
import { abbina, salvaSegnali } from './fantacalcio.js';

/** Infortuni, dubbi, squalifiche e diffide da tre siti che pubblicano liste
 *  strutturate per squadra. Parser dedicati, sul modello di fantacalcio.js:
 *  il nome e la squadra si prendono dalla STRUTTURA della pagina, non dal
 *  testo, cosi' l'abbinamento non dipende da come e' scritta una frase.
 *
 *  I quattro tipi restano distinti. "Out" e "in dubbio" sono due decisioni
 *  diverse in asta, e appiattirli su "infortunio" butterebbe via proprio la
 *  differenza che serve. */

export const TIPI = ['infortunio', 'dubbio', 'squalifica', 'diffida'];

const testo = (html) =>
  String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Un testo lungo una riga: la descrizione del sito, senza il nome davanti
 *  che sarebbe ripetuto, e senza code pubblicitarie. */
const sintetico = (s, max = 180) => {
  const t = testo(s).replace(/^[-–—:\s]+/, '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// -------------------------------------------------------------- SOS Fanta

/** SOS Fanta e' un articolo, non una tabella. La struttura e' una sequenza di
 *  paragrafi:
 *    <p><strong>ATALANTA</strong></p>          la squadra, tutta maiuscola
 *    <p>Infortunati:</p>                       la categoria
 *    <p><strong>Hien</strong> - Fuori per...</p>   un giocatore
 *    <p>Squalificati: -</p>                    categoria vuota
 *  Si scorre in ordine tenendo squadra e categoria correnti: e' la struttura a
 *  dire di chi si sta parlando, non il testo della frase. */
const CATEGORIE = [
  [/^infortunat/i, 'infortunio'],
  [/^squalificat/i, 'squalifica'],
  [/^diffidat/i, 'diffida'],
];

export function leggiSosFanta(html) {
  const voci = [];
  let squadra = null;
  let categoria = null;
  for (const blocco of String(html ?? '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const dentro = blocco[1];
    const riga = testo(dentro);
    if (!riga) continue;

    const forte = /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(dentro);
    const etichetta = forte ? testo(forte[1]) : null;

    // Squadra: il paragrafo e' fatto solo dal grassetto, tutto maiuscolo.
    if (etichetta && etichetta === riga && etichetta === etichetta.toUpperCase() && /^[A-Z .'-]{4,}$/.test(etichetta)) {
      squadra = etichetta;
      categoria = null;
      continue;
    }
    const trovata = CATEGORIE.find(([re]) => re.test(riga));
    if (trovata && (!etichetta || etichetta.length < riga.length)) {
      categoria = trovata[1];
      // "Infortunati: -" vuol dire nessuno, e la categoria resta comunque
      // aperta: la riga dopo sara' un'altra categoria o un'altra squadra.
      continue;
    }
    if (!squadra || !categoria || !etichetta) continue;
    // Il giocatore: grassetto col nome, poi il trattino e la descrizione.
    const descrizione = riga.slice(etichetta.length);
    if (!/^\s*[-–—]/.test(descrizione)) continue;
    voci.push({
      id: null,
      nome: etichetta,
      squadra,
      // Il tipo viene dalla categoria, cioe' dalla struttura, e basta.
      // NON dalla frase: qui "in dubbio per la 6a" vuol dire "rientro previsto
      // intorno alla 6a giornata", non "oggi e' in forse" - lo scrivono su 40
      // righe su 41, accanto a "Fuori per una lesione". Leggerlo come dubbio
      // marcava come incerti quasi tutti gli infortunati veri.
      // Un dubbio attuale SOS Fanta non lo pubblica: lo pubblica Mondocalcio,
      // con un badge fatto apposta.
      tipo: categoria,
      testo: sintetico(descrizione),
    });
  }
  return voci;
}

// ------------------------------------------------------------ Mondocalcio

/** Mondocalcio ha un markup esplicito, il piu' comodo dei tre:
 *    <div class="infteam"><h2>Juventus <span>9</span></h2>
 *      <div class="infrow">
 *        <span class="infnome">K. Yildiz</span>
 *        <span class="infmot">Infortunio al piede</span>
 *        <span class="infbadge out">Out</span>
 *      </div>
 *  Il badge dice il tipo: "out" indisponibile, "dub" in dubbio. */
export function leggiMondocalcio(html) {
  const voci = [];
  // Si spezza sui confini fra squadre invece di cercare la fine di ogni blocco:
  // una lookahead che indovinasse il tag di chiusura perdeva l'ultima squadra
  // dell'elenco, e con lei le sue righe.
  for (const dentro of String(html ?? '').split(/<div\b[^>]*class="[^"]*\binfteam\b[^"]*"[^>]*>/i).slice(1)) {
    const squadra = testo(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(dentro)?.[1] ?? '').replace(/\s*\d+\s*$/, '');
    if (!squadra) continue;
    for (const riga of dentro.matchAll(
      /<span[^>]*class="infnome"[^>]*>([\s\S]*?)<\/span>\s*<span[^>]*class="infmot"[^>]*>([\s\S]*?)<\/span>\s*<span[^>]*class="infbadge\s+([a-z]+)"[^>]*>([\s\S]*?)<\/span>/gi
    )) {
      const badge = riga[3].toLowerCase();
      voci.push({
        id: null,
        nome: testo(riga[1]),
        squadra,
        tipo: badge.startsWith('dub') ? 'dubbio' : 'infortunio',
        testo: `${testo(riga[4])} — ${sintetico(riga[2], 90)}`,
      });
    }
  }
  return voci;
}

// -------------------------------------------------------------------- Sky

/** L'articolo settimanale di Sky ha un URL che cambia ogni giornata:
 *    /calcio/serie-a/AAAA/MM/GG/serie-a-indisponibili-...-giornata-N
 *  Non si fissa: si scopre cercando il link piu' recente che corrisponde allo
 *  schema, come si fa gia' con i feed RSS. */
export const SCHEMA_SKY =
  /\/calcio\/serie-a\/(20\d{2})\/(\d{2})\/(\d{2})\/[a-z0-9-]*(?:indisponibili|infortunati|squalificati)[a-z0-9-]*/gi;

/** Le pagine da cui provare a scoprirlo, in ordine. */
export const INGRESSI_SKY = [
  'https://sport.sky.it/calcio/serie-a',
  'https://sport.sky.it/fantacalcio',
];

/** Fra i candidati vince il piu' recente per data nell'URL: e' l'articolo
 *  della giornata in corso. */
export function scegliLinkSky(html, base = 'https://sport.sky.it') {
  const trovati = [...new Set([...String(html ?? '').matchAll(SCHEMA_SKY)].map((m) => m[0]))];
  if (!trovati.length) return null;
  const conData = trovati.map((p) => {
    const [, a, m, g] = /\/(20\d{2})\/(\d{2})\/(\d{2})\//.exec(p) ?? [];
    return { percorso: p, quando: `${a}${m}${g}` };
  });
  conData.sort((x, y) => y.quando.localeCompare(x.quando));
  return new URL(conData[0].percorso, base).toString();
}

/** Il parser di Sky. ATTENZIONE: e' l'unico dei tre che NON ho potuto provare
 *  su HTML reale - l'articolo della settimana non era pubblicato, o comunque
 *  non raggiungibile dalle sezioni di Sky. Percio' non indovina: pretende una
 *  struttura riconoscibile (intestazioni di squadra seguite da voci di elenco)
 *  e, se non la trova, restituisce zero voci con un motivo. Meglio nessuna
 *  riga che righe inventate da un markup che non ho visto. */
export function leggiSky(html) {
  const src = String(html ?? '');
  const blocchi = [
    ...src.matchAll(/<(h2|h3)\b[^>]*>([\s\S]*?)<\/\1>|<li\b[^>]*>([\s\S]*?)<\/li>/gi),
  ];
  const voci = [];
  let squadra = null;
  for (const b of blocchi) {
    if (b[2] !== undefined) {
      const t = testo(b[2]);
      squadra = t && t.split(' ').length <= 3 ? t : null;
      continue;
    }
    const t = testo(b[3]);
    if (!squadra || !t || !/[:–—-]/.test(t)) continue;
    const [nome, ...resto] = t.split(/\s*[:–—-]\s*/);
    if (!nome || nome.split(' ').length > 4) continue;
    const descrizione = resto.join(' - ');
    voci.push({
      id: null,
      nome,
      squadra,
      tipo: /squalific/i.test(descrizione)
        ? 'squalifica'
        : /diffid/i.test(descrizione)
          ? 'diffida'
          : /dubbio|valutazione|da valutare/i.test(descrizione)
            ? 'dubbio'
            : 'infortunio',
      testo: sintetico(descrizione),
    });
  }
  return voci.length
    ? voci
    : Object.assign([], { motivo: 'struttura non riconosciuta: nessuna intestazione di squadra con voci di elenco' });
}

// ------------------------------------------------------------------ registro

export const PAGINE_INFORTUNI = [
  { fonte: 'SOS Fanta indisponibili', leggi: leggiSosFanta },
  { fonte: 'Mondocalcio infortunati', leggi: leggiMondocalcio },
  { fonte: 'Sky indisponibili', leggi: leggiSky, scopri: true },
];

export const FONTI_INFORTUNI = new Set(PAGINE_INFORTUNI.map((p) => p.fonte));

/** Scarica e analizza le pagine attive. Una che fallisce non ferma le altre,
 *  e i suoi segnali restano quelli del giro precedente. */
export async function raccogliInfortuni(fonti, log = () => {}) {
  const esiti = [];
  for (const p of PAGINE_INFORTUNI) {
    const f = fonti.find((x) => x.nome === p.fonte);
    if (!f?.attiva) continue;
    const esito = { fonte: p.fonte, url: f.url ?? null, lette: 0, perTipo: {}, abbinate: 0, nonAbbinati: [], errore: null };
    esiti.push(esito);
    if (!f.url) {
      esito.errore = f.errore ?? 'nessun url: non scoperto';
      log(`${p.fonte}: ${esito.errore} - salto, le altre proseguono`);
      continue;
    }
    try {
      const risposta = await scaricaSePermesso(f.url);
      if (!risposta) throw new Error('robots.txt vieta la pagina');
      const voci = p.leggi(risposta.testo);
      if (!voci.length && voci.motivo) throw new Error(voci.motivo);
      esito.lette = voci.length;
      for (const v of voci) esito.perTipo[v.tipo] = (esito.perTipo[v.tipo] ?? 0) + 1;

      const { abbinate, nonAbbinati } = abbina(voci);
      esito.nonAbbinati = nonAbbinati;
      const data = new Date().toISOString();
      // Una riscrittura per tipo, dentro questa fonte soltanto: quello che
      // hanno scritto le altre fonti resta dov'e'.
      for (const tipo of TIPI) {
        const righe = abbinate.filter((r) => r.tipo === tipo);
        const viste = new Set();
        const uniche = righe.filter((r) => !viste.has(r.player_id) && viste.add(r.player_id));
        const { scritti } = salvaSegnali(tipo, uniche, p.fonte, data);
        esito.abbinate += scritti;
      }
    } catch (e) {
      esito.errore = e instanceof ErroreHttp ? `HTTP ${e.stato}` : e.message;
      log(`${p.fonte}: ${esito.errore} - salto la pagina, le altre proseguono`);
    }
  }
  return esiti;
}
