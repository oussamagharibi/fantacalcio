import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { getDb, DATA_DIR } from '../db.js';
import { MODELLO, PREZZO, stimaToken } from './analisi.js';
import { normalizza } from './testo.js';
import { LATO_MASSIMO, MAX_FOTO, dimensioni, estensioneDi, riconosci, tokenImmagine } from './immagini.js';

/** Analisi delle schermate: quello che i parser non sanno leggere.
 *
 *  Le probabili formazioni girano anche in posti che non si scaricano - una
 *  storia su Instagram, una schermata di un gruppo, un sito che il robots.txt
 *  vieta. Quella roba e' un'immagine, e l'unico modo di leggerla e' guardarla.
 *
 *  Resta un'estrazione da foto, cioe' meno affidabile di un parser che legge
 *  il markup: per questo NIENTE finisce in segnali da solo. Quello che il
 *  modello estrae si vede, si confronta con le immagini che stanno li' accanto,
 *  e diventa un segnale solo se qualcuno preme il pulsante. */

export const CARTELLA = path.join(DATA_DIR, 'foto');

/** I tipi di segnale che una conferma puo' scrivere. Un tipo fuori da questa
 *  lista non si scrive: finirebbe in una tabella che nessuna pagina interroga,
 *  cioe' sparirebbe restando li'. */
export const TIPI_SEGNALE = ['titolarita', 'infortunio', 'dubbio', 'squalifica'];
export const STATI = ['titolare', 'ballottaggio', 'panchina', 'non-compare'];

/** La fonte con cui si firmano i segnali confermati. Una sola per tutte le
 *  analisi, non una per data: fonte fa parte della chiave di segnali, e una
 *  fonte nuova ogni settimana vorrebbe dire venti righe dello stesso tipo per
 *  lo stesso giocatore, tutte "vere" e tutte vecchie tranne una. */
export const FONTE = 'Analisi da foto';

/** Otto righe di riassunto piu' una voce per giocatore: con venti immagini e
 *  venticinque giocatori, duemila token sono gia' larghi. */
const MAX_TOKENS = 2000;

// ------------------------------------------------------------------ archivio

/** La cartella prende il nome dall'istante in cui si carica: le analisi si
 *  confrontano settimana per settimana, e l'ordine alfabetico dei nomi e' gia'
 *  l'ordine cronologico. I due punti non si possono usare nei nomi di file su
 *  Windows, quindi diventano trattini. */
export const nomeCartella = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Scrive le immagini su disco e dice di ognuna quello che ha misurato.
 *
 *  Il tipo si legge dai magic number e non dal nome: un .png che dentro non e'
 *  un png verrebbe rifiutato dall'API dopo aver gia' pagato l'upload.
 *  Un file rifiutato non ferma gli altri - viene detto e si va avanti. */
export function salvaFoto(caricati, quando = new Date()) {
  const cartella = nomeCartella(quando);
  const dir = path.join(CARTELLA, cartella);
  const immagini = [];
  const rifiutate = [];

  for (const c of caricati) {
    const t = riconosci(c.buf);
    if (!t) {
      rifiutate.push({ nomeFile: c.nomeFile, motivo: 'non e\' un jpg, un png o un webp' });
      continue;
    }
    const dim = dimensioni(c.buf);
    if (!dim) {
      rifiutate.push({ nomeFile: c.nomeFile, motivo: 'intestazione illeggibile: il file sembra troncato' });
      continue;
    }
    if (immagini.length === 0) fs.mkdirSync(dir, { recursive: true });
    const file = `${String(immagini.length + 1).padStart(2, '0')}.${estensioneDi(t.mime)}`;
    fs.writeFileSync(path.join(dir, file), c.buf);
    immagini.push({
      file,
      nomeFile: c.nomeFile ?? null,
      mime: t.mime,
      byte: c.buf.length,
      ...dim,
      // Sopra la soglia il client non ha ridimensionato: si manda comunque
      // - l'API rimpicciolisce da sola - ma va detto, perche' quei byte in
      // piu' sono stati caricati per niente.
      oltreSoglia: Math.max(dim.larghezza, dim.altezza) > LATO_MASSIMO,
      token: tokenImmagine(dim.larghezza, dim.altezza),
    });
  }
  return { cartella, dir, immagini, rifiutate };
}

