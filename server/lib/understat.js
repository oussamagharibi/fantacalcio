import { getDb, tx } from '../db.js';
import { normalizza } from './testo.js';
import { inizialiCombaciano } from './wiki.js';

/** Expected goals da Understat.
 *
 *  ATTENZIONE a cosa sono questi numeri: xG e' la somma della probabilita' di
 *  gol delle occasioni avute, misurata su calcio vero. NON e' un punteggio di
 *  fantacalcio: media voto e fantamedia stanno in stats e arrivano dagli Excel
 *  di fantacalcio.it. Chi guarda l'interfaccia deve trovarlo scritto, o li
 *  confondera'. */

export const FONTE = 'understat.com';
export const PAGINA = (anno) => `https://understat.com/league/Serie_A/${anno}`;

/** Understat indica la stagione con l'anno d'inizio; nel resto dell'archivio le
 *  stagioni si scrivono per esteso, come su Wikipedia e negli Excel. */
export const stagioneDa = (anno) => `${Number(anno)}-${Number(anno) + 1}`;

// ----------------------------------------------------------- lettura dei dati

/** Le variabili di Understat sono stringhe con gli escape esadecimali di PHP
 *  (\x22 per la virgoletta): vanno sciolte prima di dare il testo a JSON.parse. */
export const sciogliEscape = (s) =>
  String(s ?? '')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** La tecnica classica: i dati stanno in una variabile JS dentro la pagina, non
 *  nel markup. Si estrae il JSON, non si fa parsing dell'HTML. */
export function estraiPlayersData(testo) {
  const m = /var\s+playersData\s*=\s*JSON\.parse\(\s*'([\s\S]*?)'\s*\)/.exec(String(testo ?? ''));
  if (!m) return { righe: null, motivo: 'nessuna variabile playersData nella pagina' };
  let dati;
  try {
    dati = JSON.parse(sciogliEscape(m[1]));
  } catch (e) {
    return { righe: null, motivo: `playersData trovata ma non e' JSON valido: ${e.message}` };
  }
  if (!Array.isArray(dati)) return { righe: null, motivo: "playersData non e' una lista" };
  return { righe: dati, motivo: null };
}

/** CSV con intestazione. Le virgolette servono davvero: il team_title di
 *  Understat contiene una virgola quando il giocatore ha cambiato club. */
