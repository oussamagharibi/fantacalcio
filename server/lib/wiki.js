import { getDb, tx } from '../db.js';
import { scarica, ErroreHttp } from './web.js';
import { normalizza } from './testo.js';

/** Storico di carriera da Wikipedia in italiano. Si usa l'API, non lo scraping:
 *  action=query restituisce il wikitext, che e' gia' strutturato, mentre l'HTML
 *  reso cambia col tema e va indovinato.
 *
 *  ATTENZIONE a cosa sono questi dati: presenze e gol veri, di calcio. NON sono
 *  dati di fantacalcio - niente media voto, niente fantamedia. Quelli stanno
 *  solo negli Excel di fantacalcio.it e finiscono nella tabella stats. */

export const API = 'https://it.wikipedia.org/w/api.php';
export const FONTE = 'it.wikipedia.org';
/** Titolo della sezione con la tabella dei club. Su it.wiki e' lo standard dei
 *  template calciatore; se cambiasse, il parser lo direbbe invece di indovinare. */
const SEZIONE = /===+\s*Presenze e reti nei club\s*===+/i;

// ------------------------------------------------------- lettura del wikitext

/** [[Pagina|Etichetta]] -> Etichetta; [[Pagina]] -> Pagina. */
const etichetta = (s) => {
  const m = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(s);
  return m ? (m[2] ?? m[1]).trim() : null;
};
/** Nome di competizione dal bersaglio di un link, senza l'annata:
 *  "Serie A 2017-2018" -> "Serie A", "Primera División 2015 (Argentina)" ->
 *  "Primera División (Argentina)". */