/** Il percorso di un'immagine gia' salvata, o null se esce dalla cartella.
 *  I due nomi arrivano dall'url: senza questo controllo un "../.." servirebbe
 *  qualunque file del disco. */
export function percorsoFoto(cartella, file) {
  const p = path.resolve(CARTELLA, cartella, file);
  const base = path.resolve(CARTELLA);
  return p.startsWith(base + path.sep) ? p : null;
}

/** I miei 25: nome, ruolo e squadra bastano al modello, e sono anche quello
 *  su cui si riabbinano le voci che tornano. */
export const miaRosa = () =>
  getDb()
    .prepare(
      `SELECT p.id, p.nome, p.ruolo, p.squadra
         FROM purchases a JOIN players p ON p.id = a.player_id
        ORDER BY CASE p.ruolo WHEN 'P' THEN 0 WHEN 'D' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, p.nome`
    )
    .all();

// -------------------------------------------------------------------- prompt

/** La rosa come la vede il modello: nome, ruolo, squadra. Il ruolo e la
 *  squadra non sono decorazione - servono a non confondere due giocatori con
 *  lo stesso cognome, che nelle schermate compaiono senza altro contesto. */
export const elencoRosa = (rosa) => rosa.map((g) => `- ${g.nome} (${g.ruolo}, ${g.squadra})`).join('\n');

/** Il formato della risposta, tenuto separato dalla domanda.
 *
 *  La domanda e' quella che si farebbe a voce e sta tutta in costruisciPrompt.
 *  Qui c'e' solo come impacchettarla, che serve al pulsante di conferma: senza
 *  una struttura, ogni voce andrebbe ritagliata a mano da un paragrafo. */
export const ISTRUZIONI = `Rispondi SOLO in JSON, nessun preambolo, nessun markdown:
{"voci":[{"nome":"...","stato":"titolare|ballottaggio|panchina|non-compare","nota":"...","immagine":1,"segnale":{"tipo":"titolarita|infortunio|dubbio|squalifica","testo":"..."}}],
 "illeggibili":[{"immagine":1,"motivo":"..."}],
 "riassunto":"..."}

nome: esattamente come sta scritto nella rosa che ti viene data, non come appare nell'immagine.
stato: "non-compare" se il giocatore non si vede in nessuna immagine. In quel caso nota, immagine e segnale restano null.
immagine: il numero dell'immagine da cui viene l'informazione, contando da 1 nell'ordine in cui ti sono state date.
segnale: cosa scriveresti in archivio, se serve. null quando non c'e' niente da annotare.
  Il testo del segnale e' una riga sola, senza il nome del giocatore dentro.
illeggibili: le immagini che non si riescono a leggere, con il motivo. Vuoto se sono tutte leggibili.
riassunto: massimo 8 righe.
Una voce per OGNI giocatore della rosa, compresi quelli che non compaiono.`;

/** La domanda, parola per parola come l'ha scritta chi usa l'applicazione. */
export const costruisciPrompt = (rosa) => `Queste sono schermate di probabili formazioni e notizie di
fantacalcio. Questa e' la mia rosa:
${elencoRosa(rosa)}

Per OGNI mio giocatore che compare nelle immagini, estrai:
- se e' dato titolare, in ballottaggio o in panchina
- eventuali note su infortuni o condizione
- da quale immagine viene l'informazione

Poi dimmi in massimo 8 righe cosa cambia per la mia formazione.

Basati SOLO su quello che vedi nelle immagini. Se un giocatore non
compare, dillo invece di dedurlo. Se un'immagine e' illeggibile,
segnalalo.`;

/** Stima locale, dichiarata come tale: serve solo a decidere se premere.
 *  Il costo vero arriva dai campi usage della risposta. */
export function stima(immagini, rosa) {
  const tokenFoto = immagini.reduce((a, i) => a + (i.token ?? 0), 0);
  const input = tokenFoto + stimaToken(ISTRUZIONI) + stimaToken(costruisciPrompt(rosa));
  // Una voce per giocatore piu' otto righe di riassunto.
  const output = rosa.length * 40 + 300;
  return {
    immagini: immagini.length,
    tokenFoto,
    tokenInput: input,
    tokenOutput: output,
    dollari: PREZZO ? (input / 1e6) * PREZZO.input + (output / 1e6) * PREZZO.output : null,
  };
}

