import { getDb, tx } from '../db.js';
import { scaricaSePermesso, ErroreHttp } from './web.js';

/** Parser dedicati alle pagine-elenco di Fantacalcio.it. Sono liste, non
 *  articoli: ogni giocatore sta nel suo blocco, accanto alla sua squadra e al
 *  suo stato. Passarle dal tritatutto testuale di notizie.js buttava via
 *  proprio la struttura che serve, e per rigoristi produceva zero.
 *  Qui nome e squadra arrivano dal markup, non da una coincidenza nel testo. */

const pulisci = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();

/** Ogni link a un giocatore porta l'id ufficiale in fondo all'URL:
 *  .../serie-a/squadre/atalanta/scamacca/2137 -> 2137, lo stesso di players.id.
 *  E' un aggancio esatto: niente normalizzazione dei nomi, niente omonimi. */
const LINK_GIOCATORE = /<a[^>]*class="player-name player-link"[^>]*href="[^"]*\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;

const linkGiocatori = (html) =>
  [...html.matchAll(LINK_GIOCATORE)].map((m) => ({ id: Number(m[1]), nome: pulisci(m[2]) }));

// ------------------------------------------------------------- i tre parser

/** Infortunati: sezioni per squadra, ognuna con voci nome + descrizione.
 *  E' l'unica delle tre senza link ai giocatori, quindi qui si abbina per
 *  nome + squadra, presi comunque dalla struttura. */
export function leggiInfortunati(html) {
  const voci = [];
  const sezioni = [...html.matchAll(/<span class="team-name">([\s\S]*?)<\/span>/gi)];
  for (const [i, s] of sezioni.entries()) {
    const squadra = pulisci(s[1]);
    const fine = sezioni[i + 1]?.index ?? html.length;
    const blocco = html.slice(s.index, fine);
    const nomi = [...blocco.matchAll(/<strong class="item-name">([\s\S]*?)<\/strong>/gi)];
    for (const [k, n] of nomi.entries()) {
      const finVoce = nomi[k + 1]?.index ?? blocco.length;
      const descrizione = /<div class="item-description">([\s\S]*?)<\/div>/i.exec(blocco.slice(n.index, finVoce));
      voci.push({ id: null, nome: pulisci(n[1]), squadra, testo: pulisci(descrizione?.[1] ?? '') });
    }
  }
  return voci;
}

/** Rigoristi: una card per squadra, con due colonne - "Rigori" e "Calci
 *  piazzati". Interessa solo la prima: si prende il primo <ol> dopo quella
 *  intestazione e ci si ferma li'. Delimitare sulla seconda intestazione non
 *  funziona, perche' "Calci piazzati" non ha classe e non si fa trovare.
 *  L'ordine nella lista e' la gerarchia: primo rigorista, secondo, terzo. */
export function leggiRigoristi(html) {
  const voci = [];
  const cards = [...html.matchAll(/<div id="team-\d+"[^>]*class="[^"]*team-card[^"]*"/gi)];
  for (const [i, c] of cards.entries()) {
    const blocco = html.slice(c.index, cards[i + 1]?.index ?? html.length);
    const squadra = pulisci(/<span class="team-name">([\s\S]*?)<\/span>/i.exec(blocco)?.[1] ?? '');
    const rigori = /<header[^>]*>\s*Rigori\s*<\/header>/i.exec(blocco);
    if (!rigori) continue;
    const lista = /<ol[^>]*>([\s\S]*?)<\/ol>/i.exec(blocco.slice(rigori.index + rigori[0].length));
    if (!lista) continue;
    for (const [k, g] of linkGiocatori(lista[1]).entries()) {
      // La squadra non entra nel testo: e' gia' data da player_id, e "del
      // Atalanta" andrebbe scritto "dell'Atalanta" - non vale una tabella di
      // articoli determinativi per un'informazione ridondante.
      voci.push({ ...g, squadra, testo: `rigorista #${k + 1}` });
    }
  }
  return voci;
}

/** Probabili formazioni: due liste per squadra, titolari e riserve, con la
 *  percentuale di impiego in aria-valuenow accanto a ogni nome. */
