import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db.js';
import { MODELLO, PREZZO, stimaToken } from './analisi.js';

/** "Analizza la giornata": tutto quello che l'archivio sa dei miei 25, messo
 *  davanti a Claude perche' dica chi schierare.
 *
 *  Non raccoglie niente dalla rete per conto suo - i segnali, i ballottaggi,
 *  le gerarchie e il calendario ci sono gia' perche' li ha scritti
 *  l'aggiornamento. Qui si legge, si impagina e si chiede.
 *
 *  Parte solo quando lo si preme: e' una chiamata che si paga, e una pagina
 *  che spende da sola ogni volta che la si apre e' una pagina che non si apre
 *  piu' volentieri. */

/** Quattro sezioni piu' una voce per giocatore: tremila token sono larghi. */
const MAX_TOKENS = 3000;

export const MODULI = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1'];

/** Le regole della lega, scritte una volta sola. Vanno nel prompt come le ha
 *  dettate chi ci gioca: non sono deducibili dai dati. */
export const REGOLE = {
  squadre: 10,
  modificatoreMax: 6,
  difensoriMinimiPerModificatore: 4,
  bonus: { gol: 3, assist: 1, rigoreParato: 3, cleanSheet: 1, golSubito: -1, rigoreSbagliato: -3, ammonizione: -0.5 },
};

// ------------------------------------------------------------------ raccolta

const SEP_CAMPO = String.fromCharCode(31);
const SEP_VOCE = String.fromCharCode(30);

const INDISPONIBILITA = ['squalifica', 'infortunio', 'dubbio', 'diffida'];

/** La percentuale dentro un testo di titolarita'. null quando non c'e': una
 *  titolarita' senza numero e' un'informazione diversa da una al 50%. */
export const percentuale = (testo) => {
  const m = /(\d+)\s*%/.exec(String(testo ?? ''));
  return m ? Number(m[1]) : null;
};

/** I miei 25 con tutto quello che l'archivio sa di loro.
 *
 *  Ogni campo puo' essere null, e null vuol dire "non lo sappiamo": non si
 *  riempie con una media, non si deduce. Il prompt chiede espressamente di
 *  dirlo quando un dato manca, e questo funziona solo se il dato che manca
 *  arriva li' come mancante. */