// ------------------------------------------------------------------ chiamata

/** Le immagini vanno nel messaggio come blocchi base64, in ordine, e il testo
 *  dopo: cosi' "l'immagine 3" nella risposta e' la terza di questo elenco. */
export async function analizza(client, dir, immagini, rosa) {
  const blocchi = immagini.map((i) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: i.mime,
      data: fs.readFileSync(path.join(dir, i.file)).toString('base64'),
    },
  }));
  try {
    const risposta = await client.messages.create({
      model: MODELLO,
      max_tokens: MAX_TOKENS,
      system: ISTRUZIONI,
      messages: [{ role: 'user', content: [...blocchi, { type: 'text', text: costruisciPrompt(rosa) }] }],
    });
    const grezzo = risposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return {
      ok: true,
      grezzo,
      ...leggiRisposta(grezzo, rosa),
      uso: { input: risposta.usage.input_tokens, output: risposta.usage.output_tokens },
      stop: risposta.stop_reason,
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, errore: 'chiave API non valida' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, errore: "rate limit: riprova piu' tardi" };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, errore: `richiesta rifiutata: ${e.message}` };
    if (e instanceof Anthropic.APIError) return { ok: false, errore: `errore API ${e.status}: ${e.message}` };
    return { ok: false, errore: e.message };
  }
}

// ------------------------------------------------------------------- lettura

/** Dalla risposta grezza alle voci abbinate ai MIEI giocatori.
 *
 *  Il nome torna come sta nella rosa che gli e' stata data, ma questo e' quel
 *  che gli e' stato chiesto, non una garanzia: si riabbina lo stesso, e un
 *  nome che non corrisponde a nessuno dei miei si scarta invece di indovinare
 *  a chi somiglia. Venticinque nomi sono pochi: se non e' uno di quelli, non
 *  e' un mio giocatore. */
