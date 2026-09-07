import Anthropic from '@anthropic-ai/sdk';
import { MODELLO } from './analisi.js';

/** Il consulente d'asta: una domanda, una risposta corta.
 *
 *  Si preme a mano e basta. Nessuna chiamata quando si apre un lotto.
 *
 *  Le istruzioni stanno QUI e non nel browser. Il client manda solo dati
 *  strutturati: cosi' quello che si chiede al modello non dipende da cosa
 *  arriva dalla rete, e resta una cosa sola da leggere quando la risposta non
 *  convince. */

/** Sei righe in italiano sono nell'ordine dei 250 token. 400 lascia margine
 *  senza aprire la porta a un poema: il tetto non e' solo una questione di
 *  lunghezza, e' anche quanto puo' durare la generazione. */
export const MAX_TOKENS = 400;

/** Venticinque secondi.
 *
 *  Erano dieci, e non bastavano: una richiesta senza streaming torna solo
 *  quando la generazione e' finita, e 400 token di uscita a 30-60 token al
 *  secondo sono gia' 7-13 secondi, piu' la lettura dell'ingresso e la rete.
 *  Dieci secondi non erano un margine stretto: erano sotto il caso normale.
 *
 *  Il pulsante e' manuale e non sta sul percorso dei rilanci: aspettare
 *  qualche secondo in piu' e' meglio che non avere risposta. */
export const TIMEOUT_MS = 25_000;

export const ISTRUZIONI = ({ squadre, crediti }) => `Sei un consulente per un'asta di fantacalcio Classic in corso.
Lega da ${squadre ?? '?'} squadre, ${crediti ?? '?'} crediti.

Regole che contano:
- Modificatore difesa: si calcola sulla media voto di portiere piu' i 3 migliori difensori. MV>=7 vale +6 punti, cioe' quanto due gol. MV 6,5-7 vale +3. MV 6-6,5 vale +1. Serve schierare almeno 4 difensori.
- Bonus: gol +3, assist +1, rigore parato +3, clean sheet +1, gol subito -1, rigore sbagliato -3, ammonizione -0,5.

Rispondi in massimo 6 righe, diretto e con i numeri:

1. Se c'e' un giocatore aperto: conviene o no, e fino a che prezzo
2. La rosa che ho gia' costruito: la media voto di portiere e difensori regge il modificatore? Ho troppi giocatori della stessa squadra? Ho preso titolari o scommesse? Qualcuno dei miei ha un infortunio in corso o titolarita' bassa?
3. Cosa manca alla rosa e con che urgenza, visto quanti giocatori restano per ruolo e fascia
4. Un rischio concreto che sto correndo adesso

Se il budget non basta piu' per completare la rosa in modo decente, dillo chiaramente. Non inventare dati che non ti ho dato: se un campo manca, dillo invece di stimarlo.`;

/** Il contesto viaggia come JSON compatto.
 *  Indentarlo lo faceva crescere di un terzo senza aggiungere una virgola di
 *  informazione: 26.000 caratteri invece di 18.000, cioe' duemila token di
 *  ingresso pagati e letti per degli spazi. */
export const componiDomanda = (contesto) =>
  `Ecco lo stato dell'asta in JSON. I campi a null sono dati che non ho: non stimarli.\n\n${JSON.stringify(contesto)}`;

/** Nessun tentativo automatico: le impostazioni di default del client (dieci
 *  minuti di timeout, due ritentativi) sono l'opposto di quello che serve qui.
 *  Un ritentativo automatico raddoppierebbe l'attesa senza dirlo a nessuno. */
export const nuovoClient = () => new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 });

export const chiaveMancante = () => !process.env.ANTHROPIC_API_KEY;

/** I motivi per cui una domanda puo' non avere risposta. Sono codici, non
 *  frasi: il server li logga, il client li traduce. "Non ha risposto" senza
 *  dire perche' e' il messaggio che fa perdere piu' tempo di tutti - manda a
 *  cercare un problema di rete quando la chiave e' scaduta. */
