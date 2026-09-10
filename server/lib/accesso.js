import crypto from 'node:crypto';

/** Una password sola davanti a tutto il sito.
 *
 *  Non e' un sistema di utenti e non vuole diventarlo: c'e' una persona che
 *  usa questa applicazione, e quello che serve e' che non ci arrivi nessun
 *  altro. Niente registrazione, niente ruoli, niente recupero password.
 *
 *  Nessuna libreria nuova: il cookie lo si firma con node:crypto in venti
 *  righe. Aggiungere una dipendenza per un HMAC vorrebbe dire portarsi dietro
 *  il suo albero di dipendenze per il resto della vita del progetto. */

export const NOME_COOKIE = 'fanta_sessione';
/** Trenta giorni: non voglio ridigitarla ogni volta che apro il sito. */
export const DURATA_MS = 30 * 24 * 60 * 60 * 1000;

/** Il sale non e' un segreto: serve solo a fare in modo che la chiave di firma
 *  non sia l'hash nudo della password, cosi' un cookie rubato non e' un passo
 *  verso la password. */
const SALE = 'FantaNexi/sessione/v1';

export const password = () => process.env.SITE_PASSWORD ?? null;
/** Senza password il sito resta aperto. Non si spegne per una variabile
 *  dimenticata: rendersi inaccessibili da soli e' un guasto peggiore di
 *  restare aperti su un indirizzo che nessuno conosce. Ma lo si dice, forte. */
export const protetto = () => !!password();

export const AVVISO_APERTO =
  'SITE_PASSWORD non e\' impostata: il sito e\' raggiungibile da chiunque abbia l\'indirizzo. Impostala fra le variabili d\'ambiente e riavvia.';

const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();

/** Confronto a tempo costante.
 *
 *  Non "===": su stringhe il confronto si ferma al primo carattere diverso, e
 *  quel tempo si misura. Si passa dagli hash perche' timingSafeEqual pretende
 *  due buffer della stessa lunghezza, e due password di lunghezza diversa la
 *  rivelerebbero prima ancora di entrare nella funzione. */
export function passwordGiusta(tentativo) {
  const attesa = password();
  if (!attesa) return false;
  if (typeof tentativo !== 'string' || tentativo.length === 0) return false;
  return crypto.timingSafeEqual(sha(tentativo), sha(attesa));
}

/** La chiave con cui si firma la sessione. Deriva dalla password: cambiarla
 *  invalida tutti i cookie in giro, che e' esattamente quello che si vuole
 *  quando si cambia una password. */
const chiave = () => crypto.createHash('sha256').update(`${SALE}|${password() ?? ''}`, 'utf8').digest();

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const firma = (dati) => crypto.createHmac('sha256', chiave()).update(dati).digest('base64url');

/** Il cookie porta solo una scadenza: non c'e' niente da sapere sull'utente,
 *  e mettere dentro qualcosa in piu' vorrebbe dire spedirlo avanti e indietro
 *  a ogni richiesta senza motivo. */
export function creaSessione(adesso = Date.now()) {
  const dati = b64(JSON.stringify({ scade: adesso + DURATA_MS }));
  return `${dati}.${firma(dati)}`;
}

export function sessioneValida(valore, adesso = Date.now()) {
  if (typeof valore !== 'string' || !valore.includes('.')) return false;
  const i = valore.lastIndexOf('.');
  const dati = valore.slice(0, i);
  const dato = valore.slice(i + 1);
  const atteso = firma(dati);
  // Anche qui a tempo costante: una firma si indovina un byte alla volta se il
  // confronto si ferma al primo diverso.
  if (dato.length !== atteso.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(dato), Buffer.from(atteso))) return false;
  try {
    const { scade } = JSON.parse(Buffer.from(dati, 'base64url').toString('utf8'));
    return typeof scade === 'number' && scade > adesso;
  } catch {
    return false;
  }
}

/** Legge un cookie dall'intestazione. Nessuna libreria: e' una lista di
 *  "nome=valore" separati da punto e virgola. */
export function leggiCookie(intestazione, nome = NOME_COOKIE) {
  for (const pezzo of String(intestazione ?? '').split(';')) {
    const i = pezzo.indexOf('=');
    if (i === -1) continue;
    if (pezzo.slice(0, i).trim() === nome) return decodeURIComponent(pezzo.slice(i + 1).trim());
  }
  return null;
}

/** httpOnly perche' nessuno script deve poterlo leggere; SameSite=Lax perche'
 *  non ci sono richieste da altri siti da permettere; Secure solo su https,
 *  altrimenti in sviluppo su localhost il browser lo scarterebbe e non si
 *  entrerebbe mai. */
export function intestazioneCookie(valore, { sicuro = false, durataMs = DURATA_MS } = {}) {
  const parti = [
    `${NOME_COOKIE}=${encodeURIComponent(valore)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(durataMs / 1000)}`,
  ];
  if (sicuro) parti.push('Secure');
  return parti.join('; ');
}

export const cookieScaduto = ({ sicuro = false } = {}) => intestazioneCookie('', { sicuro, durataMs: 0 });

/** Dietro il proxy di Railway la connessione al processo e' http: e' il
 *  proxy a parlare https col browser, e lo dice in questa intestazione. */
export const suHttps = (req) =>
  String(req.headers['x-forwarded-proto'] ?? req.protocol ?? '').split(',')[0].trim() === 'https';

/** Le rotte che devono restare aperte, e perche'.
 *  Sono due sole, e nessuna delle due dice niente su di me: senza questo
 *  elenco non si entrerebbe mai (login) e Railway dichiarerebbe morto il
 *  servizio (health). */
export const APERTE = new Set(['/api/login', '/api/health']);
