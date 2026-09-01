import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { getDb, tx, backup, perLog, DATA_DIR } from '../db.js';

export const LISTONE_PATH = process.env.LISTONE_PATH ?? path.join(DATA_DIR, 'listone.xlsx');
export const LISTONE_URL = process.env.LISTONE_URL ?? 'https://www.fantacalcio.it/api/v1/Excel/prices/21/1';

const RUOLI = ['P', 'D', 'C', 'A'];
/** Il file ufficiale ha un foglio per ruolo piu' "Tutti" (l'unione) e "Ceduti"
 *  (chi ha lasciato la Serie A: non deve finire in asta). Usiamo "Tutti". */
const FOGLIO = 'Tutti';
const MAGIC_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const DIMENSIONE_MINIMA = 10 * 1024;
const TIMEOUT_MS = 30_000;
const USER_AGENT = 'FantaCalcio-Asta/1.0 (strumento personale per asta fantacalcio)';

/** Colonne Classic. Le colonne Mantra (RM, Qt.A M, Qt.I M, FVM M) sono ignorate di proposito. */
const COLONNE = {
  id: 'Id',
  ruolo: 'R',
  nome: 'Nome',
  squadra: 'Squadra',
  quotazione: 'Qt.A',
  quotazioneIniziale: 'Qt.I',
  fvm: 'FVM',
};
/** Se mancano si importa lo stesso, con NULL: non sono indispensabili per l'asta. */
const COLONNE_OPZIONALI = ['fvm', 'quotazioneIniziale'];

export class ErroreListone extends Error {
  constructor(messaggio, { righeGrezze = null } = {}) {
    super(messaggio);
    this.name = 'ErroreListone';
    this.righeGrezze = righeGrezze;
  }
}

export class ErroreDownload extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = 'ErroreDownload';
  }
}

const normalizza = (v) => String(v ?? '').trim().toLowerCase();

const intero = (v) =>
  Number.isFinite(v) ? Math.trunc(v) : /^-?\d+$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : null;

/** L'header non e' mai la prima riga: sopra c'e' almeno un titolo di servizio
 *  ("Quotazioni Fantacalcio Stagione 2026 27"). Lo cerchiamo per contenuto. */
const eIntestazione = (riga) => {
  if (!Array.isArray(riga)) return false;
  const celle = riga.map(normalizza);
  return celle.includes('nome') && celle.includes('squadra');
};

/** Legge il listone da un path o da un buffer gia' in memoria (serve al download:
 *  cosi' si valida il file scaricato PRIMA di sovrascrivere quello buono). */
export function leggiListone(origine = LISTONE_PATH) {
  const buf = Buffer.isBuffer(origine) ? origine : fs.readFileSync(origine);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const foglio = wb.SheetNames.includes(FOGLIO) ? FOGLIO : wb.SheetNames[0];
  if (!foglio) throw new ErroreListone('il file non contiene nessun foglio');
  const griglia = XLSX.utils.sheet_to_json(wb.Sheets[foglio], { header: 1, raw: true, blankrows: false });

  const rigaHeader = griglia.findIndex(eIntestazione);
  if (rigaHeader < 0)
    throw new ErroreListone(
      'intestazione non trovata nel foglio "' +
        foglio +
        '": nessuna riga contiene sia "Nome" che "Squadra". Il formato del listone e\' cambiato, ' +
        'oppure il file non e\' un listone Fantacalcio.it.',
      { righeGrezze: griglia.slice(0, 5) }
    );

  const header = griglia[rigaHeader].map(normalizza);
  const idx = {};
  for (const [campo, etichetta] of Object.entries(COLONNE)) idx[campo] = header.indexOf(normalizza(etichetta));
  const mancanti = Object.entries(idx)
    .filter(([campo, i]) => i < 0 && !COLONNE_OPZIONALI.includes(campo))
    .map(([campo]) => COLONNE[campo]);
  if (mancanti.length)
    throw new ErroreListone('colonne mancanti nel foglio "' + foglio + '": ' + mancanti.join(', '), {
      righeGrezze: griglia.slice(0, 5),
    });

  const righe = [];
  const scartate = [];
  const grezze = griglia.slice(rigaHeader + 1);
  for (const [n, riga] of grezze.entries()) {
    const numeroRiga = rigaHeader + n + 2; // 1-based, come la vede Excel
    const scarta = (motivo) => scartate.push({ riga: numeroRiga, motivo, dati: riga });

    const id = intero(riga[idx.id]);
    if (id === null) {
      scarta('Id mancante o non numerico');
      continue;
    }
    const ruolo = String(riga[idx.ruolo] ?? '').trim().toUpperCase();
    if (!RUOLI.includes(ruolo)) {
      scarta('ruolo "' + (riga[idx.ruolo] ?? '') + '" non valido (attesi P/D/C/A)');
      continue;
    }
    const nome = String(riga[idx.nome] ?? '').trim();
    const squadra = String(riga[idx.squadra] ?? '').trim();
    if (!nome || !squadra) {
      scarta('nome o squadra vuoti');
      continue;
    }
    // quotazione e' NOT NULL a schema: senza un valore la riga non e' inseribile.
    const quotazione = intero(riga[idx.quotazione]);
    if (quotazione === null) {
      scarta('Qt.A mancante o non numerica');
      continue;
    }
    const fvm = idx.fvm >= 0 ? intero(riga[idx.fvm]) : null;
    // Quotazione di inizio stagione: serve solo a conservarla, la differenza
    // con Qt.A la useremo piu' avanti. Nessun calcolo derivato qui.
    const quotazioneIniziale = idx.quotazioneIniziale >= 0 ? intero(riga[idx.quotazioneIniziale]) : null;

    righe.push({
      id,
      nome,
      squadra,
      ruolo,
      quotazione,
      quotazione_iniziale: quotazioneIniziale,
      fvm,
      // Quanto il mercato valuta il giocatore rispetto al suo prezzo di listino.
      // Quotazione 0 (o assente) -> niente divisione per zero, resta NULL.
      rapporto_fvm: fvm !== null && quotazione > 0 ? Math.round((fvm / quotazione) * 100) / 100 : null,
      fascia: null,
    });
  }

  assegnaFasce(righe);
  return { foglio, rigaHeader: rigaHeader + 1, righeLette: grezze.length, righe, scartate };
}