export const MOTIVI = {
  chiave: 'chiave',
  timeout: 'timeout',
  rete: 'rete',
  autorizzazione: 'autorizzazione',
  limite: 'limite',
  richiesta: 'richiesta',
  server: 'server',
  malformata: 'malformata',
  sconosciuto: 'sconosciuto',
};

/** Da eccezione del client a motivo e frase. Dal piu' specifico al piu'
 *  generico, e con il dato tecnico accanto: lo stato HTTP o il nome
 *  dell'errore servono a chi legge il log, non a chi legge lo schermo. */
/** Il nome della classe, non e.name: sugli errori di connessione dell'SDK
 *  e.name resta "Error" e nel log non dice niente. */
const nomeErrore = (e) => e?.constructor?.name ?? e?.name ?? typeof e;

export function classifica(e, timeoutMs = TIMEOUT_MS) {
  if (e instanceof Anthropic.APIConnectionTimeoutError)
    return { motivo: MOTIVI.timeout, errore: `nessuna risposta entro ${timeoutMs / 1000} secondi`, tecnico: nomeErrore(e) };
  if (e instanceof Anthropic.AuthenticationError)
    return { motivo: MOTIVI.chiave, errore: 'la chiave API e\' stata rifiutata', tecnico: `HTTP ${e.status}` };
  if (e instanceof Anthropic.PermissionDeniedError)
    return { motivo: MOTIVI.autorizzazione, errore: 'la chiave non ha accesso a questo modello', tecnico: `HTTP ${e.status}` };
  if (e instanceof Anthropic.RateLimitError)
    return { motivo: MOTIVI.limite, errore: 'troppe richieste: riprova fra un momento', tecnico: `HTTP ${e.status}` };
  if (e instanceof Anthropic.BadRequestError)
    return { motivo: MOTIVI.richiesta, errore: `richiesta rifiutata: ${e.message}`, tecnico: `HTTP ${e.status}` };
  if (e instanceof Anthropic.InternalServerError)
    return { motivo: MOTIVI.server, errore: 'errore dalla parte di Anthropic, non nostro', tecnico: `HTTP ${e.status}` };
  if (e instanceof Anthropic.APIConnectionError)
    return { motivo: MOTIVI.rete, errore: 'non sono riuscito a raggiungere l\'API', tecnico: e.cause?.code ?? nomeErrore(e) };
  if (e instanceof Anthropic.APIError)
    return { motivo: MOTIVI.sconosciuto, errore: `errore API ${e.status}`, tecnico: `HTTP ${e.status}` };
  return { motivo: MOTIVI.sconosciuto, errore: e?.message ?? 'errore senza messaggio', tecnico: nomeErrore(e) };
}

export async function chiedi(client, contesto) {
  const lega = contesto?.lega ?? {};
  const partito = Date.now();
  try {
    const risposta = await client.messages.create({
      model: MODELLO,
      max_tokens: MAX_TOKENS,
      system: ISTRUZIONI({ squadre: lega.squadre, crediti: lega.crediti }),
      messages: [{ role: 'user', content: componiDomanda(contesto) }],
    });
    const testo = risposta.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const durata = Date.now() - partito;
    if (!testo)
      return {
        ok: false,
        motivo: MOTIVI.malformata,
        errore: 'il modello ha risposto senza testo',
        tecnico: `stop_reason ${risposta.stop_reason}`,
        durata,
      };
    return {
      ok: true,
      testo,
      durata,
      modello: MODELLO,
      uso: { input: risposta.usage.input_tokens, output: risposta.usage.output_tokens },
      troncata: risposta.stop_reason === 'max_tokens',
    };
  } catch (e) {
    return { ok: false, ...classifica(e), durata: Date.now() - partito };
  }
}
