import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { getDb, backup, DB_PATH, DATA_DIR, SU_VOLUME, ROOT } from './db.js';
import { statoConfig, validaConfig, salvaConfig, bloccata, numeroAcquisti } from './lib/config.js';
import { scaricaListone, salvaEImporta, ErroreDownload, ErroreListone } from './lib/listone.js';
import {
  stato,
  registraAcquisto,
  registraUscita,
  annullaUltima,
  annullaGiocatore,
  commutaTarget,
} from './lib/asta.js';
import { salvaEImportaStats } from './lib/stats.js';
import { salvaEImportaXg, ErroreXg } from './lib/understat.js';
import { avviaBatch, statoBatch } from './lib/batch.js';
import { registra, consumo } from './lib/consumo.js';
import { metti, togli } from './lib/rosa.js';
import { MODELLO } from './lib/analisi.js';
import { mimeDaEstensione } from './lib/immagini.js';
import {
  MAX_FOTO,
  analisi as analisiFoto,
  analizza as analizzaFoto,
  annullaConferma as annullaConfermaFoto,
  chiaveMancante as chiaveFotoMancante,
  conferma as confermaFoto,
  confermati as confermatiFoto,
  miaRosa,
  nuovoClient as nuovoClientFoto,
  percorsoFoto,
  salvaAnalisi,
  salvaFoto,
  stima as stimaFoto,
} from './lib/foto.js';
import {
  APERTE,
  AVVISO_APERTO,
  NOME_COOKIE,
  cookieScaduto,
  creaSessione,
  intestazioneCookie,
  leggiCookie,
  passwordGiusta,
  protetto,
  sessioneValida,
  suHttps,
} from './lib/accesso.js';

const PORT = Number(process.env.PORT ?? 3001);
/** 0.0.0.0 e non 127.0.0.1: dentro un container Railway raggiunge il servizio
 *  dall'esterno, e su localhost soltanto non lo vedrebbe. */
const HOST = process.env.HOST ?? '0.0.0.0';

/** Da quando conta "questa sessione" nel pannello dell asta: da quando il
 *  server e acceso. Non e la stessa cosa dell asta - un riavvio azzera il
 *  parziale, non il totale - ma e un momento che si puo nominare, e a schermo
 *  c e scritto quale. */
const DA_QUANDO = new Date().toISOString();

const LOGIN_HTML = fs.readFileSync(path.join(ROOT, 'server', 'login.html'), 'utf8');

const DIST = path.join(ROOT, 'client', 'dist');
const CLIENT_BUILDATO = fs.existsSync(path.join(DIST, 'index.html'));
/** Il listone ufficiale sta sotto i 100 KB: 20 MB e' gia' abbondante e tiene
 *  fuori gli upload per sbaglio senza rischiare di rifiutare un file buono. */
const LIMITE_UPLOAD_MB = 20;

getDb(); // crea/apre il db e applica lo schema all'avvio

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

/** Sito unico: lo stesso servizio espone le API e il frontend buildato.
 *  Se client/dist non c'e' (sviluppo con vite a parte) il server parte lo
 *  stesso e serve solo le API, invece di rifiutarsi di avviarsi. */
if (CLIENT_BUILDATO) app.register(fastifyStatic, { root: DIST, wildcard: false });

/** Le rotte delle fonti restano strette dove erano: nessuna chiede piu' di
 *  due file, e un limite aperto vorrebbe dire accettare un upload qualsiasi.
 *  Ora se lo applicano da sole, perche' il tetto della registrazione e'
 *  diventato quello della rotta piu' larga. */
const MAX_FILE_FONTE = 4;
/** Uno in piu' del massimo, di proposito: al suo tetto multipart smette di
 *  consegnare parti senza dirlo, e la richiesta muore con un "premature
 *  close" invece che con un errore leggibile. Lasciandogliene passare una in
 *  piu', a contare e' fileCaricati, che sa dire quante ne erano troppe.
 *  Il tetto vero resta MAX_FOTO, applicato dalle rotte. */
app.register(fastifyMultipart, {
  limits: { fileSize: LIMITE_UPLOAD_MB * 1024 * 1024, files: MAX_FOTO + 1 },
});

