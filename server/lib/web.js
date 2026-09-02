import { setTimeout as attendi } from 'node:timers/promises';

/** Accesso alla rete per il modulo notizie. Tutto passa da qui, cosi' le regole
 *  di educazione valgono per forza: un solo User-Agent, una richiesta alla volta,
 *  due secondi di distanza, robots.txt rispettato. */

export const USER_AGENT =
  'FantaCalcio-Asta/1.0 (strumento personale per asta fantacalcio; contatto: utente del repo oussamagharibi/fantacalcio)';
export const PAUSA_MS = 2000;
const TIMEOUT_MS = 20_000;

let ultimaRichiesta = 0;
let coda = Promise.resolve();

/** Serializza tutte le richieste e mette almeno PAUSA_MS fra una e l'altra.
 *  Niente parallelismo: la coda e' una catena di promise, non un pool. */
function inCoda(fn) {
  const risultato = coda.then(async () => {
    const attesa = PAUSA_MS - (Date.now() - ultimaRichiesta);
    if (attesa > 0) await attendi(attesa);
    try {
      return await fn();
    } finally {
      ultimaRichiesta = Date.now();
    }
  });
  coda = risultato.then(
    () => {},
    () => {}
  );
  return risultato;
}

export class ErroreHttp extends Error {
  constructor(stato, url) {
    super(`HTTP ${stato} su ${url}`);
    this.name = 'ErroreHttp';
    this.stato = stato;
    this.url = url;
  }
}

/** GET grezza, gia' in coda e con lo User-Agent giusto. */
export const scarica = (url, accept = 'text/html,application/xhtml+xml') =>
  inCoda(async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'it-IT,it;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new ErroreHttp(res.status, url);
    return { testo: await res.text(), url: res.url };
  });

const regolePerHost = new Map();

/** robots.txt, una volta per host. Se non si riesce a leggerlo si assume
 *  permesso: e' la lettura standard di un 404 su robots. */
async function regole(origin) {
  if (regolePerHost.has(origin)) return regolePerHost.get(origin);
  let vietati = [];
  try {
    const { testo } = await scarica(`${origin}/robots.txt`, 'text/plain');
    vietati = analizzaRobots(testo);
  } catch {
    vietati = [];
  }
  regolePerHost.set(origin, vietati);
  return vietati;
}

/** Prende i Disallow dei gruppi che valgono per noi: "*" e il nostro UA.
 *  Un Disallow vuoto significa "tutto permesso" e va ignorato. */
export function analizzaRobots(testo) {
  const vietati = [];
  let gruppoNostro = false;
  for (const grezza of testo.split(/\r?\n/)) {
    const riga = grezza.replace(/#.*$/, '').trim();
    if (!riga) continue;
    const [chiaveGrezza, ...resto] = riga.split(':');
    const chiave = chiaveGrezza.trim().toLowerCase();
    const valore = resto.join(':').trim();
    if (chiave === 'user-agent') {
      const ua = valore.toLowerCase();
      gruppoNostro = ua === '*' || USER_AGENT.toLowerCase().includes(ua);
    } else if (chiave === 'disallow' && gruppoNostro && valore) {
      vietati.push(valore);
    }
  }
  return vietati;
}

export async function permesso(url) {
  const u = new URL(url);
  const vietati = await regole(u.origin);
  const percorso = u.pathname + u.search;
  return !vietati.some((p) => percorso.startsWith(p.replace(/\*$/, '')));
}

/** GET che prima chiede il permesso a robots.txt. Ritorna null se vietata. */
export async function scaricaSePermesso(url, accept) {
  if (!(await permesso(url))) return null;
  return scarica(url, accept);
}
