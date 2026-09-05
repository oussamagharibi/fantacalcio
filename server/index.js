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

const PORT = Number(process.env.PORT ?? 3001);
/** 0.0.0.0 e non 127.0.0.1: dentro un container Railway raggiunge il servizio
 *  dall'esterno, e su localhost soltanto non lo vedrebbe. */
const HOST = process.env.HOST ?? '0.0.0.0';

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

/** files: statistiche e xG si caricano due stagioni alla volta, quindi uno solo
 *  non basta piu'. Il tetto resta basso: nessuna fonte ne chiede piu' di due, e
 *  un limite aperto vorrebbe dire accettare un upload qualsiasi. */
const MAX_FILE = 4;
app.register(fastifyMultipart, {
  limits: { fileSize: LIMITE_UPLOAD_MB * 1024 * 1024, files: MAX_FILE },
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

app.get('/api/health', () => {
  const s = statoConfig();
  return { ok: true, configurata: s.configurata, squadre: s.squadre };
});

app.get('/api/config', () => statoConfig());

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

/** Piu' file in una richiesta sola: le due stagioni si caricano insieme.
 *  I buffer si consumano uno per uno mentre si scorre, com'e' richiesto da
 *  multipart: saltare una parte senza leggerla blocca il flusso. */
async function fileCaricati(req) {
  const out = [];
  for await (const parte of req.files()) out.push({ nomeFile: parte.filename, buf: await parte.toBuffer() });
  return out;
}

/** Errore di upload: il file sbagliato lo manda il client, quindi 400.
 *  413 solo quando ha davvero passato il limite di dimensione. */
function rispondiUpload(reply, req, e, cosa) {
  if (e?.code === 'FST_REQ_FILE_TOO_LARGE')
    return reply.code(413).send({ error: `file troppo grande: il limite e' ${LIMITE_UPLOAD_MB} MB` });
  if (e?.code === 'FST_FILES_LIMIT')
    return reply.code(413).send({ error: `troppi file: al massimo ${MAX_FILE} per richiesta` });
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
    caricati = await fileCaricati(req);
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
    caricati = await fileCaricati(req);
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
