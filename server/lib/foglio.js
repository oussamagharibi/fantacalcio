import fs from 'node:fs';
import * as XLSX from 'xlsx';

/** Primitivi condivisi dai file Excel di Fantacalcio.it: listone e statistiche
 *  hanno lo stesso impianto (righe di servizio in testa, intestazione da
 *  trovare per contenuto, piu' fogli di cui uno completo). Stanno qui per non
 *  averne due copie che col tempo divergono. */

export class ErroreFoglio extends Error {
  constructor(messaggio, { righeGrezze = null } = {}) {
    super(messaggio);
    this.name = 'ErroreFoglio';
    this.righeGrezze = righeGrezze;
  }
}

export const normalizza = (v) => String(v ?? '').trim().toLowerCase();

export const intero = (v) =>
  Number.isFinite(v) ? Math.trunc(v) : /^-?\d+$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : null;

/** Medie e fantamedie arrivano come numero, oppure come testo con la virgola
 *  decimale ("6,25") se il foglio e' stato salvato in locale italiano. */
export const decimale = (v) => {
  if (Number.isFinite(v)) return v;
  const s = String(v ?? '')
    .trim()
    .replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

/** L'intestazione non e' mai la prima riga: sopra c'e' almeno un titolo di
 *  servizio. La si cerca per contenuto, non per posizione. */
const eIntestazione = (riga) => {
  if (!Array.isArray(riga)) return false;
  const celle = riga.map(normalizza);
  return celle.includes('nome') && celle.includes('squadra');
};

/** Apre il foglio completo (quello preferito se c'e', altrimenti il primo) e
 *  individua la riga di intestazione. */
export function apriFoglio(origine, { foglioPreferito, descrizione = 'il file' } = {}) {
  const buf = Buffer.isBuffer(origine) ? origine : fs.readFileSync(origine);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const foglio = foglioPreferito && wb.SheetNames.includes(foglioPreferito) ? foglioPreferito : wb.SheetNames[0];
  if (!foglio) throw new ErroreFoglio(`${descrizione}: il file non contiene nessun foglio`);

  const griglia = XLSX.utils.sheet_to_json(wb.Sheets[foglio], { header: 1, raw: true, blankrows: false });
  const rigaHeader = griglia.findIndex(eIntestazione);
  if (rigaHeader < 0)
    throw new ErroreFoglio(
      `${descrizione}: intestazione non trovata nel foglio "${foglio}", nessuna riga contiene sia "Nome" che ` +
        '"Squadra". Il formato e\' cambiato, oppure non e\' un file di Fantacalcio.it.',
      { righeGrezze: griglia.slice(0, 5) }
    );

  return {
    fogli: wb.SheetNames,
    foglio,
    griglia,
    rigaHeader,
    header: griglia[rigaHeader].map(normalizza),
    dati: griglia.slice(rigaHeader + 1),
  };
}

/** Indici delle colonne cercate. Quelle elencate in opzionali possono mancare
 *  (restano a -1); se ne manca una obbligatoria e' un errore esplicito, non
 *  una colonna letta per sbaglio dalla posizione sbagliata. */
export function indiciColonne(aperto, colonne, opzionali = [], descrizione = 'il file') {
  const idx = {};
  for (const [campo, etichetta] of Object.entries(colonne)) idx[campo] = aperto.header.indexOf(normalizza(etichetta));
  const mancanti = Object.entries(idx)
    .filter(([campo, i]) => i < 0 && !opzionali.includes(campo))
    .map(([campo]) => colonne[campo]);
  if (mancanti.length)
    throw new ErroreFoglio(`${descrizione}: colonne mancanti nel foglio "${aperto.foglio}" -> ${mancanti.join(', ')}`, {
      righeGrezze: aperto.griglia.slice(0, 5),
    });
  return idx;
}