/** La porta d'ingresso.
 *
 *  Chi non ha la sessione non vede NIENTE: non le API, e nemmeno il bundle del
 *  client. Una schermata di login dentro l'applicazione avrebbe comunque
 *  spedito tutto il sito a chiunque passasse dall'indirizzo, e "chiedere la
 *  password prima di mostrare qualsiasi cosa" vuol dire prima di quello.
 *
 *  Senza SITE_PASSWORD non blocca niente: il sito resta aperto e lo dichiara.
 *  Rendersi inaccessibili da soli per una variabile dimenticata sarebbe un
 *  guasto peggiore di quello che si vuole evitare. */
app.addHook('onRequest', (req, reply, done) => {
  if (!protetto()) return done();
  const percorso = req.url.split('?')[0];
  if (APERTE.has(percorso)) return done();
  if (sessioneValida(leggiCookie(req.headers.cookie))) return done();

  if (percorso.startsWith('/api/')) {
    reply.code(401).send({ error: 'sessione assente o scaduta', motivo: 'accesso' });
    return;
  }
  // Tutto il resto - la pagina, il bundle, le immagini - diventa il login.
  reply.code(200).type('text/html; charset=utf-8').send(LOGIN_HTML);
});

/** L'unica rotta che si puo' chiamare senza sessione, insieme a health.
 *  Non dice mai se la password era "quasi giusta": un solo messaggio per
 *  qualunque motivo di rifiuto. */
app.post('/api/login', (req, reply) => {
  if (!protetto()) return { ok: true, protetto: false, avviso: AVVISO_APERTO };
  if (!passwordGiusta(req.body?.password)) {
    req.log.warn({ ip: req.ip }, 'login rifiutato');
    return reply.code(401).send({ error: 'Password sbagliata.' });
  }
  reply.header('set-cookie', intestazioneCookie(creaSessione(), { sicuro: suHttps(req) }));
  req.log.info('login riuscito');
  return { ok: true };
});

app.post('/api/logout', (req, reply) => {
  reply.header('set-cookie', cookieScaduto({ sicuro: suHttps(req) }));
  return { ok: true };
});

/** Il routing del client e' lato browser: ogni path non-API deve restituire
 *  index.html, altrimenti un refresh su una schermata interna darebbe 404. */
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/'))
    return reply.code(404).send({ error: `rotta non trovata: ${req.method} ${req.url}` });
  if (!CLIENT_BUILDATO)
    return reply.code(503).send({ error: 'client non buildato: lancia "npm run build" oppure usa "npm start"' });
  return reply.sendFile('index.html');
});

/** Aperta senza sessione perche' Railway la interroga per sapere se il servizio
 *  e' vivo: protetta, il deploy risulterebbe morto e verrebbe riavviato in
 *  continuazione. Percio' quando c'e' una password non racconta niente: dice
 *  solo che il processo risponde. */
app.get('/api/health', () => {
  if (protetto()) return { ok: true };
  const s = statoConfig();
  return { ok: true, configurata: s.configurata, squadre: s.squadre };
});

app.get('/api/config', () => ({
  ...statoConfig(),
  // Serve al client per mostrare l'avviso quando il sito e' aperto: un banner
  // in pagina lo si vede, una riga nel log del server no.
  protezione: { attiva: protetto(), avviso: protetto() ? null : AVVISO_APERTO },
}));

app.post('/api/config', (req, reply) => {
  if (bloccata())
    return reply.code(409).send({
      error: `Configurazione bloccata: ci sono gia' ${numeroAcquisti()} acquisti registrati. Per sbloccarla usa POST /api/reset (cancella tutti gli acquisti).`,
    });

  const v = validaConfig(req.body ?? {});
  if (!v.ok) return reply.code(400).send({ error: v.errore, campo: v.campo });

  const bak = backup('pre-config');
  const teams = salvaConfig(v.valori);
  req.log.info({ teams, backup: bak }, 'config salvata');
  return { ok: true, backup: bak, teams, ...statoConfig() };
});

/** Via principale per caricare il listone: da Railway fantacalcio.it risponde
 *  401 (vuole una sessione), quindi il download automatico non e' affidabile.
 *  Qui il file lo si scarica a mano dal browser e lo si carica: stesse
 *  validazioni, stesso backup, stesso import del download. */