export function leggiCsv(testo) {
  const righe = [];
  let campo = '';
  let riga = [];
  let dentro = false;
  const src = String(testo ?? '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (dentro) {
      if (c === '"' && src[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') dentro = false;
      else campo += c;
    } else if (c === '"') dentro = true;
    else if (c === ',' || c === ';') {
      riga.push(campo);
      campo = '';
    } else if (c === '\n') {
      riga.push(campo);
      righe.push(riga);
      campo = '';
      riga = [];
    } else if (c !== '\r') campo += c;
  }
  if (campo || riga.length) {
    riga.push(campo);
    righe.push(riga);
  }
  const piene = righe.filter((r) => r.some((c) => c.trim()));
  if (piene.length < 2) return [];
  const testata = piene[0].map((c) => c.trim());
  return piene.slice(1).map((r) => Object.fromEntries(testata.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** Un contenuto qualsiasi -> lista di oggetti grezzi. Tre forme accettate,
 *  perche' i dati possono arrivare dalla pagina (variabile playersData) o
 *  dall'esportazione che Understat offre sotto la tabella (json, csv). */
export function leggiContenuto(testo) {
  const s = String(testo ?? '').trim();
  const dalla = estraiPlayersData(s);
  if (dalla.righe) return { righe: dalla.righe, formato: 'playersData nella pagina' };
  // Se e' una pagina web il ramo CSV non va nemmeno tentato: su un HTML il
  // lettore di CSV non fallisce, restituisce righe di spazzatura con le
  // intestazioni prese da un tag. Meglio dire perche' playersData non si legge.
  if (/^\s*<(!doctype|html|script)/i.test(s) || /<\/html>/i.test(s))
    return { righe: null, motivo: `sembra una pagina web ma ${dalla.motivo}` };
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      const j = JSON.parse(s);
      const righe = Array.isArray(j) ? j : j.players ?? j.data;
      if (Array.isArray(righe)) return { righe, formato: 'json' };
      return { righe: null, motivo: 'json valido ma senza una lista di giocatori' };
    } catch (e) {
      return { righe: null, motivo: `json non valido: ${e.message}` };
    }
  }
  const csv = leggiCsv(s);
  if (csv.length) return { righe: csv, formato: 'csv' };
  return { righe: null, motivo: dalla.motivo };
}

// ------------------------------------------------------------- campi e numeri

/** I nomi dei campi cambiano fra la variabile playersData (player_name, xG) e
 *  l'esportazione della tabella (Player, xG). Si accettano entrambi, invece di
 *  indovinare quale dei due file ha in mano chi lancia il comando. */
const CAMPI = {
  nome: ['player_name', 'Player', 'player', 'name'],
  squadra: ['team_title', 'Team', 'team', 'club'],
  partite: ['games', 'Apps', 'apps', 'matches'],
  minuti: ['time', 'Min', 'minutes', 'min'],
  gol: ['goals', 'G', 'goals_scored'],
  xg: ['xG', 'xg', 'expected_goals'],
  assist: ['assists', 'A', 'assist', 'a'],
  xa: ['xA', 'xa', 'expected_assists'],
  tiri: ['shots', 'Sh', 'Shots'],
  passaggi_chiave: ['key_passes', 'KP', 'KP90'],
  npg: ['npg', 'NPG', 'non_penalty_goals'],
  npxg: ['npxG', 'npxg', 'NPxG'],
};

const primo = (r, chiavi) => {
  for (const k of chiavi) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
  return null;
};

/** Understat manda i numeri come stringhe ("0.7823"). Quello che non e' un
 *  numero diventa null, non zero: "non lo so" e "zero occasioni" sono cose
 *  diverse, e uno zero inventato finisce dritto in una card come se fosse un dato.
 *  La stringa vuota va esclusa a mano: Number('') vale 0 ed e' finito, quindi
 *  senza questo controllo ogni campo assente diventava zero. */
const numero = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const intero = (v) => {
  const n = numero(v);
  return n === null ? null : Math.round(n);
};
const reale = (v) => {
  const n = numero(v);
  return n === null ? null : Math.round(n * 100) / 100;
};

/** Riga grezza -> forma unica. Senza nome non e' abbinabile; senza squadra si
 *  tiene comunque, ma non superera' il guardiano della squadra. */
export function normalizzaRiga(r) {
  const nome = String(primo(r, CAMPI.nome) ?? '').trim();
  if (!nome) return null;
  return {
    nome,
    squadra: String(primo(r, CAMPI.squadra) ?? '').trim(),
    partite: intero(primo(r, CAMPI.partite)),
    minuti: intero(primo(r, CAMPI.minuti)),
    gol: intero(primo(r, CAMPI.gol)),
    xg: reale(primo(r, CAMPI.xg)),
    assist: intero(primo(r, CAMPI.assist)),
    xa: reale(primo(r, CAMPI.xa)),
    tiri: intero(primo(r, CAMPI.tiri)),
    passaggi_chiave: intero(primo(r, CAMPI.passaggi_chiave)),
    npg: intero(primo(r, CAMPI.npg)),
    npxg: reale(primo(r, CAMPI.npxg)),
  };
}

/** Quali campi richiesti mancano davvero nel file. Si dice subito, invece di
 *  scoprire a fine giro che meta' delle colonne sono a null. */
export function campiMancanti(righe) {
  const chiavi = Object.keys(CAMPI).filter((k) => k !== 'nome' && k !== 'squadra');
  return chiavi.filter((k) => righe.every((r) => r[k] === null));
}

// -------------------------------------------------------------------- squadre

/** Sigle e complementi che i due elenchi scrivono in modo diverso: Understat
 *  dice "AC Milan" e "Parma Calcio 1913", il listone dice "Milan" e "Parma". */
const RUMORE = /\b(ac|fc|ssc|ss|as|us|cfc|calcio|club|hellas|spa|srl|\d{4})\b/g;
const nucleoSquadra = (s) =>
  normalizza(s)
    .replace(/[.']/g, ' ')
    .replace(RUMORE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Stessa squadra? Si confrontano i nuclei, e uno deve contenere l'altro. Il
 *  team_title di Understat elenca piu' club separati da virgola quando il
 *  giocatore si e' mosso a mercato aperto: basta che uno corrisponda. */
export function stessaSquadra(understat, listone) {
  const b = nucleoSquadra(listone);
  if (!b) return false;
  return String(understat ?? '')
    .split(',')
    .map(nucleoSquadra)
    .filter(Boolean)
    .some((a) => a === b || a.includes(b) || b.includes(a));
}

// ---------------------------------------------------------------- abbinamento

const senzaSegni = (s) => normalizza(s).replace(/['ʻ’]/g, '');

/** Il cognome deve combaciare a CONFINE DI PAROLA, non essere una sottostringa
 *  qualsiasi. Con includes() "Obert" si trovava dentro "R[obert]o Piccoli" e
 *  "Valenti" dentro "Mihai [Valenti]n Mihaila": due compagni di squadra, quindi
 *  il guardiano della squadra passava, e i due veri Obert e Valenti finivano
 *  scartati per ambiguita'.
 *  Si confrontano sequenze di parole intere, cosi' reggono anche i cognomi
 *  composti ("de Roon", "Bella-Kotchap", "El Azzouzi").
 *  In wiki.js la funzione larga resta com'e': li' si confronta il TITOLO di una
 *  pagina, e la larghezza serve a far passare "Hakan Calhanoglu". */
export function cognomeCombacia(nomeUnderstat, cognome) {
  const parole = senzaSegni(nomeUnderstat).split(/[\s-]+/).filter(Boolean);
  const cerca = senzaSegni(cognome).split(/[\s-]+/).filter(Boolean);
  if (!cerca.length) return false;
  for (let i = 0; i + cerca.length <= parole.length; i++)
    if (cerca.every((x, k) => parole[i + k] === x)) return true;
  return false;
}

/** Understat scrive certi giocatori con una parola sola ("Vitinha", "Ederson").
 *  Li' non c'e' un nome proprio contro cui confrontare l'abbreviazione del
 *  listone: il guardiano non ha niente da dire e si salta. Squadra e cognome
 *  intero bastano, e se restassero due candidati l'ambiguita' li scarterebbe. */
export const mononimo = (nome) => senzaSegni(nome).split(/[\s-]+/).filter(Boolean).length === 1;
export const inizialeCompatibile = (nomeUnderstat, nomeListone) =>
  mononimo(nomeUnderstat) || inizialiCombaciano(nomeUnderstat, nomeListone);

/** Il cognome come lo scrive il listone: i pezzi puntati sono iniziali del nome
 *  proprio. "Martinez L." -> "Martinez", "Esposito F.P." -> "Esposito". */
export const cognomeDi = (nome) =>
  String(nome ?? '')
    .split(/\s+/)
    .filter((p) => p && !p.endsWith('.'))
    .join(' ')
    .trim();

/** Gli stessi guardiani di wiki.js, applicati alla riga di Understat invece che
 *  al titolo di una pagina: la squadra deve corrispondere, il cognome dev'esserci,
 *  e se il listone abbrevia il nome proprio quello di Understat deve cominciare
 *  allo stesso modo. Senza il terzo, "Martinez L." si prende Josep Martinez:
 *  stessa Inter, stesso cognome, portiere invece che attaccante. */
export function candidati(giocatore, righe) {
  const cognome = cognomeDi(giocatore.nome);
  if (!cognome) return [];
  return righe.filter(
    (r) =>
      stessaSquadra(r.squadra, giocatore.squadra) &&
      cognomeCombacia(r.nome, cognome) &&
      inizialeCompatibile(r.nome, giocatore.nome)
  );
}

/** Un giocatore per volta. Zero candidati: nessun dato, ed e' normale - Understat
 *  copre chi ha giocato, non tutto il listone. Piu' di uno: si SCARTA. Il dato di
 *  un omonimo e' peggio di nessun dato, e da qui finirebbe dritto in una card che
 *  dice "occasione". */
export function abbina(giocatori, righe) {
  const abbinati = [];
  const ambigui = [];
  const senzaCandidati = [];
  for (const g of giocatori) {
    const c = candidati(g, righe);
    if (c.length === 1) abbinati.push({ giocatore: g, riga: c[0] });
    else if (c.length === 0) senzaCandidati.push(g);
    else ambigui.push({ giocatore: g, candidati: c });
  }
  return { abbinati, ambigui, senzaCandidati };
}

// ------------------------------------------------------------------ scrittura

/** Fotografia della stagione, non storico incrementale: rilanciare il comando
 *  sullo stesso file riscrive le stesse righe e non ne aggiunge una. */
export function salvaXg(stagione, abbinati) {
  const adesso = new Date().toISOString();
  return tx((d) => {
    const ins = d.prepare(
      `INSERT INTO xg (player_id, stagione, squadra, partite, minuti, gol, xg, assist, xa, tiri,
                       passaggi_chiave, npg, npxg, nome_fonte, aggiornato_il)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id, stagione) DO UPDATE SET
         squadra = excluded.squadra, partite = excluded.partite, minuti = excluded.minuti,
         gol = excluded.gol, xg = excluded.xg, assist = excluded.assist, xa = excluded.xa,
         tiri = excluded.tiri, passaggi_chiave = excluded.passaggi_chiave,
         npg = excluded.npg, npxg = excluded.npxg,
         nome_fonte = excluded.nome_fonte, aggiornato_il = excluded.aggiornato_il`
    );
    let n = 0;
    for (const { giocatore, riga } of abbinati) {
      ins.run(
        giocatore.id,
        stagione,
        riga.squadra || null,
        riga.partite,
        riga.minuti,
        riga.gol,
        riga.xg,
        riga.assist,
        riga.xa,
        riga.tiri,
        riga.passaggi_chiave,
        riga.npg,
        riga.npxg,
        riga.nome,
        adesso
      );
      n++;
    }
    return n;
  });
}

// -------------------------------------------------------------------- lettura

/** scarto_xg = gol - xg, calcolato qui e mai salvato: deriva da due colonne
 *  della stessa riga, e una colonna derivata salvata prima o poi resta indietro
 *  rispetto a quelle da cui viene.
 *  Negativo = ha segnato meno di quanto valessero le sue occasioni, e il listone
 *  potrebbe sottovalutarlo. Positivo = ha segnato piu' del previsto, e la
 *  statistica dice che tornera' giu'. */
const SELECT_XG = `SELECT player_id, stagione, squadra, partite, minuti, gol, xg, assist, xa,
                          tiri, passaggi_chiave, npg, npxg, nome_fonte,
                          CASE WHEN gol IS NULL OR xg IS NULL THEN NULL
                               ELSE round(gol - xg, 2) END AS scarto_xg
                     FROM xg`;

/** L'ultima stagione disponibile per ogni giocatore, pronta per l'interfaccia.
 *  Come la carriera viaggia dentro lo stato: durante l'asta non si fanno
 *  chiamate di rete, quindi quando si apre un lotto il dato dev'essere gia' li'. */
export function xgPerGiocatore() {
  const per = new Map();
  for (const r of tutteLeRighe()) per.set(r.player_id, r); // l'ordine lascia in mano l'ultima
  return per;
}

const tutteLeRighe = () =>
  getDb().prepare(`${SELECT_XG} ORDER BY player_id, CAST(substr(stagione, 1, 4) AS INTEGER)`).all();

/** Tutte le stagioni di ogni giocatore, dalla piu' vecchia alla piu' recente:
 *  la pagina dettaglio le mostra in fila, non solo l'ultima. */
export function xgStagioniPerGiocatore() {
  const per = new Map();
  for (const r of tutteLeRighe()) {
    if (!per.has(r.player_id)) per.set(r.player_id, []);
    per.get(r.player_id).push(r);
  }
  return per;
}

/** Chi ha segnato molto meno, e chi molto piu', di quanto valessero le sue
 *  occasioni. Il minimo di minuti serve perche' su 90' giocati uno scarto di
 *  +1.5 e' rumore, non un segnale. */
export function estremiScarto(stagione, quanti = 5, minutiMinimi = 450) {
  const d = getDb();
  const q = (verso) =>
    d
      .prepare(
        `SELECT p.nome, p.squadra AS squadra_listone, p.ruolo, p.quotazione,
                x.squadra, x.partite, x.minuti, x.gol, x.xg, x.npg, x.npxg, x.nome_fonte,
                round(x.gol - x.xg, 2) AS scarto_xg
           FROM xg x JOIN players p ON p.id = x.player_id
          WHERE x.stagione = ? AND x.gol IS NOT NULL AND x.xg IS NOT NULL
            AND coalesce(x.minuti, 0) >= ?
          ORDER BY (x.gol - x.xg) ${verso} LIMIT ?`
      )
      .all(stagione, minutiMinimi, quanti);
  return { sotto: q('ASC'), sopra: q('DESC') };
}

export const stagioniInArchivio = () =>
  getDb().prepare('SELECT stagione, count(*) AS n FROM xg GROUP BY stagione ORDER BY stagione').all();
