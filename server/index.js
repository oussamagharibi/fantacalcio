import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { getDb, backup, DB_PATH, DATA_DIR, SU_VOLUME, ROOT } from './db.js';
import { statoConfig, validaConfig, salvaConfig, bloccata, numeroAcquisti } from './lib/config.js';
import { scaricaListone, salvaEImporta, ErroreDownload, ErroreListone } from './lib/listone.js';
import { stato, registraAcquisto, registraUscita, annullaUltima, commutaTarget } from './lib/asta.js';
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

app.register(fastifyMultipart, { limits: { fileSize: LIMITE_UPLOAD_MB * 1024 * 1024, files: 1 } });

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

/** Ctrl+Z: toglie l'ultima riga scritta, acquisto o uscita che sia. */
app.post('/api/annulla', (req, reply) => {
  const r = annullaUltima();
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

/** Lancia il batch delle notizie. Da usare prima dell'asta: fa richieste di
 *  rete lente e non deve girare mentre si sta battendo un giocatore. */
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