export function leggiProbabili(html) {
  const voci = [];
  const liste = [...html.matchAll(/<ul class="player-list (starters|reserves)">/gi)];
  for (const [i, l] of liste.entries()) {
    const titolare = l[1].toLowerCase() === 'starters';
    const blocco = html.slice(l.index, liste[i + 1]?.index ?? html.length);
    const voci_li = blocco.split(/<li class="player-item/i).slice(1);
    for (const li of voci_li) {
      const [g] = linkGiocatori(li);
      if (!g) continue;
      const perc = /aria-valuenow="(\d+)"/i.exec(li)?.[1] ?? null;
      voci.push({
        ...g,
        squadra: null,
        percentuale: perc ? Number(perc) : null,
        testo: `${titolare ? 'titolare' : 'in panchina'}${perc ? ` (${perc}% di impiego stimato)` : ''}`,
      });
    }
  }
  return voci;
}

export const PAGINE = [
  {
    fonte: 'Fantacalcio infortunati',
    tipo: 'infortunio',
    url: 'https://www.fantacalcio.it/infortunati-serie-a',
    leggi: leggiInfortunati,
  },
  {
    fonte: 'Fantacalcio rigoristi',
    tipo: 'rigorista',
    url: 'https://www.fantacalcio.it/rigoristi-serie-a',
    leggi: leggiRigoristi,
  },
  {
    fonte: 'Fantacalcio probabili',
    tipo: 'titolarita',
    url: 'https://www.fantacalcio.it/probabili-formazioni-serie-a',
    leggi: leggiProbabili,
  },
];

/** Le fonti che hanno un parser dedicato: news.js le tiene fuori dal percorso
 *  generico, cosi' non finiscono anche in articles e in associa(). */
export const FONTI_CON_PARSER = new Set(PAGINE.map((p) => p.fonte));

// ------------------------------------------------------------- abbinamento

const normalizza = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Dove c'e' l'id si aggancia con quello. Dove non c'e' (solo infortunati) si
 *  prova il nome esatto dentro la squadra giusta, poi il solo cognome sempre
 *  dentro quella squadra: due omonimi nella stessa rosa restano non abbinati
 *  invece di essere assegnati a caso. */
export function abbina(voci) {
  const db = getDb();
  const perId = new Map(db.prepare('SELECT id, nome, squadra FROM players').all().map((r) => [r.id, r]));
  const perNome = new Map();
  const perCognome = new Map();
  for (const p of perId.values()) {
    const chiave = `${normalizza(p.squadra)}|${normalizza(p.nome)}`;
    perNome.set(chiave, [...(perNome.get(chiave) ?? []), p]);
    const cognome = normalizza(p.nome)
      .split(' ')
      .filter((x) => !x.endsWith('.'))
      .join(' ');
    const ck = `${normalizza(p.squadra)}|${cognome}`;
    perCognome.set(ck, [...(perCognome.get(ck) ?? []), p]);
  }

  const abbinate = [];
  const nonAbbinati = [];
  for (const v of voci) {
    if (v.id !== null && perId.has(v.id)) {
      abbinate.push({ ...v, player_id: v.id });
      continue;
    }
    if (v.id !== null) {
      nonAbbinati.push({ ...v, motivo: `id ${v.id} non presente in players` });
      continue;
    }
    const chiave = `${normalizza(v.squadra)}|${normalizza(v.nome)}`;
    const cognome = normalizza(v.nome)
      .split(' ')
      .filter((x) => !x.endsWith('.'))
      .join(' ');
    const candidati = perNome.get(chiave) ?? perCognome.get(`${normalizza(v.squadra)}|${cognome}`) ?? [];
    if (candidati.length === 1) abbinate.push({ ...v, player_id: candidati[0].id });
    else
      nonAbbinati.push({
        ...v,
        motivo: candidati.length ? `${candidati.length} omonimi nella stessa squadra` : 'nome non trovato nella squadra',
      });
  }
  return { abbinate, nonAbbinati };
}

// ------------------------------------------------------------------ scrittura

/** I segnali sono una fotografia, non uno storico: chi non e' piu' infortunato
 *  non deve restare segnato. Per ogni tipo letto con successo si cancella e si
 *  riscrive; se una pagina non risponde, i suoi segnali restano quelli di prima. */
export function salvaSegnali(tipo, righe, fonte, data) {
  return tx((d) => {
    const rimossi = d.prepare('DELETE FROM segnali WHERE tipo = ?').run(tipo).changes;
    const ins = d.prepare(
      `INSERT INTO segnali (player_id, tipo, testo, fonte, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(player_id, tipo) DO UPDATE SET testo = excluded.testo, fonte = excluded.fonte, data = excluded.data`
    );
    let scritti = 0;
    for (const r of righe) {
      ins.run(r.player_id, tipo, r.testo, fonte, data);
      scritti++;
    }
    return { rimossi, scritti };
  });
}

/** Scarica e analizza le tre pagine. Una che fallisce non ferma le altre. */
export async function raccogliSegnali(fontiAttive, log = () => {}) {
  const esiti = [];
  const attive = new Set(fontiAttive.filter((f) => f.attiva).map((f) => f.nome));
  for (const p of PAGINE) {
    if (!attive.has(p.fonte)) continue;
    const esito = { fonte: p.fonte, tipo: p.tipo, lette: 0, abbinate: 0, nonAbbinati: [], errore: null };
    esiti.push(esito);
    try {
      const risposta = await scaricaSePermesso(p.url);
      if (!risposta) throw new Error('robots.txt vieta la pagina');
      const voci = p.leggi(risposta.testo);
      esito.lette = voci.length;
      const { abbinate, nonAbbinati } = abbina(voci);
      esito.nonAbbinati = nonAbbinati;
      // Due voci per lo stesso giocatore (es. rigorista e battitore) collassano
      // sulla chiave (player_id, tipo): tiene la prima, che e' la piu' alta in lista.
      const viste = new Set();
      const uniche = abbinate.filter((r) => !viste.has(r.player_id) && viste.add(r.player_id));
      const { scritti, rimossi } = salvaSegnali(p.tipo, uniche, p.fonte, new Date().toISOString());
      esito.abbinate = scritti;
      esito.rimossi = rimossi;
    } catch (e) {
      esito.errore = e instanceof ErroreHttp ? `HTTP ${e.stato}` : e.message;
      log(`${p.fonte}: ${esito.errore} - salto la pagina, le altre proseguono`);
    }
  }
  return esiti;
}

export const contaSegnali = () =>
  getDb().prepare('SELECT tipo, count(*) AS n FROM segnali GROUP BY tipo ORDER BY tipo').all();