const senzaAnnata = (t) =>
  t
    .replace(/\s*\b\d{4}(?:-\d{2,4})?\b\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Tutti i bersagli dei link in una cella: una cella puo' unire due
 *  competizioni ("[[Supercoppa italiana|SI]]+[[Coppa del mondo|Cmc]]"). */
const bersagli = (s) => [...String(s ?? '').matchAll(/\[\[([^\]|]+)/g)].map((m) => senzaAnnata(m[1])).filter(Boolean);

/** Via le note a pie' di pagina prima di leggere i numeri: contengono cifre e
 *  trattini che altrimenti finiscono nel conteggio. */
const senzaRef = (s) =>
  String(s ?? '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/\[\[[^\]]*\]\]/g, '');

/** I numeri di una cella. "38+2" sono due valori distinti (stagione regolare e
 *  play-off, o due competizioni unite): si tengono separati, chi chiama decide
 *  se sommarli o distribuirli.
 *  I portieri hanno le reti NEGATIVE: sono i gol subiti, non segnati. */
const numeri = (s) => (senzaRef(s).match(/-?\d+/g) ?? []).map(Number);
const numero = (s) => {
  const n = numeri(s);
  return n.length ? n.reduce((a, b) => a + b, 0) : null;
};

/** La squadra sta in un template {{Calcio Ascoli|N}}; {{Bandiera|ITA}} e' solo
 *  la bandierina e va ignorata. */
function nomeSquadra(cella) {
  const m = /\{\{\s*Calcio\s+([^|}]+)/i.exec(cella);
  if (m) return m[1].trim();
  return etichetta(cella) ?? (cella.replace(/\{\{[^}]*\}\}/g, '').trim() || null);
}

/** Toglie gli attributi di cella ("rowspan=3|", 'colspan="2"|', 'style="..."|')
 *  senza rompere i link, che contengono un | ma non sono attributi. */
function contenutoCella(c) {
  const m = /^\s*((?:[a-zA-Z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s|]+)\s*)+)\|(?!\|)/.exec(c);
  return (m ? c.slice(m[0].length) : c).trim();
}

/** Spezza una riga di wikitable nelle sue celle. Le celle sono separate da ||
 *  sulla stessa riga, oppure da un | a inizio riga nelle tabelle multilinea. */
function celle(riga) {
  return riga
    .split('\n')
    .flatMap((l) => {
      const t = l.trim();
      if (!t.startsWith('|')) return [];
      return t.slice(1).split('||');
    })
    .map(contenutoCella);
}

/** Via le barre verticali davanti alla stagione. Nascono da una riga di
 *  wikitable che comincia con "||": celle() toglie una sola barra, e la seconda
 *  resta attaccata al testo. La squadra e la competizione non ne soffrono
 *  perche' passano da nomeSquadra() e dai link, che scartano tutto quello che
 *  non e' dentro il template; la stagione invece e' testo grezzo ed e' l'unico
 *  campo che se le porta dietro fino al db.
 *  Toglierle qui vuol dire che non entrano piu' in archivio, con qualunque
 *  forma abbia la tabella. */
export const pulisciStagione = (s) =>
  String(s ?? '')
    .replace(/^[\s|]+/, '')
    // Trattino finale senza anno di chiusura: "ago.2026-" e' una militanza
    // ancora in corso, e Wikipedia la scrive cosi'. Va tolto, perche'
    // l'ordinamento legge gli ultimi quattro caratteri: con il trattino
    // trova "026-", cioe' l'anno 26, e la manda in cima alla carriera invece
    // che in fondo. Senza, l'etichetta finisce con l'anno d'inizio - che per
    // una stagione aperta e' esattamente l'anno con cui va ordinata, il piu'
    // recente.
    // Non ci si aggiunge un "in corso": l'ordinamento si regge sul fatto che
    // l'etichetta finisca con l'anno, e un suffisso lo romperebbe di nuovo.
    .replace(/[\s-]+$/, '')
    .trim();

/** Legge la tabella "Presenze e reti nei club".
 *  Colonne: Stagione, Squadra, poi terne (Competizione, Presenze, Reti) per
 *  campionato/coppe, e infine due colonne di totale che si scartano.
 *  La squadra ha spesso rowspan: dove manca, si eredita dalla riga sopra. */
export function estraiCarriera(wikitext) {
  const inizio = SEZIONE.exec(wikitext);
  if (!inizio) return { righe: [], motivo: 'sezione "Presenze e reti nei club" non trovata' };
  const dopo = wikitext.slice(inizio.index);
  const apre = dopo.indexOf('{|');
  if (apre < 0) return { righe: [], motivo: 'nessuna tabella dopo la sezione' };
  const chiude = dopo.indexOf('\n|}', apre);
  const tabella = dopo.slice(apre, chiude < 0 ? undefined : chiude);

  const righe = [];
  let squadraCorrente = null;
  for (const blocco of tabella.split(/\n\|-/).slice(1)) {
    const c = celle(blocco);
    if (!c.length) continue;
    // Le righe di totale iniziano con ! (intestazione): non sono stagioni.
    if (blocco.trim().startsWith('!') || /^\s*!/.test(blocco.split('\n').find((l) => l.trim()) ?? '')) continue;

    let stagione;
    let squadra;
    let resto;
    if ((c.length - 4) % 3 === 0) {
      [stagione, squadra, ...resto] = c;
      squadraCorrente = nomeSquadra(squadra) ?? squadraCorrente;
    } else if ((c.length - 3) % 3 === 0) {
      // Squadra assente: la cella e' unita con rowspan alla riga precedente.
      [stagione, ...resto] = c;
    } else continue;

    const nomeStagione = pulisciStagione(etichetta(stagione) ?? stagione.replace(/\{\{[^}]*\}\}/g, ''));
    if (!nomeStagione || !squadraCorrente) continue;
    // Le ultime due colonne sono il totale di riga: gia' contenuto nelle terne.
    const terne = resto.slice(0, resto.length - 2);
    for (let i = 0; i + 2 < terne.length; i += 3) {
      const comp = terne[i];
      const nomi = bersagli(comp);
      const pres = numeri(terne[i + 1]);
      const reti = numeri(terne[i + 2]);
      if (!pres.length && !reti.length) continue;

      const competizioni = nomi.length ? nomi : [etichetta(comp) ?? comp.trim()].filter((x) => x && x !== '-');
      if (!competizioni.length) continue;

      // Cella unita e conti allineati ("SI+Cmc", "2+4", "1+2"): sono due
      // competizioni distinte e si separano. Se i conti non tornano si somma,
      // che e' l'unica lettura sicura di una cella che unisce piu' voci.
      if (competizioni.length > 1 && pres.length === competizioni.length && reti.length === competizioni.length) {
        competizioni.forEach((c, k) =>
          righe.push({ stagione: nomeStagione, squadra: squadraCorrente, competizione: c, presenze: pres[k], gol: reti[k] })
        );
        continue;
      }
      const somma = (v) => (v.length ? v.reduce((a, b) => a + b, 0) : null);
      righe.push({
        stagione: nomeStagione,
        squadra: squadraCorrente,
        competizione: competizioni.join(' + '),
        presenze: somma(pres),
        gol: somma(reti),
      });
    }
  }
  return { righe, motivo: righe.length ? null : 'tabella trovata ma nessuna riga leggibile' };
}

/** La pagina deve nominare la squadra attuale del giocatore. E' l'unica difesa
 *  contro l'omonimo: meglio nessun dato che la carriera di un altro. */
export function citaSquadra(wikitext, squadra) {
  return normalizza(wikitext).includes(normalizza(squadra));
}

// ------------------------------------------------------------ ricerca e match

/** Una richiesta sola per giocatore: generator=search porta i risultati E il
 *  loro wikitext. Due chiamate separate facevano scattare il limite dell'API
 *  anche rispettando i due secondi. */
export async function cercaPagine(cognome, squadra) {
  const url =
    `${API}?` +
    new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: `${cognome} ${squadra} calciatore`,
      gsrlimit: '3',
      prop: 'revisions',
      rvslots: 'main',
      rvprop: 'content',
      format: 'json',
      formatversion: '2',
    });
  const { testo } = await scarica(url, 'application/json');
  let j;
  try {
    j = JSON.parse(testo);
  } catch {
    // L'API risponde 200 con testo semplice quando ci limita: non e' un JSON rotto.
    throw new ErroreLimite(testo.slice(0, 120));
  }
  if (j.error) throw new Error(`API: ${j.error.code} ${j.error.info ?? ''}`);
  return (j.query?.pages ?? [])
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
    .map((p) => ({ titolo: p.title, wikitext: p.revisions?.[0]?.slots?.main?.content ?? '' }));
}

