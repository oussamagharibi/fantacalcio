import path from 'node:path';
import fs from 'node:fs';
import { getDb, tx, backup, perLog, DATA_DIR } from '../db.js';
import { ErroreFoglio, apriFoglio, indiciColonne, intero, decimale } from './foglio.js';

/** Le stagioni da importare, in ordine di interesse. Il nome del file e' quello
 *  con cui si scarica da Fantacalcio.it, la chiave finisce in stats.stagione. */
export const STAGIONI = [
  { stagione: '2025-26', file: 'stats-2025-26.xlsx' },
  { stagione: '2024-25', file: 'stats-2024-25.xlsx' },
];

/** Come nel listone: il file ha un foglio per ruolo piu' quello completo. */
const FOGLIO = 'Tutti';

/** Un file di statistiche completo copre piu' o meno tutti i giocatori del
 *  listino. Se ne porta molti meno e' quasi certamente il foglio di un solo
 *  ruolo: si rifiuta la stagione invece di lasciare in archivio dati parziali
 *  che poi sembrano assenze di rendimento. */
export const SOGLIA_RIGHE = 0.75;

const COLONNE = {
  id: 'Id',
  nome: 'Nome',
  squadra: 'Squadra',
  ruolo: 'R',
  pv: 'PV',
  mv: 'MV',
  fm: 'FM',
  // I gol fatti si chiamano "Gf" nel formato attuale. "Gol" resta come alias
  // perche' un file scaricato prima del cambio deve continuare a leggersi.
  gol: ['Gf', 'Gol'],
  gs: 'GS',
  // I rigori non stanno piu' in una cella sola "3 / 4": il foglio li divide in
  // Rc (calciati), R+ (segnati) e R- (sbagliati). Sui file veri R+ + R- fa
  // esattamente Rc, riga per riga, quindi i tirati si leggono da Rc.
  rigCalciati: 'Rc',
  rigSegnati: 'R+',
  rigSbagliati: 'R-',
  rig: 'Rig', // formato vecchio, "segnati / tirati" in una cella sola
  rigParati: 'RP',
  assist: 'Ass',
  amm: 'Amm',
  esp: 'Esp',
};
/** Senza Id e Nome/Squadra non si fa niente; il resto puo' mancare. */
const OBBLIGATORIE = ['id', 'nome', 'squadra'];
const OPZIONALI = Object.keys(COLONNE).filter((k) => !OBBLIGATORIE.includes(k));

/** Cosa il foglio dovrebbe darci, e da quali colonne il dato puo' arrivare.
 *  Si ragiona per DATO e non per colonna: "Rig" assente non e' un problema se
 *  il foglio ha "R+", e dirlo lo stesso sarebbe rumore che nasconde gli avvisi
 *  veri. Un dato manca solo quando nessuna delle sue colonne c'e'. */
const DATI_ATTESI = [
  { dato: 'presenze', campi: ['pv'] },
  { dato: 'media voto', campi: ['mv'] },
  { dato: 'fantamedia', campi: ['fm'] },
  { dato: 'gol fatti', campi: ['gol'] },
  { dato: 'gol subiti', campi: ['gs'] },
  { dato: 'rigori segnati e tirati', campi: ['rigSegnati', 'rig'] },
  { dato: 'rigori parati', campi: ['rigParati'] },
  { dato: 'assist', campi: ['assist'] },
  { dato: 'ammonizioni', campi: ['amm'] },
  { dato: 'espulsioni', campi: ['esp'] },
];

const etichette = (campi) =>
  campi
    .flatMap((c) => (Array.isArray(COLONNE[c]) ? COLONNE[c] : [COLONNE[c]]))
    .map((e) => `"${e}"`)
    .join(' o ');

/** Gli avvisi da mettere nell'esito dell'import. Prima una colonna assente
 *  diventava un NULL silenzioso e l'import riportava successo: e' cosi' che i
 *  gol sono rimasti vuoti per due caricamenti di fila senza che nulla lo dicesse. */