app.post('/api/listone/upload', async (req, reply) => {
  let parte;
  try {
    parte = await req.file();
  } catch (e) {
    return reply.code(400).send({ error: `richiesta non valida: ${e.message}` });
  }
  if (!parte) return reply.code(400).send({ error: 'nessun file ricevuto: serve un multipart con un campo file' });

  let buf;
  try {
    buf = await parte.toBuffer();
  } catch (e) {
    if (e.code === 'FST_REQ_FILE_TOO_LARGE')
      return reply.code(413).send({ error: `file troppo grande: il limite e' ${LIMITE_UPLOAD_MB} MB` });
    throw e;
  }

  try {
    const r = salvaEImporta(buf, 'il file caricato', parte.filename);
    req.log.info(
      { nomeFile: parte.filename, righeLette: r.righeLette, inserite: r.inserite, aggiornate: r.aggiornate },
      'listone caricato'
    );
    return {
      nomeFile: parte.filename,
      righeLette: r.righeLette,
      inserite: r.inserite,
      aggiornate: r.aggiornate,
      scartate: r.scartate.length,
      ...(r.scartate.length ? { dettaglioScartate: r.scartate } : {}),
      usciti: r.usciti,
      rientrati: r.rientrati,
      ...(r.usciteSaltate ? { usciteSaltate: r.usciteSaltate } : {}),
      totale: r.totale,
      perRuolo: r.perRuolo,
      backupListone: r.backupListone,
      backupDb: r.backupDb,
    };
  } catch (e) {
    // Qui il file sbagliato lo ha mandato il client, non un server remoto: 400, non 502.
    if (e instanceof ErroreListone) {
      req.log.warn({ err: e, nomeFile: parte.filename }, 'upload listone rifiutato');
      return reply.code(400).send({ error: e.message, ...(e.righeGrezze ? { righeGrezze: e.righeGrezze } : {}) });
    }
    throw e;
  }
});

const TROPPI = () => Object.assign(new Error('troppi file'), { code: 'FST_FILES_LIMIT' });

/** Piu' file in una richiesta sola: due stagioni di statistiche, o venti
 *  schermate da analizzare. Ogni rotta dice il suo massimo, perche' non e'
 *  lo stesso numero.
 *  I buffer si consumano uno per uno mentre si scorre, com'e' richiesto da
 *  multipart: saltare una parte senza leggerla blocca il flusso. */
async function fileCaricati(req, massimo = MAX_FOTO) {
  const out = [];
  let troppi = false;
  try {
    for await (const parte of req.files()) {
      // Il buffer si legge comunque, anche oltre il tetto: saltare una parte
      // senza consumarla blocca il flusso multipart, e la richiesta resterebbe
      // appesa invece di ricevere il suo errore.
      const buf = await parte.toBuffer();
      if (out.length < massimo) out.push({ nomeFile: parte.filename, buf });
      else troppi = true;
    }
  } catch (e) {
    // Al SUO tetto multipart smette di consegnare parti e chiude il flusso di
    // netto: chi ha mandato trenta file si vedrebbe tornare un "premature
    // close", che non dice niente. Se a quel punto ne avevamo gia' contati
    // piu' del massimo, il motivo vero e' questo, e va detto quello.
    if (troppi || out.length >= massimo) throw TROPPI();
    throw e;
  }
  if (troppi) throw TROPPI();
  return out;
}

/** Errore di upload: il file sbagliato lo manda il client, quindi 400.
 *  413 solo quando ha davvero passato il limite di dimensione. */
function rispondiUpload(reply, req, e, cosa) {
  if (e?.code === 'FST_REQ_FILE_TOO_LARGE')
    return reply.code(413).send({ error: `file troppo grande: il limite e' ${LIMITE_UPLOAD_MB} MB` });
  if (e?.code === 'FST_FILES_LIMIT')
    return reply.code(413).send({ error: `troppi file: al massimo ${MAX_FILE_FONTE} per richiesta` });
  if (e instanceof ErroreListone || e instanceof ErroreXg) {
    req.log.warn({ err: e }, `upload ${cosa} rifiutato`);
    return reply.code(400).send({ error: e.message, ...(e.righeGrezze ? { righeGrezze: e.righeGrezze } : {}) });
  }
  throw e;
}