export class ErroreLimite extends Error {
  constructor(m) {
    super(`limite dell'API raggiunto: ${m}`);
    this.name = 'ErroreLimite';
  }
}

/** Sopra la base condivisa: qui si toglie anche l'apostrofo, perche' si
 *  confrontano titoli e cognomi, non prosa italiana dove "l'Inter" deve
 *  restare separato. */
const senzaAccenti = (s) => normalizza(s).replace(/['ʻ’]/g, '');

/** Pezzi abbreviati del nome proprio, come li scrive il listone. Il punto
 *  separa i nomi, non le lettere: "F.P." sono due nomi (Francesco Pio), "Jo."
 *  e' un nome solo troncato (Josep). Trattarli allo stesso modo scarterebbe
 *  meta' dei giocatori giusti.
 *  "Martinez L." -> ["l"] | "Esposito F.P." -> ["f","p"] | "Martinez Jo." -> ["jo"] */
export const prefissiNome = (nome) =>
  String(nome ?? '')
    .split(/\s+/)
    .filter((p) => p.endsWith('.'))
    .flatMap((p) => p.split('.').filter(Boolean))
    .map(senzaAccenti);

/** La squadra da sola non basta: due Martinez giocano nell'Inter, uno portiere
 *  e uno attaccante. Se il listone abbrevia il nome proprio, quello della
 *  pagina deve cominciare allo stesso modo. */
export function inizialiCombaciano(titolo, nome) {
  const pref = prefissiNome(nome);
  if (!pref.length) return true;
  const parole = senzaAccenti(titolo).split(/\s+/).filter(Boolean);
  // Serve almeno una parola oltre al cognome: e' il nome proprio da verificare.
  if (parole.length < 2) return false;
  // Basta che il primo nome della pagina corrisponda a UNO dei pezzi. Pretendere
  // che combacino tutti in ordine scartava Francesco Pio Esposito, che su
  // Wikipedia si intitola "Pio Esposito": il secondo nome, non il primo.
  // Resta invece fuori Josep Martinez quando il listone dice "Martinez L.".
  return pref.some((x) => parole[0].startsWith(x));
}

/** Quando il listone NON abbrevia il nome proprio, il guardiano sulle iniziali
 *  non ha niente da confrontare e lascia passare tutto. Va bene finche' quel
 *  cognome e' unico; se nel listone c'e' un altro giocatore che lo porta, la
 *  pagina puo' benissimo essere la sua.
 *
 *  E' successo con i Thuram: il listone scrive "Thuram" (Inter) e "Thuram K."
 *  (Juventus), la pagina di Khephren cita l'Inter perche' ci gioca il fratello,
 *  e la carriera di Khephren e' finita addosso a Marcus.
 *
 *  Stesso principio del caso Terracciano - ambiguita' non risolvibile, meglio
 *  nessun dato - ma li' i due erano nella stessa squadra e a fermare tutto
 *  bastava il guardiano della squadra. Qui le squadre sono diverse, quindi
 *  quello non interviene e serve questo.
 *
 *  Si scarta in due casi. La pagina non porta un nome proprio (titolo di una
 *  parola sola): non c'e' modo di decidere. Oppure il nome proprio comincia
 *  come l'abbreviazione di un omonimo: allora la pagina e' SUA, non nostra.
 *  Se invece non somiglia a nessun omonimo, per esclusione resta nostra. */
export function distinguibile(titolo, nome, omonimi = []) {
  if (prefissiNome(nome).length) return true; // l'iniziale ce l'ha: decide inizialiCombaciano
  if (!omonimi.length) return true; // cognome unico nel listone: niente da distinguere
  const parole = senzaAccenti(titolo).split(/\s+/).filter(Boolean);
  if (parole.length < 2) return false; // la pagina non ha un nome proprio
  const proprio = parole[0];
  return !omonimi.some((o) => prefissiNome(o).some((x) => proprio.startsWith(x)));
}

/** Ruolo dall'infobox. Si controlla solo la distinzione portiere / non portiere:
 *  e' netta e certa, mentre fra difensore, centrocampista e attaccante
 *  Wikipedia e Fantacalcio classificano diversamente le ali e i trequartisti,
 *  e un confronto stretto scarterebbe pagine giuste. */
export function ruoloCompatibile(wikitext, ruolo) {
  const m = /\|\s*Ruolo\s*=\s*([^\n|]*)/i.exec(wikitext);
  if (!m) return true;
  const portiereInPagina = /portiere/i.test(m[1]);
  return ruolo === 'P' ? portiereInPagina : !portiereInPagina;
}

/** Il titolo deve contenere il cognome. Sembra ovvio, ma la ricerca di
 *  Wikipedia restituisce volentieri un compagno di squadra quando il cognome
 *  ha lettere che l'italiano non usa: "Calhanoglu Inter calciatore" tirava su
 *  "Andy Diouf", stesso club e stesso reparto, che superava ogni altra prova.
 *  Normalizzando, "Hakan Çalhanoğlu" contiene "calhanoglu" e passa. */
export function titoloContieneCognome(titolo, cognome) {
  return senzaAccenti(titolo).includes(senzaAccenti(cognome));
}

/** Sceglie la pagina buona. Cinque prove, tutte da superare: il titolo porta il
 *  cognome, il cognome non e' ambiguo nel listone (o la pagina lo risolve), la
 *  pagina cita la squadra attuale, il nome proprio combacia con l'abbreviazione,
 *  il ruolo e' compatibile. Se nessuna pagina le supera si scarta: la carriera
 *  di un omonimo e' peggio di nessuna carriera. */
export function scegliPagina(pagine, squadra, nome, ruolo, cognome, omonimi = []) {
  const scartate = [];
  for (const p of pagine) {
    if (cognome && !titoloContieneCognome(p.titolo, cognome)) {
      scartate.push({ titolo: p.titolo, motivo: `il titolo non contiene "${cognome}"` });
      continue;
    }
    if (!distinguibile(p.titolo, nome, omonimi)) {
      scartate.push({
        titolo: p.titolo,
        motivo: `nel listone "${cognome}" e' anche di ${omonimi.join(', ')}, e qui non c'e' un nome proprio che distingua`,
      });
      continue;
    }
    if (!citaSquadra(p.wikitext, squadra)) {
      scartate.push({ titolo: p.titolo, motivo: `non cita "${squadra}"` });
      continue;
    }
    if (!inizialiCombaciano(p.titolo, nome)) {
      scartate.push({ titolo: p.titolo, motivo: `il nome non comincia per "${prefissiNome(nome).join('.').toUpperCase()}."` });
      continue;
    }
    if (!ruoloCompatibile(p.wikitext, ruolo)) {
      scartate.push({ titolo: p.titolo, motivo: `ruolo incompatibile (nel listone e' ${ruolo})` });
      continue;
    }
    const { righe, motivo } = estraiCarriera(p.wikitext);
    if (!righe.length) {
      scartate.push({ titolo: p.titolo, motivo });
      continue;
    }
    return { pagina: p, righe, scartate };
  }
  return { pagina: null, righe: [], scartate };
}

// ------------------------------------------------------------------ scrittura

/** Fotografia, non storico incrementale: le righe di un giocatore si
 *  riscrivono per intero, cosi' una correzione su Wikipedia arriva pulita. */
export function salvaCarriera(playerId, righe, fonte) {
  return tx((d) => {
    d.prepare('DELETE FROM carriera WHERE player_id = ?').run(playerId);
    const ins = d.prepare(
      `INSERT INTO carriera (player_id, stagione, squadra, competizione, presenze, gol, fonte)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id, stagione, squadra, competizione) DO UPDATE SET
         presenze = excluded.presenze, gol = excluded.gol, fonte = excluded.fonte`
    );
    let n = 0;
    for (const r of righe) {
      ins.run(playerId, r.stagione, r.squadra, r.competizione, r.presenze, r.gol, fonte);
      n++;
    }
    return n;
  });
}

/** Ultime N stagioni aggregate, per l'interfaccia: le competizioni si sommano,
 *  quello che serve a colpo d'occhio e' "quanto ha giocato e quanto ha segnato".
 *  Per i portieri i gol restano negativi: sono quelli subiti. */
export function carrierePerGiocatore(stagioni = 5) {
  // Le stagioni si ordinano per ANNO, non per testo: Wikipedia scrive anche
  // "gen.-giu. 2018" e "set. 2025-2026", che in ordine alfabetico finiscono
  // dopo "2026-2027" e falsavano quali fossero le ultime cinque.
  const righe = getDb()
    .prepare(
      `SELECT player_id, stagione, squadra,
              sum(coalesce(presenze, 0)) AS presenze,
              sum(coalesce(gol, 0)) AS gol,
              max(fonte) AS fonte
         FROM carriera
        GROUP BY player_id, stagione
        ORDER BY player_id, CAST(substr(stagione, -4) AS INTEGER), stagione`
    )
    .all();
  const per = new Map();
  for (const r of righe) {
    if (!per.has(r.player_id)) per.set(r.player_id, []);
    per.get(r.player_id).push(r);
  }
  for (const [k, v] of per) per.set(k, v.slice(-stagioni));
  return per;
}