export const datiMancanti = (idx) =>
  DATI_ATTESI.filter((d) => d.campi.every((c) => (idx[c] ?? -1) < 0)).map(
    (d) => `colonna non trovata: ${d.dato} (attesa ${etichette(d.campi)})`
  );

/** "Rig" arriva come "3 / 4" (segnati su tirati). Con un solo numero si assume
 *  che sia il numero di rigori segnati e i tirati restano ignoti. */
function splitRigori(v) {
  if (v === null || v === undefined || v === '') return { segnati: null, tirati: null };
  const parti = String(v)
    .split(/[/\\]/)
    .map((s) => intero(s));
  if (parti.length >= 2) return { segnati: parti[0], tirati: parti[1] };
  return { segnati: parti[0] ?? null, tirati: null };
}

/** Segnati e tirati, da qualunque dei due formati il foglio usi.
 *  Se Rc manca ma ci sono R+ e R-, i tirati si ricavano sommandoli. */
function rigori(riga, idx) {
  const n = (campo) => (idx[campo] >= 0 ? intero(riga[idx[campo]]) : null);
  const segnati = n('rigSegnati');
  if (segnati === null) return splitRigori(idx.rig >= 0 ? riga[idx.rig] : null);
  const calciati = n('rigCalciati');
  const sbagliati = n('rigSbagliati');
  return { segnati, tirati: calciati ?? (sbagliati === null ? null : segnati + sbagliati) };
}

/** Legge un file di statistiche. Non tocca il db: separare lettura e scrittura
 *  permette di validare tutto prima di aprire la transazione. */
export function leggiStats(origine, stagione) {
  const descrizione = `statistiche ${stagione}`;
  const aperto = apriFoglio(origine, { foglioPreferito: FOGLIO, descrizione });
  const idx = indiciColonne(aperto, COLONNE, OPZIONALI, descrizione);
  const opz = (riga, campo, f = intero) => (idx[campo] >= 0 ? f(riga[idx[campo]]) : null);

  const righe = [];
  const scartate = [];
  for (const [n, riga] of aperto.dati.entries()) {
    const numeroRiga = aperto.rigaHeader + n + 2; // 1-based, come la vede Excel
    const id = intero(riga[idx.id]);
    if (id === null) {
      scartate.push({ riga: numeroRiga, motivo: 'Id mancante o non numerico', dati: riga });
      continue;
    }
    const rig = rigori(riga, idx);
    righe.push({
      player_id: id,
      nome: String(riga[idx.nome] ?? '').trim(),
      stagione,
      pv: opz(riga, 'pv'),
      mv: opz(riga, 'mv', decimale),
      fm: opz(riga, 'fm', decimale),
      gol: opz(riga, 'gol'),
      gs: opz(riga, 'gs'),
      rig_segnati: rig.segnati,
      rig_tirati: rig.tirati,
      rig_parati: opz(riga, 'rigParati'),
      assist: opz(riga, 'assist'),
      amm: opz(riga, 'amm'),
      esp: opz(riga, 'esp'),
    });
  }
  return {
    foglio: aperto.foglio,
    fogli: aperto.fogli,
    rigaHeader: aperto.rigaHeader + 1,
    righe,
    scartate,
    // gli avvisi viaggiano con il letto e arrivano fino all'esito dell'import
    colonneMancanti: datiMancanti(idx),
  };
}

/** Scrive una stagione. Idempotente sulla chiave (player_id, stagione).
 *  Chi non e' in players viene scartato: sono giocatori che hanno lasciato la
 *  Serie A e non compaiono nel listone di quest'anno. Nessun calcolo derivato:
 *  qui finiscono solo i numeri come stanno nel file. */
