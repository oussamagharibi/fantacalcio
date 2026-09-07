import { getDb, tx } from '../db.js';
import { scaricaSePermesso, ErroreHttp } from './web.js';
import { abbina } from './fantacalcio.js';
import { MODELLO, PREZZO, stimaToken } from './analisi.js';
import Anthropic from '@anthropic-ai/sdk';

/** Gerarchie titolare/vice, estratte da pagine divise per squadra.
 *
 *  Perche' qui si puo' e sugli articoli no: queste pagine hanno una sezione
 *  per squadra, con la formazione-tipo accanto. Il modello vede il testo di UNA
 *  squadra alla volta, quindi "Bastoni" non puo' finire attribuito a un altro
 *  Bastoni, e "il vice e' Carlos Augusto" non puo' agganciarsi al giocatore
 *  sbagliato. Senza segmentazione questo modulo non si dovrebbe scrivere: il
 *  contesto pulito e' la ragione per cui funziona.
 *
 *  Costa. Una chiamata per squadra, venti per pagina: si stampa la stima e si
 *  parte solo con --yes. */

const SQUADRE_NOTE = () =>
  getDb().prepare('SELECT DISTINCT squadra FROM players WHERE assente_dal IS NULL ORDER BY squadra').all().map((r) => r.squadra);

/** Fine dell'articolo. Oltre questi marcatori comincia la coda del sito -
 *  notizie correlate, commenti - che nomina decine di giocatori di altre
 *  squadre. Darla in pasto al modello vorrebbe dire invitarlo a inventare
 *  coppie con nomi che passavano di li' per caso. */
const FINE_ARTICOLO = [
  /©\s*RIPRODUZIONE RISERVATA/i,
  /\bRIPRODUZIONE RISERVATA\b/i,
  /\bContinua la lettura\b/i,
  /\bUltime Notizie\b/i,
  /\bLeggi altri commenti\b/i,
  /\bPotrebbe interessarti\b/i,
];

/** Cintura di sicurezza: le sezioni vere stanno fra i 400 e i 1300 caratteri. */
export const MAX_SEZIONE = 4000;

/** Il corpo dell articolo, quando la pagina lo racchiude in un elemento suo.
 *  Serve all ULTIMA sezione, che altrimenti arriva fino in fondo al documento
 *  e si porta dietro la coda del sito: su Calcio d Angolo sono duemila
 *  caratteri di articoli correlati che nominano Vicario, Maignan e Berardi.
 *  Dati in pasto al modello come se fossero il Venezia, sono un invito a
 *  inventare coppie con nomi passati di li per caso. */
export function soloCorpo(html, fine) {
  if (!fine) return html;
  const m = fine.exec(String(html ?? ''));
  return m ? String(html).slice(0, m.index) : html;
}

export function testoPulito(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \n]+/g, '\n')
    .trim();
}

const taglia = (t) => {
  let fine = t.length;
  for (const re of FINE_ARTICOLO) {
    const m = re.exec(t);
    if (m && m.index < fine) fine = m.index;
  }
  return t.slice(0, Math.min(fine, MAX_SEZIONE)).trim();
};

/** L'ultima sezione non ha una squadra dopo di se' a farle da confine: arriva
 *  fino in fondo al documento e si porta dietro tutto il sito. I marcatori di
 *  fine articolo bastano dove ci sono, ma non sono garantiti.
 *
 *  Allora la si limita a quanto e' lunga la piu' lunga delle altre. Non e' una
 *  cifra scelta a caso: le altre sezioni sono delimitate da una struttura vera,
 *  e nessuna squadra ha una scheda piu' lunga di tutte le altre messe insieme.
 *  Quello che si perde e' coda del sito; quello che si terrebbe, senza, sono
 *  nomi di giocatori di altre squadre dati in pasto al modello come se fossero
 *  di questa. */
function limitaUltima(sezioni) {
  if (sezioni.length < 2) return sezioni;
  const altre = sezioni.slice(0, -1).map((s) => s.testo.length);
  const tetto = Math.max(...altre);
  const ultima = sezioni[sezioni.length - 1];
  if (ultima.testo.length <= tetto) return sezioni;
  return [...sezioni.slice(0, -1), { ...ultima, testo: ultima.testo.slice(0, tetto).trim() }];
}