export function datiGiocatori(partite = []) {
  const db = getDb();
  const righe = db
    .prepare(
      `SELECT p.id, p.nome, p.ruolo, p.squadra, p.quotazione, p.fvm, a.prezzo,
              (SELECT group_concat(s.tipo || char(31) || s.testo || char(31) || coalesce(s.fonte, ''), char(30))
                 FROM segnali s WHERE s.player_id = p.id) AS segnali
         FROM purchases a JOIN players p ON p.id = a.player_id
        ORDER BY CASE p.ruolo WHEN 'P' THEN 0 WHEN 'D' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, a.prezzo DESC`
    )
    .all();

  const stats = new Map();
  for (const r of db.prepare('SELECT player_id, stagione, pv, mv, fm, gol, assist, rig_parati FROM stats ORDER BY stagione').all())
    stats.set(r.player_id, [...(stats.get(r.player_id) ?? []), r]);

  // Ballottaggi: valgono in tutte e due le direzioni, e il mio puo' stare da
  // una parte come dall'altra.
  const ballottaggi = db
    .prepare(
      `SELECT b.player_id_1, b.player_id_2, b.perc_titolare, b.nota, b.fonte,
              p1.nome AS nome1, p2.nome AS nome2
         FROM ballottaggi b JOIN players p1 ON p1.id = b.player_id_1 JOIN players p2 ON p2.id = b.player_id_2`
    )
    .all();

  // Gerarchie: chi e' il vice dichiarato di chi. Anche questo vale nei due
  // versi - sapere che il mio E' il vice di qualcuno conta quanto sapere chi
  // e' il suo.
  const gerarchie = db
    .prepare(
      `SELECT g.player_id_titolare, g.player_id_alternativa, g.posizione, g.certezza, g.fonte,
              t.nome AS titolare, v.nome AS alternativa
         FROM gerarchie g JOIN players t ON t.id = g.player_id_titolare JOIN players v ON v.id = g.player_id_alternativa`
    )
    .all();

  const perSquadra = new Map();
  for (const p of partite) {
    perSquadra.set(p.casa, { avversario: p.ospite, incasa: true, giornata: p.giornata });
    perSquadra.set(p.ospite, { avversario: p.casa, incasa: false, giornata: p.giornata });
  }

  return righe.map((r) => {
    const voci = (r.segnali ?? '')
      .split(SEP_VOCE)
      .filter(Boolean)
      .map((s) => {
        const [tipo, testo, fonte] = s.split(SEP_CAMPO);
        return { tipo, testo, fonte: fonte || null };
      });
    const tit = voci.find((v) => v.tipo === 'titolarita') ?? null;
    const rig = voci.find((v) => v.tipo === 'rigorista') ?? null;
    const st = stats.get(r.id) ?? [];
    const turno = perSquadra.get(r.squadra) ?? null;

    return {
      id: r.id,
      nome: r.nome,
      ruolo: r.ruolo,
      squadra: r.squadra,
      pagato: r.prezzo,
      titolarita: tit ? { percentuale: percentuale(tit.testo), testo: tit.testo, fonte: tit.fonte } : null,
      indisponibilita: voci
        .filter((v) => INDISPONIBILITA.includes(v.tipo))
        .map((v) => ({ tipo: v.tipo, testo: v.testo, fonte: v.fonte })),
      rigorista: rig ? { testo: rig.testo, fonte: rig.fonte } : null,
      ballottaggi: ballottaggi
        .filter((b) => b.player_id_1 === r.id || b.player_id_2 === r.id)
        .map((b) => {
          const primo = b.player_id_1 === r.id;
          return {
            con: primo ? b.nome2 : b.nome1,
            // perc_titolare e' del player_id_1: se il mio e' il secondo, la
            // sua percentuale NON e' 100 meno quella. Non si calcola.
            miaPercentuale: primo ? b.perc_titolare : null,
            percentualeAltro: primo ? null : b.perc_titolare,
            nota: b.nota,
            fonte: b.fonte,
          };
        }),
      gerarchia: {
        suoiVice: gerarchie.filter((g) => g.player_id_titolare === r.id).map((g) => ({ nome: g.alternativa, posizione: g.posizione, certezza: g.certezza, fonte: g.fonte })),
        eViceDi: gerarchie.filter((g) => g.player_id_alternativa === r.id).map((g) => ({ nome: g.titolare, posizione: g.posizione, certezza: g.certezza, fonte: g.fonte })),
      },
      storico: st.map((s) => ({
        stagione: s.stagione,
        presenze: s.pv,
        mv: s.mv,
        fm: s.fm,
        gol: s.gol,
        assist: s.assist,
        rigoriParati: s.rig_parati,
      })),
      prossimo: turno,
    };
  });
}

/** La riga di un avversario: quanto concede e quanto segna. Se la classifica
 *  non c'e', il campo non c'e': non si mette uno zero. */
export const pesoAvversario = (classifica, squadra) =>
  (classifica?.righe ?? []).find((r) => r.squadra === squadra) ?? null;

/** Quello che manca, elencato prima di chiedere. Sta anche nella risposta a
 *  schermo: sapere che i ballottaggi sono vuoti perche' non e' stato lanciato
 *  l'aggiornamento e' diverso dal credere che non ce ne siano. */
export function buchi(dati, classifica) {
  const b = [];
  const senza = (f) => dati.filter(f).length;
  if (!dati.some((g) => g.prossimo))
    b.push('il calendario del prossimo turno: nessun giocatore ha un avversario (lancia l\'aggiornamento)');
  if (!dati.some((g) => g.ballottaggi.length)) b.push('i ballottaggi: nessuno in archivio');
  if (!dati.some((g) => g.gerarchia.suoiVice.length || g.gerarchia.eViceDi.length))
    b.push('le gerarchie titolare/vice: nessuna in archivio (si riempiono con npm run gerarchie)');
  const senzaTit = senza((g) => !g.titolarita);
  if (senzaTit) b.push(`la titolarita' di ${senzaTit} giocatori su ${dati.length}`);
  const senzaSt = senza((g) => !g.storico.length);
  if (senzaSt) b.push(`le statistiche storiche di ${senzaSt} giocatori su ${dati.length}`);
  if (!classifica?.ok) b.push(`la classifica di Serie A: ${classifica?.motivo ?? 'non richiesta'}`);
  return b;
}

// -------------------------------------------------------------------- prompt

const num = (x) => (x === null || x === undefined ? 'n/d' : x);