export function leggiRisposta(testo, rosa) {
  const grezzo = String(testo ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const inizio = grezzo.indexOf('{');
  const fine = grezzo.lastIndexOf('}');
  if (inizio === -1 || fine <= inizio)
    return { voci: [], illeggibili: [], riassunto: null, scartate: [], errore: 'nessun oggetto JSON nella risposta' };
  let dati;
  try {
    dati = JSON.parse(grezzo.slice(inizio, fine + 1));
  } catch (e) {
    return { voci: [], illeggibili: [], riassunto: null, scartate: [], errore: `JSON illeggibile: ${e.message}` };
  }

  const perNome = new Map();
  for (const g of rosa) perNome.set(normalizza(g.nome), g);

  const voci = [];
  const scartate = [];
  const visti = new Set();
  for (const x of Array.isArray(dati?.voci) ? dati.voci : []) {
    const nome = String(x?.nome ?? '').trim();
    const g = perNome.get(normalizza(nome));
    if (!g) {
      scartate.push({ voce: x, motivo: `"${nome}" non e' uno dei miei 25` });
      continue;
    }
    if (visti.has(g.id)) {
      scartate.push({ voce: x, motivo: `${g.nome} nominato due volte` });
      continue;
    }
    visti.add(g.id);
    const stato = String(x?.stato ?? '').trim().toLowerCase();
    voci.push({
      player_id: g.id,
      nome: g.nome,
      ruolo: g.ruolo,
      squadra: g.squadra,
      stato: STATI.includes(stato) ? stato : null,
      nota: String(x?.nota ?? '').trim() || null,
      immagine: Number.isInteger(x?.immagine) ? x.immagine : null,
      segnale: leggiSegnale(x?.segnale),
    });
  }
  return {
    voci,
    illeggibili: (Array.isArray(dati?.illeggibili) ? dati.illeggibili : []).map((x) => ({
      immagine: Number.isInteger(x?.immagine) ? x.immagine : null,
      motivo: String(x?.motivo ?? '').trim() || 'senza motivo dichiarato',
    })),
    riassunto: String(dati?.riassunto ?? '').trim() || null,
    scartate,
    errore: null,
  };
}

/** Un segnale con un tipo che nessuna pagina interroga non e' un segnale:
 *  diventa una riga invisibile in archivio. Fuori vocabolario, si butta. */
function leggiSegnale(s) {
  const tipo = String(s?.tipo ?? '').trim().toLowerCase();
  const testo = String(s?.testo ?? '').trim();
  if (!TIPI_SEGNALE.includes(tipo) || !testo) return null;
  return { tipo, testo };
}

// ------------------------------------------------------------------ archivio

export function salvaAnalisi({ cartella, immagini, esito, modello, uso, costo }) {
  const created_at = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO analisi_foto (created_at, cartella, immagini, riassunto, voci, modello, input_tokens, output_tokens, costo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      created_at,
      cartella,
      immagini.length,
      esito.riassunto,
      JSON.stringify({ voci: esito.voci, illeggibili: esito.illeggibili, scartate: esito.scartate, immagini }),
      modello,
      uso?.input ?? null,
      uso?.output ?? null,
      costo
    );
  return { id: Number(info.lastInsertRowid), created_at };
}

const daRiga = (r) => {
  let d = {};
  try {
    d = JSON.parse(r.voci ?? '{}');
  } catch {
    // Una riga vecchia o corrotta non deve far sparire tutte le altre
    // dall'elenco: si mostra quel che si sa, cioe' la data e il costo.
  }
  return {
    id: r.id,
    created_at: r.created_at,
    cartella: r.cartella,
    immagini: d.immagini ?? [],
    quante: r.immagini,
    riassunto: r.riassunto,
    voci: d.voci ?? [],
    illeggibili: d.illeggibili ?? [],
    scartate: d.scartate ?? [],
    modello: r.modello,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    costo: r.costo,
  };
};

/** Le analisi dalla piu' recente: servono a confrontare una settimana con la
 *  precedente, quindi l'ordine e' quello e non l'inverso. */
export const analisi = (limite = 20) =>
  getDb().prepare('SELECT * FROM analisi_foto ORDER BY id DESC LIMIT ?').all(limite).map(daRiga);

export const unAnalisi = (id) => {
  const r = getDb().prepare('SELECT * FROM analisi_foto WHERE id = ?').get(id);
  return r ? daRiga(r) : null;
};

// ------------------------------------------------------------------ conferma

/** Scrive UNA voce nei segnali, quella che chi guarda ha deciso di credere.
 *
 *  Non usa salvaSegnali: quello cancella tutte le righe di (tipo, fonte) e
 *  riscrive, che e' giusto per un parser - la pagina e' la verita' del
 *  momento - e sbagliato qui, dove le conferme arrivano una alla volta e la
 *  precedente non e' stata smentita da niente. */
export function conferma(playerId, tipo, testo) {
  const db = getDb();
  const g = db.prepare('SELECT id, nome FROM players WHERE id = ?').get(playerId);
  if (!g) return { ok: false, errore: 'giocatore inesistente' };
  if (!TIPI_SEGNALE.includes(tipo)) return { ok: false, errore: `tipo "${tipo}" non scrivibile nei segnali` };
  const t = String(testo ?? '').trim();
  if (!t) return { ok: false, errore: 'testo vuoto' };
  db.prepare(
    `INSERT INTO segnali (player_id, tipo, testo, fonte, data) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(player_id, tipo, fonte) DO UPDATE SET testo = excluded.testo, data = excluded.data`
  ).run(playerId, tipo, t, FONTE, new Date().toISOString());
  return { ok: true, nome: g.nome, tipo, testo: t, fonte: FONTE };
}

/** Toglie una conferma. Cancella solo le righe firmate da qui: quelle dei
 *  parser hanno un'altra fonte e non si toccano da questa pagina. */
export function annullaConferma(playerId, tipo) {
  const changes = getDb()
    .prepare('DELETE FROM segnali WHERE player_id = ? AND tipo = ? AND fonte = ?')
    .run(playerId, tipo, FONTE).changes;
  return { ok: changes > 0, tolte: changes };
}

/** Cosa e' gia' stato confermato, per non rimettere il pulsante su una voce
 *  gia' presa. */
export const confermati = () =>
  getDb().prepare('SELECT player_id, tipo, testo, data FROM segnali WHERE fonte = ?').all(FONTE);

export { MAX_FOTO, LATO_MASSIMO };
export const nuovoClient = () => new Anthropic();
export const chiaveMancante = () => !process.env.ANTHROPIC_API_KEY;
