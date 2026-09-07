import { getDb } from '../db.js';

/** Quanto costa chiedere a Claude, contato riga per riga.
 *
 *  Ogni risposta dell'API porta usage.input_tokens e usage.output_tokens: si
 *  salvano tutti, con il modello che li ha prodotti. Il costo si calcola da
 *  qui e da nessun'altra parte, cosi' non ci sono due tariffari che divergono.
 *
 *  Non e' contabilita': e' sapere quanto e' costata l'asta prima di scoprirlo
 *  dalla fattura. */

/** Tariffe in dollari per milione di token.
 *
 *  Annotate il 7 settembre 2026. NON si aggiornano da sole: se Anthropic cambia
 *  listino, questa tabella resta indietro e i costi salvati con la vecchia
 *  tariffa restano quelli - un costo e' un fatto del giorno in cui e' stato
 *  calcolato, non un valore da ricalcolare a posteriori.
 *
 *  C'e' solo il modello che l'applicazione usa davvero. Aggiungerne altri "per
 *  sicurezza" vorrebbe dire scrivere prezzi che non ho verificato, e un prezzo
 *  inventato e' peggio di un prezzo assente: quello assente si vede. */
export const TARIFFE = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
};
export const TARIFFE_AGGIORNATE_AL = '2026-09-07';

/** Il costo di una chiamata, o null se il modello non e' in tabella.
 *  Null e non una stima: un numero verosimile ma inventato finirebbe sommato
 *  a quelli veri e nessuno saprebbe piu' quale parte del totale e' reale. */
export function costoDi(modello, uso) {
  const t = TARIFFE[modello];
  if (!t) return null;
  const input = Number(uso?.input ?? uso?.input_tokens ?? 0);
  const output = Number(uso?.output ?? uso?.output_tokens ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return (input / 1e6) * t.input + (output / 1e6) * t.output;
}

export const TIPI = ['consulente', 'note'];

/** Registra una chiamata. Torna quello che ha scritto, costo compreso, cosi'
 *  chi ha chiesto puo' mostrarlo senza rileggere. */
export function registra({ tipo, modello, uso }) {
  const input = Number(uso?.input ?? uso?.input_tokens ?? 0);
  const output = Number(uso?.output ?? uso?.output_tokens ?? 0);
  const costo = costoDi(modello, { input, output });
  const created_at = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO consumo (tipo, modello, input_tokens, output_tokens, costo, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(tipo, modello, input, output, costo, created_at);
  return { tipo, modello, input, output, costo, created_at };
}

const AGGREGATO = `SELECT count(*) AS chiamate,
                          coalesce(sum(input_tokens), 0) AS input,
                          coalesce(sum(output_tokens), 0) AS output,
                          sum(costo) AS costo,
                          sum(costo IS NULL) AS senzaCosto`;

const vuoto = (tipo = null) => ({ tipo, chiamate: 0, input: 0, output: 0, costo: 0, senzaCosto: 0 });

/** Il conto: per tipo, in totale, e da un certo momento in poi.
 *  `da` serve al pannello dell'asta, che mostra quanto e' costata questa
 *  sessione e non tutta la storia dell'archivio. */
export function consumo(da = null) {
  const db = getDb();
  const perTipo = db.prepare(`${AGGREGATO}, tipo FROM consumo GROUP BY tipo ORDER BY tipo`).all();
  const totale = db.prepare(`${AGGREGATO} FROM consumo`).get() ?? vuoto();
  const sessione = da
    ? db.prepare(`${AGGREGATO}, tipo FROM consumo WHERE created_at >= ? GROUP BY tipo`).all(da)
    : [];
  return {
    // Un tipo senza righe compare comunque a zero: "nessuna chiamata" e'
    // un'informazione, una riga che manca sembra un dato non caricato.
    perTipo: TIPI.map((t) => ({ ...vuoto(t), ...(perTipo.find((x) => x.tipo === t) ?? {}) })),
    totale: { ...vuoto(), ...totale },
    sessione: TIPI.map((t) => ({ ...vuoto(t), ...(sessione.find((x) => x.tipo === t) ?? {}) })),
    da,
    tariffe: Object.entries(TARIFFE).map(([modello, p]) => ({ modello, ...p })),
    tariffeAggiornateAl: TARIFFE_AGGIORNATE_AL,
  };
}
