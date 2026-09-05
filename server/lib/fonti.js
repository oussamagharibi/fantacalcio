import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../db.js';
import { scaricaSePermesso, ErroreHttp } from './web.js';
import { INGRESSI_SKY, scegliLinkSky } from './infortuni.js';

export const FONTI_PATH = process.env.FONTI_PATH ?? path.join(DATA_DIR, 'fonti.json');

/** Seed scritto al primo avvio. Da li' in poi il file si modifica a mano:
 *  aggiungere una fonte non richiede di toccare il codice. */
const SEED = [
  { nome: 'Fantacalcio probabili', attiva: true, tipo: 'pagina', url: 'https://www.fantacalcio.it/probabili-formazioni-serie-a' },
  { nome: 'Fantacalcio infortunati', attiva: true, tipo: 'pagina', url: 'https://www.fantacalcio.it/infortunati-serie-a' },
  { nome: 'Di Marzio', attiva: true, tipo: 'rss', url: null },
  { nome: 'Gazzetta Serie A', attiva: false, tipo: 'rss', url: null },
  { nome: 'Sky Sport calcio', attiva: false, tipo: 'rss', url: null },
  { nome: 'Sport Mediaset', attiva: false, tipo: 'rss', url: null },
  { nome: 'Corriere dello Sport', attiva: false, tipo: 'rss', url: null },
  { nome: 'TuttoMercatoWeb', attiva: false, tipo: 'rss', url: null },
  { nome: 'Fantacalcio rigoristi', attiva: false, tipo: 'pagina', url: 'https://www.fantacalcio.it/rigoristi-serie-a' },
  { nome: 'SOS Fanta indisponibili', attiva: true, tipo: 'pagina', url: 'https://www.sosfanta.com/indisponibili-e-squalificati/tabella-indisponibili-seriea-fantacalcio-asta-infortunati-tempi-recupero-squalificati-diffidati/' },
  { nome: 'Mondocalcio infortunati', attiva: true, tipo: 'pagina', url: 'https://www.mondocalciomagazine.it/infortunati-serie-a/' },
  // L'url di Sky cambia ogni giornata: si scopre, non si fissa.
  { nome: 'Sky indisponibili', attiva: true, tipo: 'pagina', url: null },
];

/** Homepage da cui scoprire il feed quando url e' null. Non e' un elenco di
 *  feed: quelli si scoprono e si scrivono nel json. Per una fonte nuova basta
 *  aggiungere "home" a mano nel file, senza passare da qui. */
const HOMEPAGE = {
  'di marzio': 'https://www.gianlucadimarzio.com',
  'gazzetta serie a': 'https://www.gazzetta.it',
  'sky sport calcio': 'https://sport.sky.it',
  'sport mediaset': 'https://www.sportmediaset.mediaset.it',
  'corriere dello sport': 'https://www.corrieredellosport.it',
  tuttomercatoweb: 'https://www.tuttomercatoweb.com',
};

export function leggiFonti() {
  if (!fs.existsSync(FONTI_PATH)) {
    fs.mkdirSync(path.dirname(FONTI_PATH), { recursive: true });
    fs.writeFileSync(FONTI_PATH, JSON.stringify(SEED, null, 2) + '\n');
    return { fonti: structuredClone(SEED), creato: true };
  }
  return { fonti: JSON.parse(fs.readFileSync(FONTI_PATH, 'utf8')), creato: false };
}

export const salvaFonti = (fonti) => fs.writeFileSync(FONTI_PATH, JSON.stringify(fonti, null, 2) + '\n');

/** Cerca <link type="application/rss+xml"> nell'head. Prende il primo href
 *  utile; se non c'e', non si inventa un URL: la fonte viene marcata. */
export function trovaFeed(html, base) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rss\+xml|atom\+xml/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      return new URL(href, base).toString();
    } catch {
      continue;
    }
  }
  return null;
}

/** Fonti a pagina il cui indirizzo cambia nel tempo e va scoperto ogni volta.
 *  Oggi ce n'e' una: l'articolo settimanale di Sky, il cui url contiene data e
 *  numero di giornata. Si prova un ingresso alla volta e ci si ferma al primo
 *  che porta un link buono. */
const DA_SCOPRIRE = {
  'sky indisponibili': { ingressi: INGRESSI_SKY, scegli: scegliLinkSky },
};

/** Come risolviFeed, ma per le pagine: l'url trovato finisce in fonti.json e
 *  la volta dopo non si riscopre. Se non si trova, la fonte viene marcata con
 *  l'errore e il giro prosegue con le altre.
 *  L'url NON si ricicla fra un giro e l'altro: quello di Sky vale per una
 *  giornata sola, quindi si riparte sempre dalla ricerca. */
export async function risolviPagine(fonti, log = () => {}) {
  let modificato = false;
  for (const f of fonti) {
    const regola = DA_SCOPRIRE[f.nome.trim().toLowerCase()];
    if (!f.attiva || f.tipo !== 'pagina' || !regola) continue;
    const prima = f.url;
    f.url = null;
    let trovato = null;
    for (const ingresso of regola.ingressi) {
      try {
        const risposta = await scaricaSePermesso(ingresso);
        if (!risposta) {
          log(`${f.nome}: robots.txt vieta ${ingresso}`);
          continue;
        }
        trovato = regola.scegli(risposta.testo, risposta.url);
        if (trovato) break;
      } catch (e) {
        log(`${f.nome}: ${e instanceof ErroreHttp ? `HTTP ${e.stato}` : e.message} su ${ingresso}`);
      }
    }
    if (trovato) {
      f.url = trovato;
      delete f.errore;
      log(`${f.nome}: url scoperto -> ${trovato}`);
    } else {
      f.errore = `url non trovato: nessun link che corrisponde allo schema in ${regola.ingressi.length} pagine provate`;
      log(`${f.nome}: ${f.errore}`);
    }
    if (f.url !== prima || f.errore) modificato = true;
  }
  if (modificato) salvaFonti(fonti);
  return modificato;
}

/** Risolve gli url mancanti e riscrive fonti.json, cosi' la volta dopo non
 *  serve riscoprirli. Un fallimento marca la fonte e non ferma le altre. */
export async function risolviFeed(fonti, log = () => {}) {
  let modificato = false;
  for (const f of fonti) {
    if (!f.attiva || f.tipo !== 'rss' || f.url) continue;
    const home = f.home ?? HOMEPAGE[f.nome.trim().toLowerCase()];
    if (!home) {
      f.errore = 'feed non trovato: nessuna homepage da cui partire (aggiungi "home" in fonti.json)';
      modificato = true;
      log(`${f.nome}: ${f.errore}`);
      continue;
    }
    try {
      const risposta = await scaricaSePermesso(home);
      if (!risposta) {
        f.errore = 'feed non trovato: robots.txt vieta la homepage';
      } else {
        const feed = trovaFeed(risposta.testo, risposta.url);
        if (feed) {
          f.url = feed;
          f.home = home;
          delete f.errore;
          modificato = true;
          log(`${f.nome}: feed scoperto -> ${feed}`);
          continue;
        }
        f.errore = 'feed non trovato';
      }
    } catch (e) {
      f.errore = `feed non trovato: ${e instanceof ErroreHttp ? `HTTP ${e.stato}` : e.message}`;
    }
    modificato = true;
    log(`${f.nome}: ${f.errore}`);
  }
  if (modificato) salvaFonti(fonti);
  return fonti;
}