/** SOS Fanta: il nome della squadra compare tutto maiuscolo nel flusso del
 *  testo, non dentro un tag suo. Cercare il grassetto perdeva il Monza, che e'
 *  scritto uguale ma senza <strong>. */
export function sezioniMaiuscole(html, squadre = SQUADRE_NOTE()) {
  const t = testoPulito(html);
  const teste = [];
  for (const s of squadre) {
    const re = new RegExp(`(?<![A-Za-zÀ-ÿ])${s.toUpperCase()}(?![A-Za-zÀ-ÿ])`, 'g');
    const prima = re.exec(t);
    if (prima) teste.push({ squadra: s, pos: prima.index });
  }
  teste.sort((a, b) => a.pos - b.pos);
  return limitaUltima(teste.map((x, i) => ({ squadra: x.squadra, testo: taglia(t.slice(x.pos, teste[i + 1]?.pos ?? t.length)) })));
}

/** Calcio d'Angolo: un <h3> per squadra ("Atalanta 2026/2027 - come
 *  giocherebbe oggi"). Il menu di navigazione nomina tutte le squadre, ma non
 *  dentro un h3: e' per questo che qui si guarda il tag e non il testo. */
export function sezioniH3(html, squadre = SQUADRE_NOTE()) {
  const teste = [];
  for (const m of String(html ?? '').matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
    const t = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const s = squadre.find((x) => new RegExp(`\\b${x}\\b`, 'i').test(t));
    if (s && !teste.some((y) => y.squadra === s)) teste.push({ squadra: s, pos: m.index });
  }
  return limitaUltima(
    teste.map((x, i) => ({
      squadra: x.squadra,
      testo: taglia(testoPulito(String(html).slice(x.pos, teste[i + 1]?.pos ?? html.length))),
    }))
  );
}

// ------------------------------------------------------------------ il prompt

/** Testuale come concordato. Il modello non deve raccontare: deve restituire
 *  JSON e omettere quello che il testo non dice. */
export const ISTRUZIONI = `Da questo testo su una squadra di Serie A, estrai le coppie titolare/alternativa per ogni posizione in campo.
Rispondi SOLO in JSON, nessun preambolo, nessun markdown:
[{"titolare":"...","alternativa":"...","posizione":"...","certezza":"alta|media|bassa"}]
Usa i nomi esattamente come compaiono nel testo.
Se il testo non permette di stabilire una coppia, non inventarla: ometti quella posizione.
certezza alta = il testo lo dice esplicitamente (es. 'X e' il vice di Y'); media = si deduce dalla formazione; bassa = incerto.`;

export const CERTEZZE = ['alta', 'media', 'bassa'];
const MAX_TOKENS = 1500;

/** Il JSON puo' arrivare avvolto in un blocco markdown anche quando si chiede
 *  di non farlo: si toglie la cornice prima di leggere. Quello che non e' un
 *  array di oggetti con i quattro campi giusti viene scartato, non corretto. */
export function leggiRisposta(testo) {
  const grezzo = String(testo ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const inizio = grezzo.indexOf('[');
  const fine = grezzo.lastIndexOf(']');
  if (inizio === -1 || fine <= inizio) return { coppie: [], errore: 'nessun array JSON nella risposta' };
  let dati;
  try {
    dati = JSON.parse(grezzo.slice(inizio, fine + 1));
  } catch (e) {
    return { coppie: [], errore: `JSON illeggibile: ${e.message}` };
  }
  if (!Array.isArray(dati)) return { coppie: [], errore: 'la risposta non e\' un array' };
  const coppie = [];
  const scartate = [];
  for (const x of dati) {
    const titolare = String(x?.titolare ?? '').trim();
    const alternativa = String(x?.alternativa ?? '').trim();
    const certezza = String(x?.certezza ?? '').trim().toLowerCase();
    if (!titolare || !alternativa || titolare === alternativa) {
      scartate.push({ voce: x, motivo: 'coppia incompleta o con lo stesso nome due volte' });
      continue;
    }
    if (!CERTEZZE.includes(certezza)) {
      scartate.push({ voce: x, motivo: `certezza "${certezza}" non riconosciuta` });
      continue;
    }
    coppie.push({ titolare, alternativa, posizione: String(x?.posizione ?? '').trim() || null, certezza });
  }
  return { coppie, scartate, errore: null };
}

/** Una chiamata per squadra. Errori tipizzati come in analisi.js: un 429 si
 *  riprova piu' tardi, un 400 no. */
export async function estraiCoppie(client, squadra, testo) {
  try {
    const risposta = await client.messages.create({
      model: MODELLO,
      max_tokens: MAX_TOKENS,
      system: ISTRUZIONI,
      messages: [{ role: 'user', content: `Squadra: ${squadra}\n\n${testo}` }],
    });
    const grezzo = risposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return {
      ok: true,
      ...leggiRisposta(grezzo),
      grezzo,
      uso: { input: risposta.usage.input_tokens, output: risposta.usage.output_tokens },
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, errore: 'chiave API non valida', coppie: [] };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, errore: "rate limit: riprova piu' tardi", coppie: [] };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, errore: `richiesta rifiutata: ${e.message}`, coppie: [] };
    if (e instanceof Anthropic.APIError) return { ok: false, errore: `errore API ${e.status}: ${e.message}`, coppie: [] };
    return { ok: false, errore: e.message, coppie: [] };
  }
}