/** Statistiche storiche: gli xlsx di Fantacalcio.it, uno per stagione.
 *  Stesse difese del listone - dimensione minima, magic number, backup del file
 *  e del db prima di sovrascrivere - e stesso import di npm run import-stats. */
app.post('/api/stats/upload', async (req, reply) => {
  let caricati;
  try {
    caricati = await fileCaricati(req, MAX_FILE_FONTE);
  } catch (e) {
    return rispondiUpload(reply, req, e, 'statistiche');
  }
  if (!caricati.length) return reply.code(400).send({ error: "nessun file ricevuto: serve un multipart con uno o piu' campi file" });
  try {
    const r = salvaEImportaStats(caricati);
    req.log.info({ stagioni: r.stagioni.map((x) => x.stagione), coperti: r.coperti }, 'statistiche caricate');
    return r;
  } catch (e) {
    return rispondiUpload(reply, req, e, 'statistiche');
  }
});

/** Expected goals: le esportazioni json di Understat, una per stagione.
 *  Understat non e' scaricabile in automatico (robots.txt vieta tutto il sito),
 *  quindi questa e' la via normale, non un ripiego. */
app.post('/api/xg/upload', async (req, reply) => {
  let caricati;
  try {
    caricati = await fileCaricati(req, MAX_FILE_FONTE);
  } catch (e) {
    return rispondiUpload(reply, req, e, 'xG');
  }
  if (!caricati.length) return reply.code(400).send({ error: "nessun file ricevuto: serve un multipart con uno o piu' campi file" });
  try {
    const r = salvaEImportaXg(caricati);
    req.log.info({ stagioni: r.stagioni.map((x) => x.stagione) }, 'xG caricati');
    return r;
  } catch (e) {
    return rispondiUpload(reply, req, e, 'xG');
  }
});

/** Riscarica il listone da fantacalcio.it e reimporta. Da usare SOLO prima
 *  dell'asta, mai durante: le quotazioni cambierebbero sotto agli acquisti gia'
 *  registrati. Se il download fallisce il file locale resta quello di prima e
 *  "npm run import" continua a funzionare. */
app.post('/api/listone/aggiorna', async (req, reply) => {
  try {
    const r = await scaricaListone();
    req.log.info(
      { righeLette: r.righeLette, inserite: r.inserite, aggiornate: r.aggiornate, scartate: r.scartate.length },
      'listone aggiornato'
    );
    return {
      scaricatoIl: r.scaricatoIl,
      righeLette: r.righeLette,
      inserite: r.inserite,
      aggiornate: r.aggiornate,
      scartate: r.scartate.length,
      ...(r.scartate.length ? { dettaglioScartate: r.scartate } : {}),
      backupListone: r.backupListone,
      backupDb: r.backupDb,
    };
  } catch (e) {
    if (e instanceof ErroreDownload || e instanceof ErroreListone) {
      req.log.error({ err: e }, 'aggiornamento listone fallito');
      return reply.code(502).send({ error: e.message, ...(e.righeGrezze ? { righeGrezze: e.righeGrezze } : {}) });
    }
    throw e;
  }
});

/** Stato completo per le due pagine: giocatori con segnali e note, la mia rosa,
 *  i contatori. Una chiamata sola, cosi' l'asta non fa mai richieste a raffica. */
app.get('/api/stato', () => stato());

app.post('/api/acquisti', (req, reply) => {
  const playerId = Number(req.body?.playerId);
  const prezzo = Number(req.body?.prezzo);
  if (!Number.isInteger(playerId)) return reply.code(400).send({ error: 'playerId mancante o non intero' });
  if (!Number.isInteger(prezzo) || prezzo < 0) return reply.code(400).send({ error: 'prezzo deve essere un intero >= 0' });
  const r = registraAcquisto(playerId, prezzo);
  if (!r.ok) return reply.code(409).send({ error: r.errore });
  req.log.info({ playerId, prezzo }, 'acquisto registrato');
  return { ...r, ...stato() };
});

/** Preso da altri: esce dalla lista, nessun prezzo e nessuna squadra registrati. */
app.post('/api/usciti', (req, reply) => {
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId)) return reply.code(400).send({ error: 'playerId mancante o non intero' });
  const r = registraUscita(playerId);
  if (!r.ok) return reply.code(409).send({ error: r.errore });
  return { ...r, ...stato() };
});