export function importaStagione(letto, { controllaSoglia = true } = {}) {
  const inListino = getDb().prepare('SELECT count(*) AS n FROM players WHERE assente_dal IS NULL').get().n;
  const troppePoche = controllaSoglia && inListino > 0 && letto.righe.length < inListino * SOGLIA_RIGHE;
  if (troppePoche)
    throw new ErroreFoglio(
      `${letto.righe.length} righe utili nel foglio "${letto.foglio}", troppe poche per una stagione completa ` +
        `(in listino ci sono ${inListino} giocatori). Sembra il foglio di un solo ruolo: stagione non importata.`
    );

  const noti = new Set(getDb().prepare('SELECT id FROM players').all().map((r) => r.id));
  const senzaGiocatore = letto.righe.filter((r) => !noti.has(r.player_id));
  const daScrivere = letto.righe.filter((r) => noti.has(r.player_id));

  const stagione = letto.righe[0]?.stagione ?? null;
  const gia = new Set(
    getDb()
      .prepare('SELECT player_id FROM stats WHERE stagione = ?')
      .all(stagione)
      .map((r) => r.player_id)
  );

  const { inserite, aggiornate } = tx((d) => {
    const up = d.prepare(
      `INSERT INTO stats (player_id, stagione, pv, mv, fm, gol, gs, rig_segnati, rig_tirati, rig_parati, assist, amm, esp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id, stagione) DO UPDATE SET
         pv = excluded.pv, mv = excluded.mv, fm = excluded.fm, gol = excluded.gol, gs = excluded.gs,
         rig_segnati = excluded.rig_segnati, rig_tirati = excluded.rig_tirati, rig_parati = excluded.rig_parati,
         assist = excluded.assist, amm = excluded.amm, esp = excluded.esp`
    );
    let ins = 0;
    for (const r of daScrivere) {
      up.run(
        r.player_id, r.stagione, r.pv, r.mv, r.fm, r.gol, r.gs,
        r.rig_segnati, r.rig_tirati, r.rig_parati, r.assist, r.amm, r.esp
      );
      if (!gia.has(r.player_id)) ins++;
    }
    return { inserite: ins, aggiornate: daScrivere.length - ins };
  });

  return {
    stagione,
    foglio: letto.foglio,
    rigaHeader: letto.rigaHeader,
    righeLette: letto.righe.length + letto.scartate.length,
    inserite,
    aggiornate,
    scartateRiga: letto.scartate,
    colonneMancanti: letto.colonneMancanti ?? [],
    senzaGiocatore,
    inDb: getDb().prepare('SELECT count(*) AS n FROM stats WHERE stagione = ?').get(stagione).n,
  };
}

/** Importa tutte le stagioni presenti. Un file mancante non e' un errore
 *  fatale: si segnala e si prosegue con le altre. */
export function importaStats({ dir = DATA_DIR, stagioni = STAGIONI } = {}) {
  const backupDb = backup('pre-stats');
  const esiti = [];
  for (const { stagione, file } of stagioni) {
    const percorso = path.join(dir, file);
    if (!fs.existsSync(percorso)) {
      esiti.push({ stagione, file: percorso, mancante: true });
      continue;
    }
    try {
      esiti.push({ file: percorso, ...importaStagione(leggiStats(percorso, stagione)) });
    } catch (e) {
      if (!(e instanceof ErroreFoglio)) throw e;
      esiti.push({ stagione, file: percorso, errore: e.message, righeGrezze: e.righeGrezze ?? null });
    }
  }
  return { backupDb, esiti };
}

/** Lo storico fanta di ogni giocatore, stagione per stagione, per la pagina
 *  dettaglio. Le stagioni si ordinano per ANNO d'inizio e non per testo.
 *  Questi SI' sono dati di fantacalcio: media voto e fantamedia. Quelli di
 *  carriera (Wikipedia) e di xg (Understat) sono calcio vero, non confonderli. */
export function statsPerGiocatore() {
  const righe = getDb()
    .prepare(
      `SELECT player_id, stagione, pv, mv, fm, gol, gs, rig_segnati, rig_tirati,
              rig_parati, assist, amm, esp
         FROM stats
        ORDER BY player_id, CAST(substr(stagione, 1, 4) AS INTEGER), stagione`
    )
    .all();
  const per = new Map();
  for (const r of righe) {
    if (!per.has(r.player_id)) per.set(r.player_id, []);
    per.get(r.player_id).push(r);
  }
  return per;
}