// ------------------------------------------------------------- abbinamento

/** I nomi tornano come li scrive la pagina. Si abbinano con gli stessi
 *  guardiani usati per infortuni e titolarita': dentro la squadra, per nome
 *  esatto o per cognome, e due omonimi nella stessa rosa restano NON abbinati.
 *  Una coppia con anche un solo nome non risolto si scarta intera: mezza
 *  gerarchia non e' un'informazione. */
export function abbinaGerarchie(coppie, squadra) {
  const voci = coppie.flatMap((c) => [
    { id: null, nome: c.titolare, squadra },
    { id: null, nome: c.alternativa, squadra },
  ]);
  const { abbinate, nonAbbinati } = abbina(voci);
  const perNome = new Map(abbinate.map((a) => [a.nome, a.player_id]));
  const motivi = new Map(nonAbbinati.map((n) => [n.nome, n.motivo]));
  const buone = [];
  const scartate = [];
  for (const c of coppie) {
    const t = perNome.get(c.titolare);
    const a = perNome.get(c.alternativa);
    if (t && a && t !== a) {
      buone.push({ ...c, squadra, player_id_titolare: t, player_id_alternativa: a });
      continue;
    }
    const guasti = [
      !t && `titolare "${c.titolare}": ${motivi.get(c.titolare) ?? 'non risolto'}`,
      !a && `alternativa "${c.alternativa}": ${motivi.get(c.alternativa) ?? 'non risolto'}`,
      t && a && t === a && 'titolare e alternativa sono la stessa riga del listone',
    ].filter(Boolean);
    scartate.push({ ...c, squadra, motivo: guasti.join(' | ') });
  }
  return { abbinate: buone, scartate };
}

/** Come per i segnali: si riscrive quello che viene da questa fonte e basta.
 *  Due fonti che dicono la stessa coppia restano due righe, e vederle
 *  entrambe e' proprio il punto. */
export function salvaGerarchie(righe, fonte, data) {
  return tx((d) => {
    const rimossi = d.prepare('DELETE FROM gerarchie WHERE fonte = ?').run(fonte).changes;
    const ins = d.prepare(
      `INSERT INTO gerarchie (player_id_titolare, player_id_alternativa, posizione, certezza, fonte, data)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id_titolare, player_id_alternativa, fonte) DO UPDATE SET
         posizione = excluded.posizione, certezza = excluded.certezza, data = excluded.data`
    );
    let scritte = 0;
    for (const r of righe) {
      ins.run(r.player_id_titolare, r.player_id_alternativa, r.posizione, r.certezza, fonte, data);
      scritte++;
    }
    return { rimossi, scritte };
  });
}

// -------------------------------------------------------------- il registro

export const PAGINE_GERARCHIE = [
  { fonte: 'SOS Fanta formazioni tipo', segmenta: sezioniMaiuscole },
  // Il corpo sta in un <article> solo: fuori di li comincia la coda del sito.
  { fonte: "Calcio d'Angolo formazioni tipo", segmenta: sezioniH3, corpo: /<\/article>/i },
  { fonte: 'SOS Fanta gerarchie portieri', segmenta: sezioniMaiuscole },
];

export const FONTI_GERARCHIE = new Set(PAGINE_GERARCHIE.map((p) => p.fonte));

/** Scarica e segmenta, senza chiamare il modello. Serve alla stima dei costi e
 *  alla verifica: se la segmentazione non torna, meglio saperlo prima di
 *  spendere. */