/** Senza playerId e' il Ctrl+Z dell'asta: via l'ultima riga scritta, acquisto
 *  o uscita che sia. Con playerId e' la X di una riga della pagina Situazione:
 *  via l'azione di quel giocatore e basta. Stessa rotta perche' e' la stessa
 *  cosa - disfare - e la logica sta tutta in asta.js. */
app.post('/api/annulla', (req, reply) => {
  const grezzo = req.body?.playerId;
  const playerId = grezzo === undefined || grezzo === null ? null : Number(grezzo);
  if (playerId !== null && !Number.isInteger(playerId))
    return reply.code(400).send({ error: 'playerId non intero' });
  const r = playerId === null ? annullaUltima() : annullaGiocatore(playerId);
  if (!r.ok) return reply.code(409).send({ error: r.errore });
  req.log.warn({ annullata: r.annullata }, 'azione annullata');
  return { ...r, ...stato() };
});

app.post('/api/target', (req, reply) => {
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId)) return reply.code(400).send({ error: 'playerId mancante o non intero' });
  const r = commutaTarget(playerId);
  if (!r.ok) return reply.code(400).send({ error: r.errore });
  return r;
});

/** Lancia l'aggiornamento di tutte le fonti. Da usare prima dell'asta: fa
 *  richieste di rete lente e non deve girare mentre si sta battendo un
 *  giocatore.
 *  Torna subito: la corsa dura minuti, e una richiesta HTTP che restasse
 *  aperta cosi' a lungo verrebbe chiusa dal proxy molto prima della fine.
 *  Chi ha premuto il pulsante segue l'avanzamento su /api/news/stato. */
app.post('/api/news/genera', (req, reply) => {
  const r = avviaBatch({ conferma: req.body?.conferma === true });
  if (!r.ok) return reply.code(409).send({ error: r.errore });
  return r;
});

app.get('/api/news/stato', () => statoBatch());

/** Il conto delle chiamate a Claude. `da` di default e' l'accensione del
 *  server: e' quello che il pannello dell'asta chiama "questa sessione". */
app.get('/api/consumo', (req) => consumo(req.query?.da ?? DA_QUANDO));

/** La rosa a mano: svincoli e scambi a stagione cominciata.
 *  Le azioni d'asta hanno altri controlli - un giocatore "uscito" non si puo'
 *  comprare, l'annulla toglie l'ultima in ordine di tempo - che servono
 *  durante l'asta e sono d'intralcio dopo. */
app.post('/api/rosa', (req, reply) => {
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId)) return reply.code(400).send({ error: 'playerId mancante o non intero' });
  const r = req.body?.rimuovi === true ? togli(playerId) : metti(playerId, req.body?.prezzo);
  if (!r.ok) return reply.code(400).send({ error: r.errore });
  req.log.info({ azione: r.azione, nome: r.nome, prezzo: r.prezzo }, 'rosa modificata a mano');
  return { ...r, ...stato() };
});

/** ---------------------------------------------------------------- foto
 *
 *  Schermate di probabili formazioni che nessun parser sa leggere, guardate
 *  da Claude. Le immagini restano su disco in data/foto: l'analisi si rilegge
 *  a distanza di settimane e senza le foto accanto non si potrebbe piu'
 *  verificare da dove veniva. */