/** Un giocatore in righe leggibili. Il JSON crudo costerebbe piu' token e si
 *  leggerebbe peggio, e questo testo finisce anche a schermo quando si vuole
 *  vedere su cosa si e' deciso. */
export function scheda(g, classifica) {
  const r = [`${g.nome} (${g.ruolo}, ${g.squadra}, pagato ${g.pagato})`];

  r.push(`  titolarita': ${g.titolarita ? `${g.titolarita.percentuale !== null ? g.titolarita.percentuale + '%' : g.titolarita.testo} [${g.titolarita.fonte}]` : 'n/d'}`);

  r.push(
    `  indisponibilita': ${g.indisponibilita.length ? g.indisponibilita.map((i) => `${i.tipo} - ${i.testo} [${i.fonte}]`).join(' | ') : 'nessuna segnalata'}`
  );

  r.push(
    `  ballottaggi: ${
      g.ballottaggi.length
        ? g.ballottaggi
            .map((b) =>
              b.miaPercentuale !== null
                ? `con ${b.con}, lui dato al ${b.miaPercentuale}%`
                : `con ${b.con}${b.percentualeAltro !== null ? `, l'altro dato al ${b.percentualeAltro}% (la sua non e' dichiarata)` : ''}`
            )
            .join(' | ')
        : 'nessuno dichiarato'
    }`
  );

  const ger = [
    ...g.gerarchia.eViceDi.map((x) => `e' dato vice di ${x.nome}${x.posizione ? ` (${x.posizione})` : ''}, certezza ${x.certezza}`),
    ...g.gerarchia.suoiVice.map((x) => `il suo vice dichiarato e' ${x.nome}${x.posizione ? ` (${x.posizione})` : ''}, certezza ${x.certezza}`),
  ];
  r.push(`  gerarchia: ${ger.length ? ger.join(' | ') : 'nessuna dichiarata'}`);

  r.push(`  rigorista: ${g.rigorista ? g.rigorista.testo : 'non risulta'}`);

  r.push(
    `  storico: ${
      g.storico.length
        ? g.storico
            .map((s) => `${s.stagione} ${num(s.presenze)}pv MV ${num(s.mv)} FM ${num(s.fm)} ${num(s.gol)}g ${num(s.assist)}a${s.rigoriParati ? ` ${s.rigoriParati} rig.parati` : ''}`)
            .join(' | ')
        : 'nessuna stagione in archivio'
    }`
  );

  if (!g.prossimo) {
    r.push('  prossimo avversario: n/d (calendario non disponibile)');
  } else {
    const a = pesoAvversario(classifica, g.prossimo.avversario);
    r.push(
      `  prossimo avversario: ${g.prossimo.avversario} ${g.prossimo.incasa ? '(in casa)' : '(in trasferta)'}` +
        (a
          ? ` - ${a.posizione}a in classifica, ${a.golSubiti} gol subiti in ${a.giocate} (${a.golSubitiPerPartita} a partita), ${a.golFatti} fatti (${a.golFattiPerPartita} a partita)`
          : ' - dati di classifica n/d')
    );
  }
  return r.join('\n');
}

export const elenco = (dati, classifica) => dati.map((g) => scheda(g, classifica)).join('\n\n');

/** Il formato della risposta, separato dalla domanda.
 *
 *  La domanda e' quella che si farebbe a voce e sta in costruisciPrompt, con
 *  le sue quattro sezioni. Qui c'e' solo come impacchettarle: servono divise
 *  per mostrarle divise, e per poter controllare che l'undici consigliato
 *  torni davvero col modulo dichiarato. */
export const ISTRUZIONI = `Rispondi SOLO in JSON, nessun preambolo, nessun markdown:
{"modulo":"4-4-2",
 "perche_modulo":"...",
 "undici":[{"nome":"...","ruolo":"P|D|C|A","motivo":"..."}],
 "panchina":[{"nome":"...","perche_entra":"..."}],
 "ballottaggi":[{"chi":"...","con":"...","se_gioca":"...","se_non_gioca":"..."}],
 "rischi":[{"chi":"...","tipo":"non-gioca|difesa-forte|rientro","perche":"..."}],
 "dati_mancanti":["..."]}

nome: esattamente come compare nei dati che ti vengono dati.
undici: undici voci, un portiere piu' i dieci del modulo dichiarato.
panchina: in ordine di probabilita' di entrare, la prima e' la piu' probabile.
perche_modulo: obbligatorio, e se il modulo ha 3 difensori deve dire perche' conviene rinunciare al modificatore.
motivo: solo per le scelte non ovvie; stringa vuota quando la scelta si spiega da se'.
dati_mancanti: i dati che ti sarebbero serviti e non c'erano. Vuoto se non ne mancano.`;