/** Quintili di quotazione DENTRO ciascun ruolo, fascia 1 = i piu' cari.
 *  I pari merito non vengono mai spezzati: due giocatori con la stessa quotazione
 *  ricevono sempre la stessa fascia (quella del centro del loro gruppo), altrimenti
 *  in interfaccia due riserve identiche da 1 credito comparirebbero in fasce diverse.
 *  Gli estremi sono ancorati: chi ha la quotazione piu' alta del ruolo e' sempre
 *  fascia 1, chi ha la piu' bassa e' sempre fascia 5 - senza l'ancoraggio il blocco
 *  dei 39 portieri da 1 credito, essendo enorme, cadrebbe col suo centro in fascia 4
 *  e la fascia 5 resterebbe vuota.
 *  Conseguenza voluta: dove il listone e' piatto (i portieri sono quasi tutti a 1)
 *  le fasce intermedie restano vuote. E' la distribuzione reale, non un errore. */
function assegnaFasce(righe) {
  for (const ruolo of RUOLI) {
    const gruppo = righe.filter((r) => r.ruolo === ruolo).sort((a, b) => b.quotazione - a.quotazione);
    const n = gruppo.length;
    for (let i = 0; i < n; ) {
      let j = i;
      while (j < n && gruppo[j].quotazione === gruppo[i].quotazione) j++;
      const centro = (i + j - 1) / 2;
      const fascia = i === 0 ? 1 : j === n ? 5 : Math.min(5, Math.floor((centro * 5) / n) + 1);
      for (let k = i; k < j; k++) gruppo[k].fascia = fascia;
      i = j;
    }
  }
}

/** Oltre questa quota di archivio che finirebbe fuori listino, l'import smette
 *  di segnare le uscite: un salto del genere non e' il mercato, e' il file
 *  sbagliato (un singolo foglio per ruolo, il listone di un'altra lega). Meglio
 *  non toccare nessuno e dirlo, che far sparire meta' rosa dalla ricerca. */
export const SOGLIA_USCITE = 0.25;

/** Scrive le righe gia' lette. Idempotente sull'Id ufficiale Fantacalcio.it:
 *  rilanciare l'import due volte lascia lo stesso stato finale.
 *  note e note_generated_at NON sono nella UPDATE: le produce lo step 8 e non
 *  devono sparire a ogni reimport.
 *  Chi sparisce dal listone prende una data in assente_dal, mai una DELETE:
 *  potrebbe essere gia' stato acquistato e purchases lo referenzia. */
