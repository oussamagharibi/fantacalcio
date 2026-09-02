import { getDb, tx } from '../db.js';
import { scaricaSePermesso, ErroreHttp } from './web.js';
import { normalizza, normalizzaConIndici } from './testo.js';

// Rieportate perche' news.js e le prove le importano da qui.
export { normalizza, normalizzaConIndici };

export const GIORNI_MAX = 15;
/** Tetto per fonte: senza, un feed lungo diventa decine di richieste da 2s. */
export const MAX_ARTICOLI_PER_FONTE = 20;

const entita = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»',
  agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  Agrave: 'À', Egrave: 'È', Eacute: 'É', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù',
  ccedil: 'ç', ntilde: 'ñ', deg: '°', euro: '€', hellip: '…', mdash: '—', ndash: '–',
  copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', times: '×', shy: '',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};
/** Le entita' accentate seguono tutte lo schema lettera + nome dell'accento
 *  (&euml; &agrave; &ntilde; ...). Ricomporle dal segno diacritico copre tutto
 *  il Latin-1 senza tenere una tabella di duecento voci sempre incompleta. */
const DIACRITICI = { grave: '̀', acute: '́', circ: '̂', tilde: '̃', uml: '̈', ring: '̊', cedil: '̧' };
const accentata = (nome) => {
  const m = /^([a-z])(grave|acute|circ|tilde|uml|ring|cedil)$/i.exec(nome);
  return m ? (m[1] + DIACRITICI[m[2].toLowerCase()]).normalize('NFC') : null;
};

const decodifica = (s) =>
  String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    // Ordine voluto: prima la voce esatta, poi la regola generale (che distingue
    // maiuscole e minuscole), e solo alla fine il ripiego insensibile al caso.
    .replace(/&([a-z]+);/gi, (t, n) => entita[n] ?? accentata(n) ?? entita[n.toLowerCase()] ?? t);

/** Contorno del sito: non e' il pezzo, e nominando mezza Serie A falsava sia il
 *  match sui cognomi sia il controllo sulla squadra. */
const TAG_CONTORNO = ['script', 'style', 'noscript', 'svg', 'nav', 'aside', 'footer', 'header', 'form', 'iframe'];
/** Contenitori di link correlati, riconosciuti dalla classe o dall'id. */
const CLASSI_RUMORE =
  /(correlat|related|leggi-anche|leggi_anche|piu-letti|most-read|sidebar|side-bar|menu|breadcrumb|social|condivid|share|newsletter|commenti|comment|banner|pubblicit|advert|adv-|promo|tag-list|footer|widget)/i;

/** Toglie un elemento e tutto il suo contenuto contando i livelli annidati.
 *  Una regex non-greedy si fermerebbe al primo </div>, lasciando dentro meta'
 *  del blocco e portandosi via un pezzo di articolo. */
function rimuoviElementi(html, tag, quando) {
  const apertura = new RegExp(`<(${tag.join('|')})\\b([^>]*)>`, 'gi');
  let out = '';
  let i = 0;
  for (;;) {
    apertura.lastIndex = i;
    const m = apertura.exec(html);
    if (!m) break;
    const fineApertura = m.index + m[0].length;
    if (!quando(m[2])) {
      out += html.slice(i, fineApertura);
      i = fineApertura;
      continue;
    }
    const dentro = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, 'gi');
    dentro.lastIndex = fineApertura;
    let livello = 1;
    let fine = html.length;
    for (let d = dentro.exec(html); d; d = dentro.exec(html)) {
      livello += d[1] ? -1 : 1;
      if (livello === 0) {
        fine = dentro.lastIndex;
        break;
      }
    }
    out += html.slice(i, m.index);
    i = fine;
  }
  return out + html.slice(i);
}

/** Il contenuto di ogni <tag> bilanciato presente nel documento. */
function elementi(html, tag) {
  const apertura = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const trovati = [];
  for (let m = apertura.exec(html); m; m = apertura.exec(html)) {
    const inizio = m.index + m[0].length;
    const dentro = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    dentro.lastIndex = inizio;
    let livello = 1;
    for (let d = dentro.exec(html); d; d = dentro.exec(html)) {
      livello += d[1] ? -1 : 1;
      if (livello === 0) {
        trovati.push(html.slice(inizio, d.index));
        break;
      }
    }
  }
  return trovati;
}