export const costruisciPrompt = (dati, classifica) => `Devo schierare la formazione per la prossima giornata di fantacalcio.

Lega Classic, ${REGOLE.squadre} squadre. Il modificatore di difesa vale fino a +${REGOLE.modificatoreMax}
punti e si calcola su portiere piu' i 3 migliori difensori, ma solo
schierando almeno ${REGOLE.difensoriMinimiPerModificatore} difensori.
Bonus: gol +3, assist +1, rigore parato +3, clean sheet +1,
gol subito -1, rigore sbagliato -3, ammonizione -0,5.
Moduli consentiti: ${MODULI.join(', ')}.

Questi sono i miei giocatori con i dati aggiornati:

${elenco(dati, classifica)}

Rispondi con:
1. L'UNDICI CONSIGLIATO e il modulo, con una riga di motivo per
   ogni scelta non ovvia
2. LA PANCHINA ordinata per probabilita' di entrare
3. I BALLOTTAGGI aperti che riguardano i miei, con cosa cambia
   se va in un modo o nell'altro
4. I RISCHI: chi potrebbe non giocare, chi affronta una difesa
   forte, chi e' appena rientrato

Considera che il modificatore rende quasi sempre meglio schierare 4
o 5 difensori. Se consigli 3 difensori, spiega perche' conviene
rinunciare al modificatore.

Basati solo sui dati forniti. Se un dato manca, dillo invece di
stimarlo.`;

export function stima(dati, classifica) {
  const input = stimaToken(ISTRUZIONI) + stimaToken(costruisciPrompt(dati, classifica));
  const output = 1400; // quattro sezioni, undici voci piu' panchina e rischi
  return {
    tokenInput: input,
    tokenOutput: output,
    dollari: PREZZO ? (input / 1e6) * PREZZO.input + (output / 1e6) * PREZZO.output : null,
  };
}

// ------------------------------------------------------------------ chiamata