export async function segmenta(fonti, log = () => {}) {
  const attese = SQUADRE_NOTE();
  const esiti = [];
  for (const p of PAGINE_GERARCHIE) {
    const f = fonti.find((x) => x.nome === p.fonte);
    const esito = { fonte: p.fonte, url: f?.url ?? null, sezioni: [], mancanti: [], errore: null };
    esiti.push(esito);
    if (!f?.attiva) {
      esito.errore = 'fonte spenta';
      continue;
    }
    if (!f.url) {
      esito.errore = f.errore ?? 'nessun url';
      log(`${p.fonte}: ${esito.errore}`);
      continue;
    }
    try {
      const risposta = await scaricaSePermesso(f.url);
      if (!risposta) throw new Error('robots.txt vieta la pagina');
      esito.sezioni = p.segmenta(soloCorpo(risposta.testo, p.corpo), attese).filter((s) => s.testo.length > 80);
      esito.mancanti = attese.filter((s) => !esito.sezioni.some((x) => x.squadra === s));
      log(`${p.fonte}: ${esito.sezioni.length} sezioni su ${attese.length}${esito.mancanti.length ? ` (mancano: ${esito.mancanti.join(', ')})` : ''}`);
    } catch (e) {
      esito.errore = e instanceof ErroreHttp ? `HTTP ${e.stato}` : e.message;
      log(`${p.fonte}: ${esito.errore} - salto la pagina, le altre proseguono`);
    }
  }
  return esiti;
}

/** Quanto costera'. Le sezioni sono gia' in mano: si stima sul testo vero, non
 *  su una media inventata. */
export function stima(esiti) {
  let chiamate = 0;
  let tokenInput = 0;
  for (const e of esiti)
    for (const s of e.sezioni) {
      chiamate++;
      tokenInput += stimaToken(ISTRUZIONI) + stimaToken(s.testo) + 20;
    }
  // Una coppia occupa una cinquantina di token; una squadra ne produce meno di
  // dieci. Trecento token di uscita per chiamata sono una stima larga.
  const tokenOutput = chiamate * 300;
  return {
    chiamate,
    tokenInput,
    tokenOutput,
    dollari: PREZZO ? (tokenInput / 1e6) * PREZZO.input + (tokenOutput / 1e6) * PREZZO.output : null,
  };
}

/** Il giro completo. Una chiamata per squadra, gli errori isolati per sezione:
 *  una squadra che fallisce non porta via le altre diciannove. */
export async function estrai(esiti, client, log = () => {}) {
  const adesso = new Date().toISOString();
  const uso = { input: 0, output: 0 };
  const riepilogo = [];
  for (const e of esiti) {
    if (e.errore) continue;
    const buone = [];
    const dettaglio = [];
    for (const s of e.sezioni) {
      const r = await estraiCoppie(client, s.squadra, s.testo);
      if (!r.ok) {
        log(`${e.fonte} / ${s.squadra}: ${r.errore}`);
        dettaglio.push({ squadra: s.squadra, errore: r.errore, coppie: [], scartate: [] });
        continue;
      }
      uso.input += r.uso.input;
      uso.output += r.uso.output;
      if (r.errore) log(`${e.fonte} / ${s.squadra}: ${r.errore}`);
      const { abbinate, scartate } = abbinaGerarchie(r.coppie, s.squadra);
      buone.push(...abbinate);
      dettaglio.push({ squadra: s.squadra, testo: s.testo, coppie: r.coppie, abbinate, scartate, errore: r.errore });
      for (const x of scartate) log(`${e.fonte} / ${s.squadra}: scartata ${x.titolare} -> ${x.alternativa} (${x.motivo})`);
      log(
        `${e.fonte} / ${s.squadra.padEnd(11)} coppie lette: ${String(r.coppie.length).padStart(2)} | abbinate: ${String(abbinate.length).padStart(2)} | scartate: ${scartate.length}`
      );
    }
    const { scritte, rimossi } = salvaGerarchie(buone, e.fonte, adesso);
    riepilogo.push({ fonte: e.fonte, squadre: e.sezioni.length, abbinate: buone.length, scritte, rimossi, dettaglio });
  }
  return { riepilogo, uso };
}

export const nuovoClient = () => new Anthropic();
export const chiaveMancante = () => !process.env.ANTHROPIC_API_KEY;