/** Isola il pezzo: via il contorno, poi <article> o <main> se ci sono, poi via
 *  i blocchi di correlati rimasti dentro. Fra piu' <article> si prende il piu'
 *  lungo: gli altri sono le anteprime in fondo alla pagina. */
const testoNudo = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;

/** Testo che NON sta dentro un link. Menu, correlati e footer sono quasi solo
 *  link; il pezzo e' quasi solo prosa. E' la differenza che li separa. */
function prosa(html) {
  const link = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? []).join(' ');
  return testoNudo(html) - testoNudo(link);
}

/** Ripiego per le pagine senza tag semantici - e sono tante: gianlucadimarzio.com
 *  non ha nemmeno un <article>, <main> o <nav>, solo div con classi di utilita'.
 *  Si prende il blocco con piu' prosa, e fra quelli che ci vanno vicino il piu'
 *  piccolo: altrimenti vincerebbe sempre il div che avvolge tutta la pagina. */
function bloccoPiuDenso(html) {
  const punteggi = elementi(html, 'div').map((c) => ({ c, p: prosa(c) }));
  if (!punteggi.length) return null;
  const massimo = Math.max(...punteggi.map((x) => x.p));
  if (massimo <= 0) return null;
  const vicini = punteggi.filter((x) => x.p >= massimo * 0.9);
  return vicini.reduce((a, b) => (b.c.length < a.c.length ? b : a)).c;
}

export function contenutoPrincipale(html) {
  let h = rimuoviElementi(String(html ?? ''), TAG_CONTORNO, () => true).replace(/<!--[\s\S]*?-->/g, ' ');
  const semantici = [...elementi(h, 'article'), ...elementi(h, 'main')];
  if (semantici.length) h = semantici.reduce((a, b) => (b.length > a.length ? b : a));
  h = rimuoviElementi(h, ['div', 'section', 'ul', 'ol'], (attr) => CLASSI_RUMORE.test(attr));
  if (!semantici.length) h = bloccoPiuDenso(h) ?? h;
  return h;
}