export async function analizza(client, dati, classifica) {
  try {
    const risposta = await client.messages.create({
      model: MODELLO,
      max_tokens: MAX_TOKENS,
      system: ISTRUZIONI,
      messages: [{ role: 'user', content: costruisciPrompt(dati, classifica) }],
    });
    const grezzo = risposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return {
      ok: true,
      grezzo,
      ...leggiRisposta(grezzo, dati),
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

/** Dalla risposta grezza alle quattro sezioni, abbinate ai MIEI.
 *
 *  Un nome che non e' dei miei si scarta: non e' un consiglio, e' un errore,
 *  e schierare un giocatore che non ho e' peggio che non ricevere il
 *  consiglio. */
export function leggiRisposta(testo, dati) {
  const vuoto = { modulo: null, perche_modulo: null, undici: [], panchina: [], ballottaggi: [], rischi: [], datiMancanti: [], scartate: [] };
  const grezzo = String(testo ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const i = grezzo.indexOf('{');
  const f = grezzo.lastIndexOf('}');
  if (i === -1 || f <= i) return { ...vuoto, errore: 'nessun oggetto JSON nella risposta' };
  let j;
  try {
    j = JSON.parse(grezzo.slice(i, f + 1));
  } catch (e) {
    return { ...vuoto, errore: `JSON illeggibile: ${e.message}` };
  }

  const perNome = new Map(dati.map((g) => [g.nome.toLowerCase(), g]));
  const scartate = [];
  const risolvi = (nome, dove) => {
    const g = perNome.get(String(nome ?? '').trim().toLowerCase());
    if (!g) scartate.push({ dove, nome, motivo: `"${nome}" non e' uno dei miei ${dati.length}` });
    return g ?? null;
  };
  const conGiocatore = (righe, dove, campi) =>
    (Array.isArray(righe) ? righe : []).flatMap((x) => {
      const g = risolvi(x?.nome ?? x?.chi, dove);
      if (!g) return [];
      return [{ id: g.id, nome: g.nome, ruolo: g.ruolo, squadra: g.squadra, ...campi(x) }];
    });

  const modulo = MODULI.includes(String(j?.modulo ?? '').trim()) ? String(j.modulo).trim() : null;
  return {
    modulo,
    moduloDichiarato: String(j?.modulo ?? '').trim() || null,
    perche_modulo: String(j?.perche_modulo ?? '').trim() || null,
    undici: conGiocatore(j?.undici, 'undici', (x) => ({ motivo: String(x?.motivo ?? '').trim() || null })),
    panchina: conGiocatore(j?.panchina, 'panchina', (x) => ({ perche: String(x?.perche_entra ?? '').trim() || null })),
    ballottaggi: conGiocatore(j?.ballottaggi, 'ballottaggi', (x) => ({
      con: String(x?.con ?? '').trim() || null,
      seGioca: String(x?.se_gioca ?? '').trim() || null,
      seNonGioca: String(x?.se_non_gioca ?? '').trim() || null,
    })),
    rischi: conGiocatore(j?.rischi, 'rischi', (x) => ({
      tipo: String(x?.tipo ?? '').trim() || null,
      perche: String(x?.perche ?? '').trim() || null,
    })),
    datiMancanti: (Array.isArray(j?.dati_mancanti) ? j.dati_mancanti : []).map((x) => String(x).trim()).filter(Boolean),
    scartate,
    errore: null,
  };
}

/** La versione ridotta che si salva accanto al consiglio: quanto basta a
 *  ricontrollarlo fra tre settimane. I controlli devono girare sui dati di
 *  ALLORA - se oggi quel giocatore e' guarito, il consiglio di allora non
 *  diventa sbagliato per questo. */
export const dativisti = (dati) =>
  dati.map((g) => ({
    id: g.id,
    nome: g.nome,
    ruolo: g.ruolo,
    squadra: g.squadra,
    titolarita: g.titolarita?.percentuale ?? null,
    indisponibilita: g.indisponibilita.map((i) => ({ tipo: i.tipo, fonte: i.fonte })),
    prossimo: g.prossimo,
  }));

// ------------------------------------------------------------------ archivio

export function salvaAnalisi({ esito, dati, classifica, modello, uso, costo }) {
  const created_at = new Date().toISOString();
  const giornata = dati.find((g) => g.prossimo)?.prossimo?.giornata ?? null;
  const info = getDb()
    .prepare(
      `INSERT INTO analisi_giornata (created_at, giornata, modulo, contenuto, modello, input_tokens, output_tokens, costo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      created_at,
      giornata,
      esito.modulo,
      JSON.stringify({
        perche_modulo: esito.perche_modulo,
        undici: esito.undici,
        panchina: esito.panchina,
        ballottaggi: esito.ballottaggi,
        rischi: esito.rischi,
        datiMancanti: esito.datiMancanti,
        scartate: esito.scartate,
        dati: dativisti(dati),
        buchi: buchi(dati, classifica),
        classifica: classifica?.ok ? { aggiornataIl: classifica.aggiornataIl, righe: classifica.righe } : null,
        classificaMotivo: classifica?.ok ? null : (classifica?.motivo ?? null),
      }),
      modello,
      uso?.input ?? null,
      uso?.output ?? null,
      costo
    );
  return { id: Number(info.lastInsertRowid), created_at, giornata };
}

const daRiga = (r) => {
  let c = {};
  try {
    c = JSON.parse(r.contenuto ?? '{}');
  } catch {
    // Una riga vecchia o corrotta non deve far sparire tutte le altre: si
    // mostra quel che si sa, cioe' la data, la giornata e il costo.
  }
  return {
    id: r.id,
    created_at: r.created_at,
    giornata: r.giornata,
    modulo: r.modulo,
    modello: r.modello,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    costo: r.costo,
    perche_modulo: c.perche_modulo ?? null,
    undici: c.undici ?? [],
    panchina: c.panchina ?? [],
    ballottaggi: c.ballottaggi ?? [],
    rischi: c.rischi ?? [],
    datiMancanti: c.datiMancanti ?? [],
    scartate: c.scartate ?? [],
    dati: c.dati ?? [],
    buchi: c.buchi ?? [],
    classifica: c.classifica ?? null,
    classificaMotivo: c.classificaMotivo ?? null,
  };
};

/** Dalla piu' recente: si confrontano le giornate, e quella che interessa e'
 *  quasi sempre l'ultima. */
export const analisi = (limite = 20) =>
  getDb().prepare('SELECT * FROM analisi_giornata ORDER BY id DESC LIMIT ?').all(limite).map(daRiga);

export const nuovoClient = () => new Anthropic();
export const chiaveMancante = () => !process.env.ANTHROPIC_API_KEY;