export function importaRighe(letto, { segnaUscite = true } = {}) {
  const backupDb = backup('pre-import');
  const prima = new Map(getDb().prepare('SELECT id, assente_dal FROM players').all().map((r) => [r.id, r.assente_dal]));
  const nelFile = new Set(letto.righe.map((r) => r.id));
  const usciti = [...prima].filter(([id, dal]) => dal === null && !nelFile.has(id)).map(([id]) => id);
  const troppi = prima.size > 0 && usciti.length > prima.size * SOGLIA_USCITE;
  const segna = segnaUscite && !troppi;
  const adesso = new Date().toISOString();

  const { inserite, aggiornate, rientrati } = tx((d) => {
    // Prima una data a tutti quelli che ce l'avevano NULL, poi l'upsert la
    // rimette a NULL per chi c'e' nel file. Evita una NOT IN con 500+ id, e
    // soprattutto non tocca chi una data ce l'aveva gia': quella e' la data
    // della sua uscita e non va riscritta a ogni reimport.
    if (segna) d.prepare('UPDATE players SET assente_dal = ? WHERE assente_dal IS NULL').run(adesso);
    const up = d.prepare(
      `INSERT INTO players (id, nome, squadra, ruolo, quotazione, quotazione_iniziale, fvm, rapporto_fvm, fascia, assente_dal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         nome = excluded.nome, squadra = excluded.squadra, ruolo = excluded.ruolo,
         quotazione = excluded.quotazione, quotazione_iniziale = excluded.quotazione_iniziale,
         fvm = excluded.fvm, rapporto_fvm = excluded.rapporto_fvm, fascia = excluded.fascia,
         assente_dal = NULL`
    );
    let ins = 0;
    let rie = 0;
    for (const r of letto.righe) {
      up.run(r.id, r.nome, r.squadra, r.ruolo, r.quotazione, r.quotazione_iniziale, r.fvm, r.rapporto_fvm, r.fascia);
      if (!prima.has(r.id)) ins++;
      else if (prima.get(r.id) !== null) rie++;
    }
    return { inserite: ins, aggiornate: letto.righe.length - ins, rientrati: rie };
  });
  return {
    foglio: letto.foglio,
    rigaHeader: letto.rigaHeader,
    righeLette: letto.righeLette,
    inserite,
    aggiornate,
    scartate: letto.scartate,
    usciti: segna ? usciti.length : 0,
    rientrati,
    // Valorizzato solo quando la soglia ha fermato le uscite: serve a far
    // comparire un avviso invece di un silenzioso "non e' successo niente".
    usciteSaltate: troppi ? usciti.length : 0,
    backupDb,
    totale: getDb().prepare('SELECT count(*) AS n FROM players').get().n,
    perRuolo: Object.fromEntries(
      getDb()
        .prepare('SELECT ruolo, count(*) AS n FROM players GROUP BY ruolo')
        .all()
        .map((r) => [r.ruolo, r.n])
    ),
  };
}

/** Validazione, backup e import di un listone gia' in memoria: identici per il
 *  file caricato a mano e per quello scaricato. Cambia la provenienza, non i
 *  controlli. Il file esistente si tocca solo dopo che il nuovo e' stato
 *  validato e letto per intero: se qualcosa non va, resta buono quello vecchio. */
export function salvaEImporta(buf, provenienza = 'il file') {
  if (buf.length < DIMENSIONE_MINIMA)
    throw new ErroreListone(
      provenienza +
        ' pesa ' +
        buf.length +
        ' byte (minimo ' +
        DIMENSIONE_MINIMA +
        '): scartato, il listone esistente non e\' stato toccato.'
    );
  const magic = [...buf.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  if (!buf.subarray(0, 4).equals(MAGIC_ZIP))
    throw new ErroreListone(
      provenienza +
        ' non e\' un xlsx (magic number ' +
        magic +
        ', atteso 50 4b 03 04): scartato, il listone esistente non e\' stato toccato.'
    );

  const letto = leggiListone(buf);

  let backupListone = null;
  if (fs.existsSync(LISTONE_PATH)) {
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(dir, 'listone-' + stamp + '.xlsx');
    fs.copyFileSync(LISTONE_PATH, dest);
    backupListone = perLog(dest);
  }
  fs.mkdirSync(path.dirname(LISTONE_PATH), { recursive: true });
  fs.writeFileSync(LISTONE_PATH, buf);

  return { backupListone, ...importaRighe(letto) };
}

/** Import dal file locale: non tocca la rete, deve funzionare sempre. */
export const importaDaFile = (origine = LISTONE_PATH) => importaRighe(leggiListone(origine));

/** Scarica il listone e reimporta. Da usare SOLO prima dell'asta, mai durante.
 *  Attenzione: da un IP di datacenter fantacalcio.it risponde spesso 401, quindi
 *  in produzione la via buona e' l'upload manuale (POST /api/listone/upload).
 *  Questa resta utile quando la rete di partenza e' "normale". */
export async function scaricaListone() {
  let res;
  try {
    res = await fetch(LISTONE_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const causa = e.name === 'TimeoutError' ? 'nessuna risposta entro ' + TIMEOUT_MS / 1000 + 's' : e.message;
    throw new ErroreDownload(
      'download da fantacalcio.it fallito (' + causa + '). Il listone esistente non e\' stato toccato.'
    );
  }
  if (!res.ok)
    throw new ErroreDownload(
      'fantacalcio.it ha risposto ' + res.status + ' ' + res.statusText + '. Il listone esistente non e\' stato toccato.'
    );

  const buf = Buffer.from(await res.arrayBuffer());
  return { scaricatoIl: new Date().toISOString(), ...salvaEImporta(buf, 'il file scaricato') };
}