const senzaTag = (html) =>
  decodifica(
    contenutoPrincipale(html)
      .replace(/<\/(p|div|li|h[1-6]|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

const cerca = (html, ...regexp) => {
  for (const r of regexp) {
    const m = html.match(r);
    if (m?.[1]) return decodifica(m[1]).trim();
  }
  return null;
};

export const titoloDaHtml = (html) =>
  cerca(
    html,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i
  );

/** La data si cerca dove i siti la mettono davvero, in ordine di affidabilita'. */
export function dataDaHtml(html) {
  const grezza = cerca(
    html,
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i
  );
  const d = grezza ? new Date(grezza) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/** Item RSS 2.0 e entry Atom. Solo regexp: i feed sono regolari e una
 *  dipendenza in piu' per questo non si giustifica. */
export function articoliDaRss(xml) {
  const blocchi = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const out = [];
  for (const b of blocchi) {
    const url =
      cerca(b, /<link[^>]*>([^<]+)<\/link>/i) ?? b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
    if (!url) continue;
    const grezza = cerca(b, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i, /<updated[^>]*>([\s\S]*?)<\/updated>/i, /<published[^>]*>([\s\S]*?)<\/published>/i);
    const d = grezza ? new Date(grezza) : null;
    out.push({
      url: url.trim(),
      titolo: cerca(b, /<title[^>]*>([\s\S]*?)<\/title>/i),
      data: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
      sommario: senzaTag(cerca(b, /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i, /<description[^>]*>([\s\S]*?)<\/description>/i) ?? ''),
    });
  }
  return out;
}

const troppoVecchio = (iso, adesso = Date.now()) =>
  iso !== null && adesso - new Date(iso).getTime() > GIORNI_MAX * 24 * 3600 * 1000;

/** Scarica le fonti attive e salva gli articoli nuovi. Un url gia' in tabella
 *  non viene riscaricato: e' la regola che rende il rilancio quasi gratuito. */
export async function raccogli(fonti, log = () => {}) {
  const db = getDb();
  const esistenti = new Set(db.prepare('SELECT url FROM articles').all().map((r) => r.url));
  const ins = db.prepare(
    'INSERT OR IGNORE INTO articles (url, titolo, testo, data, fetched_at, fonte) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const esiti = [];

  for (const f of fonti.filter((x) => x.attiva)) {
    const esito = { nome: f.nome, tipo: f.tipo, url: f.url, scaricati: 0, saltatiGiaPresenti: 0, scartatiPerData: 0, errori: [] };
    esiti.push(esito);
    if (!f.url) {
      esito.errori.push(f.errore ?? 'url mancante');
      log(`${f.nome}: ${esito.errori[0]}`);
      continue;
    }

    let candidati = [];
    try {
      if (f.tipo === 'rss') {
        const risposta = await scaricaSePermesso(f.url, 'application/rss+xml, application/xml, text/xml');
        if (!risposta) throw new Error('robots.txt vieta il feed');
        candidati = articoliDaRss(risposta.testo);
      } else {
        const risposta = await scaricaSePermesso(f.url);
        if (!risposta) throw new Error('robots.txt vieta la pagina');
        candidati = [{ url: risposta.url, titolo: titoloDaHtml(risposta.testo), data: dataDaHtml(risposta.testo), corpo: senzaTag(risposta.testo) }];
      }
    } catch (e) {
      const msg = e instanceof ErroreHttp ? `HTTP ${e.stato}` : e.message;
      esito.errori.push(msg);
      log(`${f.nome}: ${msg} - salto la fonte, le altre proseguono`);
      continue;
    }
    esito.trovati = candidati.length;

    const daPrendere = [];
    for (const c of candidati) {
      if (esistenti.has(c.url)) {
        esito.saltatiGiaPresenti++;
        continue;
      }
      if (troppoVecchio(c.data)) {
        esito.scartatiPerData++;
        continue;
      }
      daPrendere.push(c);
      if (daPrendere.length >= MAX_ARTICOLI_PER_FONTE) break;
    }

    for (const c of daPrendere) {
      let testo = c.corpo ?? null;
      let data = c.data;
      let titolo = c.titolo;
      if (testo === null) {
        // Articolo da feed: il sommario spesso e' una riga, il testo sta sulla pagina.
        try {
          const risposta = await scaricaSePermesso(c.url);
          if (risposta) {
            testo = senzaTag(risposta.testo);
            data ??= dataDaHtml(risposta.testo);
            titolo ??= titoloDaHtml(risposta.testo);
          }
        } catch (e) {
          const msg = e instanceof ErroreHttp ? `HTTP ${e.stato}` : e.message;
          esito.errori.push(`${c.url}: ${msg}`);
          log(`${f.nome}: ${msg} su ${c.url} - salto l'articolo`);
        }
        testo ??= c.sommario ?? '';
      }
      if (troppoVecchio(data)) {
        esito.scartatiPerData++;
        continue;
      }
      ins.run(c.url, titolo, testo, data, new Date().toISOString(), f.nome);
      esistenti.add(c.url);
      esito.scaricati++;
    }
  }
  return esiti;
}

// ---------------------------------------------------------------- associazione

/** Nel listone i nomi sono abbreviati: "Martinez L.", "Esposito F.P.".
 *  I pezzi puntati sono iniziali del nome proprio e vanno via; quel che resta
 *  e' il cognome, anche se composto ("De Ketelaere"). */
export function cognomeDi(nome) {
  const parti = normalizza(nome)
    .replace(/[^a-z0-9.\s'-]/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !p.endsWith('.'));
  return parti.join(' ').trim();
}

export const CARATTERI_MINIMI = 5;
/** Contesto tenuto attorno al punto in cui il cognome compare. Le pagine di
 *  elenco (probabili formazioni, infortunati) sono lunghe decine di migliaia
 *  di caratteri e nominano tutti: tagliarne l'inizio darebbe al modello un
 *  pezzo che quel giocatore non lo cita nemmeno. */
export const CONTESTO_CARATTERI = 700;

/** Finestra centrata sulla prima occorrenza, allargata ai confini di parola. */
export function estrattoAttorno(testo, indici, posizione, lunghezza) {
  const inizio = Math.max(0, (indici[posizione] ?? 0) - CONTESTO_CARATTERI);
  const fine = Math.min(testo.length, (indici[posizione + lunghezza - 1] ?? testo.length) + CONTESTO_CARATTERI);
  const taglio = testo.slice(inizio, fine).trim();
  return (inizio > 0 ? '...' : '') + taglio + (fine < testo.length ? '...' : '');
}

/** Modi alternativi di nominare una squadra. Solo forme inequivocabili: i
 *  soprannomi di colore ("nerazzurri" e' Inter ma anche Atalanta) farebbero
 *  piu' danni del filtro che stiamo aggiungendo. Si estende qui. */
const ALIAS_SQUADRE = {
  juventus: ['juve'],
  inter: ['internazionale'],
  verona: ['hellas', 'hellas verona'],
  roma: ['as roma'],
  milan: ['ac milan'],
  napoli: ['ssc napoli'],
  fiorentina: ['acf fiorentina', 'viola'],
  atalanta: ['dea'],
};

/** Quanto vicina deve stare la squadra al cognome perche' la citazione valga.
 *  Sull'intera finestra di estratto (1400 caratteri) un terzo delle associazioni
 *  passava per pura coincidenza: in un pezzo di calciomercato si nominano quattro
 *  o cinque squadre. L'estratto passato al modello resta largo, e' solo il
 *  controllo che si stringe. */
export const VICINANZA_SQUADRA = 200;

/** Quante occorrenze dello stesso cognome guardare in un articolo. Serve
 *  perche' un pezzo puo' nominare due omonimi in due contesti diversi: si
 *  cerca la finestra che cita la squadra giusta, non solo la prima. */
const MAX_OCCORRENZE = 10;

const regexSquadra = new Map();
function citaSquadra(testoNormalizzato, squadra) {
  const chiave = normalizza(squadra);
  if (!regexSquadra.has(chiave)) {
    const forme = [chiave, ...(ALIAS_SQUADRE[chiave] ?? [])].map((s) =>
      s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    );
    regexSquadra.set(chiave, new RegExp(`(?<![a-z0-9])(?:${forme.join('|')})(?![a-z0-9])`));
  }
  return regexSquadra.get(chiave).test(testoNormalizzato);
}

/** Associa articoli e giocatori per cognome. Solo cognomi di 5+ caratteri:
 *  sotto quella soglia i falsi positivi superano le associazioni buone.
 *  Il cognome da solo pero' non basta - "David" e' anche un nome proprio, e
 *  due Martinez in rosa non si distinguono - quindi l'articolo deve citare
 *  anche la squadra del giocatore, nel titolo o nella finestra di estratto. */
export function associa({ giorni = GIORNI_MAX } = {}) {
  const db = getDb();
  const limite = new Date(Date.now() - giorni * 24 * 3600 * 1000).toISOString();
  const articoli = db
    .prepare('SELECT url, titolo, testo, data, fonte, fetched_at FROM articles WHERE coalesce(data, fetched_at) >= ?')
    .all(limite);
  const giocatori = db.prepare('SELECT id, nome, squadra, ruolo FROM players WHERE assente_dal IS NULL').all();

  const perCognome = new Map();
  const troppoCorti = [];
  for (const g of giocatori) {
    const cognome = cognomeDi(g.nome);
    if (cognome.replace(/\s/g, '').length < CARATTERI_MINIMI) {
      troppoCorti.push({ ...g, cognome });
      continue;
    }
    if (!perCognome.has(cognome)) perCognome.set(cognome, []);
    perCognome.get(cognome).push(g);
  }

  const associazioni = [];
  const ambigui = new Map();
  const scartatiSenzaSquadra = { univoci: 0, ambigui: 0, esempi: [] };
  const nonRisolvibili = [];
  for (const a of articoli) {
    const originale = `${a.titolo ?? ''}\n${a.testo ?? ''}`;
    const { testo, indici } = normalizzaConIndici(originale);
    const titoloNorm = normalizza(a.titolo ?? '');
    for (const [cognome, candidati] of perCognome) {
      const re = new RegExp(
        `(?<![a-z0-9])${cognome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![a-z0-9])`,
        'g'
      );
      const finestre = [];
      for (let m = re.exec(testo); m && finestre.length < MAX_OCCORRENZE; m = re.exec(testo)) {
        finestre.push({
          estratto: estrattoAttorno(originale, indici, m.index, m[0].length),
          // Il controllo sulla squadra guarda solo qui intorno, non tutto
          // l'estratto: in un pezzo di mercato ci finiscono quattro o cinque
          // squadre e la co-occorrenza diventa casuale.
          vicinanze: testo.slice(Math.max(0, m.index - VICINANZA_SQUADRA), m.index + m[0].length + VICINANZA_SQUADRA),
        });
      }
      if (!finestre.length) continue;
      if (candidati.length > 1) ambigui.set(cognome, candidati);

      // Un candidato passa solo se una delle sue finestre, o il titolo, nomina
      // la sua squadra. Cosi' due omonimi si separano da soli, e "David" citato
      // come nome proprio non finisce addosso al David della Juventus.
      const superstiti = [];
      for (const g of candidati) {
        const i = finestre.findIndex((f) => citaSquadra(f.vicinanze, g.squadra));
        if (i >= 0) superstiti.push({ g, estratto: finestre[i].estratto, chiave: `f${i}` });
        // Il titolo vale solo per i cognomi univoci: dice di cosa parla il pezzo,
        // non quale dei due omonimi e' quello nominato. Su "Coppa Italia, il Monza
        // elimina il Torino" faceva passare Colombo L. (Monza) su un tabellone in
        // cui il gol era di Colombo del Genoa.
        else if (candidati.length === 1 && citaSquadra(titoloNorm, g.squadra))
          superstiti.push({ g, estratto: finestre[0].estratto, chiave: 'titolo' });
        else {
          if (candidati.length > 1) scartatiSenzaSquadra.ambigui++;
          else scartatiSenzaSquadra.univoci++;
          if (scartatiSenzaSquadra.esempi.length < 12)
            scartatiSenzaSquadra.esempi.push({ nome: g.nome, squadra: g.squadra, cognome, fonte: a.fonte, titolo: a.titolo, ambiguo: candidati.length > 1 });
        }
      }

      // Due omonimi risolti dalla STESSA citazione non sono risolti affatto:
      // stessa squadra (Martinez L. e Martinez Jo., entrambi Inter) oppure due
      // squadre nominate nella stessa finestra. Meglio nessuna nota che una
      // nota attaccata al giocatore sbagliato: cadono tutti.
      const perChiave = new Map();
      for (const s of superstiti) perChiave.set(s.chiave, [...(perChiave.get(s.chiave) ?? []), s]);
      for (const [, gruppo] of perChiave) {
        if (gruppo.length > 1) {
          nonRisolvibili.push({ cognome, giocatori: gruppo.map((s) => `${s.g.nome} (${s.g.squadra})`), fonte: a.fonte, titolo: a.titolo });
          continue;
        }
        const s = gruppo[0];
        associazioni.push({ player_id: s.g.id, nome: s.g.nome, squadra: s.g.squadra, ruolo: s.g.ruolo, cognome, url: a.url, titolo: a.titolo, fonte: a.fonte, data: a.data, estratto: s.estratto, ambiguo: candidati.length > 1 });
      }
    }
  }
  return {
    articoli,
    associazioni,
    ambigui: [...ambigui.entries()].map(([cognome, g]) => ({ cognome, giocatori: g })),
    troppoCorti,
    scartatiSenzaSquadra,
    nonRisolvibili,
  };
}

/** Raggruppa per giocatore, tenendo solo chi ha abbastanza articoli. */
export function perGiocatore(associazioni, minimo = 2) {
  const mappa = new Map();
  for (const a of associazioni) {
    if (!mappa.has(a.player_id)) mappa.set(a.player_id, { player_id: a.player_id, nome: a.nome, squadra: a.squadra, ruolo: a.ruolo, ambiguo: false, articoli: [] });
    const v = mappa.get(a.player_id);
    v.ambiguo = v.ambiguo || a.ambiguo;
    if (!v.articoli.some((x) => x.url === a.url)) v.articoli.push(a);
  }
  return [...mappa.values()].filter((g) => g.articoli.length >= minimo);
}

export function salvaNota(playerId, testo) {
  return tx((d) => d.prepare('UPDATE players SET note = ?, note_generated_at = ? WHERE id = ?').run(testo, new Date().toISOString(), playerId).changes);
}