// ------------------------------------------------------------------- upload

/** Stesse difese del listone: un file troppo piccolo o che non e' un xlsx non
 *  entra nemmeno in lettura, e quello che c'e' in archivio resta dov'e'. */
const MAGIC_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const DIMENSIONE_MINIMA = 10 * 1024;

/** A quale stagione appartiene un file caricato. Si guarda il nome, che e'
 *  quello con cui Fantacalcio.it lo fa scaricare. Se non si riconosce si
 *  rifiuta: scrivere una stagione sotto l'etichetta sbagliata e' peggio che
 *  non scriverla. */
export function stagioneDelFile(nomeFile) {
  const b = path.basename(String(nomeFile ?? '')).toLowerCase();
  return (
    STAGIONI.find((s) => s.file.toLowerCase() === b) ??
    STAGIONI.find((s) => b.includes(s.stagione)) ??
    null
  );
}

/** Carica uno o piu' file di statistiche, li salva in /data e importa.
 *  Si valida e si legge TUTTO prima di scrivere qualsiasi cosa: se il secondo
 *  file e' sbagliato non si resta con il primo importato e l'altro no. */
export function salvaEImportaStats(caricati) {
  if (!caricati.length) throw new ErroreFoglio('nessun file ricevuto');

  const pronti = caricati.map(({ buf, nomeFile }) => {
    const dove = `"${nomeFile}"`;
    if (buf.length < DIMENSIONE_MINIMA)
      throw new ErroreFoglio(
        `${dove} pesa ${buf.length} byte (minimo ${DIMENSIONE_MINIMA}): scartato, l'archivio non e' stato toccato.`
      );
    if (!buf.subarray(0, 4).equals(MAGIC_ZIP)) {
      const magic = [...buf.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
      throw new ErroreFoglio(
        `${dove} non e' un xlsx (magic number ${magic}, atteso 50 4b 03 04): scartato, l'archivio non e' stato toccato.`
      );
    }
    const s = stagioneDelFile(nomeFile);
    if (!s)
      throw new ErroreFoglio(
        `${dove}: non capisco a quale stagione appartiene. I nomi attesi sono ${STAGIONI.map((x) => x.file).join(' e ')}.`
      );
    // leggere qui vuol dire fallire prima di aver scritto niente
    return { buf, nomeFile, ...s, letto: leggiStats(buf, s.stagione) };
  });

  const doppie = pronti.map((p) => p.stagione).filter((x, i, a) => a.indexOf(x) !== i);
  if (doppie.length) throw new ErroreFoglio(`due file per la stessa stagione (${doppie.join(', ')}): caricane uno solo per stagione.`);

  const backupDb = backup('pre-upload-stats');
  const esiti = [];
  for (const p of pronti) {
    const destinazione = path.join(DATA_DIR, p.file);
    let backupFile = null;
    if (fs.existsSync(destinazione)) {
      const dir = path.join(DATA_DIR, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${path.basename(p.file, '.xlsx')}-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);
      fs.copyFileSync(destinazione, dest);
      backupFile = perLog(dest);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(destinazione, p.buf);
    const r = importaStagione(p.letto);
    esiti.push({
      nomeFile: p.nomeFile,
      stagione: r.stagione,
      foglio: r.foglio,
      righeLette: r.righeLette,
      inserite: r.inserite,
      aggiornate: r.aggiornate,
      scartate: r.scartateRiga.length,
      colonneMancanti: r.colonneMancanti,
      senzaGiocatore: r.senzaGiocatore.length,
      inDb: r.inDb,
      backupFile,
    });
  }
  return { backupDb, stagioni: esiti, coperti: getDb().prepare('SELECT count(DISTINCT player_id) AS n FROM stats').get().n };
}