app.post('/api/foto/analizza', async (req, reply) => {
  if (chiaveFotoMancante())
    return reply.code(400).send({ error: 'ANTHROPIC_API_KEY non impostata', motivo: 'chiave' });

  const rosa = miaRosa();
  if (!rosa.length) return reply.code(400).send({ error: 'la rosa e\' vuota: senza non c\'e\' contesto da mandare' });

  let caricati;
  try {
    caricati = await fileCaricati(req);
  } catch (e) {
    if (e?.code === 'FST_FILES_LIMIT')
      return reply.code(413).send({ error: `troppe immagini: al massimo ${MAX_FOTO} per volta` });
    return rispondiUpload(reply, req, e, 'foto');
  }
  if (!caricati.length) return reply.code(400).send({ error: "nessuna immagine ricevuta" });
  if (caricati.length > MAX_FOTO)
    return reply.code(413).send({ error: `troppe immagini: al massimo ${MAX_FOTO} per volta` });

  const { cartella, dir, immagini, rifiutate } = salvaFoto(caricati);
  if (!immagini.length)
    return reply.code(400).send({ error: 'nessuna immagine leggibile fra quelle caricate', rifiutate });

  const preventivo = stimaFoto(immagini, rosa);
  const esito = await analizzaFoto(nuovoClientFoto(), dir, immagini, rosa);
  if (!esito.ok) {
    req.log.warn({ errore: esito.errore, cartella }, 'analisi foto fallita');
    // Le immagini restano dove sono: la chiamata si puo' rifare senza
    // ricaricarle, e il motivo del fallimento spesso e' temporaneo.
    return reply.code(502).send({ error: esito.errore, motivo: 'claude', cartella, immagini, rifiutate });
  }

  const c = registra({ tipo: 'foto', modello: MODELLO, uso: esito.uso });
  const { id, created_at } = salvaAnalisi({
    cartella,
    immagini,
    esito,
    modello: MODELLO,
    uso: esito.uso,
    costo: c.costo,
  });
  req.log.info({ id, immagini: immagini.length, voci: esito.voci.length, costo: c.costo }, 'analisi foto');
  return {
    ok: true,
    id,
    created_at,
    cartella,
    immagini,
    rifiutate,
    preventivo,
    voci: esito.voci,
    illeggibili: esito.illeggibili,
    scartate: esito.scartate,
    riassunto: esito.riassunto,
    erroreLettura: esito.errore,
    consumo: c,
  };
});

/** L'archivio delle analisi, dalla piu' recente: servono a confrontare una
 *  settimana con la precedente. `confermati` dice quali voci sono gia' state
 *  prese, cosi' il pulsante non si ripropone su una gia' fatta. */
app.get('/api/foto', () => ({ analisi: analisiFoto(), confermati: confermatiFoto(), max: MAX_FOTO }));

/** Le immagini salvate. Non passa da @fastify/static: quella serve il client
 *  buildato, e data/foto sta fuori da li' - su Railway sta perfino su un altro
 *  filesystem. */
app.get('/api/foto/:cartella/:file', (req, reply) => {
  const p = percorsoFoto(req.params.cartella, req.params.file);
  if (!p || !fs.existsSync(p)) return reply.code(404).send({ error: 'immagine non trovata' });
  const mime = mimeDaEstensione(path.extname(p).slice(1));
  return reply.type(mime ?? 'application/octet-stream').send(fs.createReadStream(p));
});

/** La conferma: da qui, e solo da qui, un'estrazione da foto diventa un
 *  segnale. Una voce alla volta, decisa da chi guarda. */
app.post('/api/foto/conferma', (req, reply) => {
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId)) return reply.code(400).send({ error: 'playerId mancante o non intero' });
  const r =
    req.body?.annulla === true
      ? annullaConfermaFoto(playerId, String(req.body?.tipo ?? ''))
      : confermaFoto(playerId, String(req.body?.tipo ?? ''), req.body?.testo);
  if (!r.ok) return reply.code(400).send({ error: r.errore ?? 'niente da annullare' });
  req.log.info({ playerId, tipo: req.body?.tipo, annulla: req.body?.annulla === true }, 'segnale da foto');
  return { ...r, confermati: confermatiFoto(), ...stato() };
});

app.post('/api/reset', (req) => {
  const bak = backup('pre-reset');
  const cancellati = getDb().prepare('DELETE FROM purchases').run().changes;
  req.log.warn({ cancellati, backup: bak }, 'reset acquisti');
  return { ok: true, acquistiCancellati: cancellati, backup: bak, ...statoConfig() };
});

app.listen({ port: PORT, host: HOST }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});

console.log(`[server] db in uso: ${DB_PATH}`);
console.log(
  `[server] dati in : ${DATA_DIR}${SU_VOLUME ? ' (volume persistente)' : ' (cartella locale: su Railway monta un volume, vedi README)'}`
);
console.log(`[server] client  : ${CLIENT_BUILDATO ? DIST : 'non buildato, vengono servite solo le API'}`);
