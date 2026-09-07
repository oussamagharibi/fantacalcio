import Anthropic from '@anthropic-ai/sdk';
import { MODELLO, PREZZO } from './analisi.js';

/** Il consulente d'asta: una domanda, una risposta corta, subito.
 *
 *  Si preme a mano e basta. Nessuna chiamata quando si apre un lotto: una
 *  risposta ci mette qualche secondo e durante i rilanci quei secondi non ci
 *  sono.
 *
 *  Le istruzioni stanno QUI e non nel browser. Il client manda solo dati
 *  strutturati: cosi' quello che si chiede al modello non dipende da cosa
 *  arriva dalla rete, e resta una cosa sola da leggere quando la risposta non
 *  convince. */

/** Sei righe di risposta stanno abbondantemente qui dentro. Basso di proposito:
 *  in asta una risposta lunga arriva tardi ed e' gia' inutile. */
export const MAX_TOKENS = 500;
/** Oltre questo si rinuncia. Meglio nessun consiglio che un'asta ferma ad
 *  aspettarlo: chi sta battendo non puo' fermare il banditore. */
export const TIMEOUT_MS = 10_000;

export const ISTRUZIONI = ({ squadre, crediti }) => `Sei un consulente per un'asta di fantacalcio Classic in corso.
Lega da ${squadre ?? '?'} squadre, ${crediti ?? '?'} crediti.

Regole che contano:
- Modificatore difesa: si calcola sulla media voto di portiere piu' i 3 migliori difensori. MV>=7 vale +6 punti, cioe' quanto due gol. MV 6,5-7 vale +3. Serve schierare almeno 4 difensori.
- Bonus: gol +3, assist +1, rigore parato +3, clean sheet +1, gol subito -1, rigore sbagliato -3, ammonizione -0,5.

Rispondi in massimo 6 righe, diretto e con i numeri:

1. Se c'e' un giocatore aperto: conviene o no, e fino a che prezzo
2. La rosa che ho gia' costruito: la media voto di portiere e difensori regge il modificatore? Ho troppi giocatori della stessa squadra? Ho preso titolari o scommesse? Qualcuno dei miei ha un infortunio in corso o titolarita' bassa?
3. Cosa manca alla rosa e con che urgenza, visto quanti giocatori restano per ruolo e fascia
4. Un rischio concreto che sto correndo adesso

Se il budget non basta piu' per completare la rosa in modo decente, dillo chiaramente. Non inventare dati che non ti ho dato: se un campo manca, dillo invece di stimarlo.`;

/** Il contesto viaggia come JSON: e' una struttura, non una prosa, e riscriverla
 *  a parole qui vorrebbe dire inventare un secondo formato da tenere allineato
 *  a quello vero. Un campo assente resta null, e le istruzioni dicono al
 *  modello di dichiararlo invece di stimarlo. */
export const componiDomanda = (contesto) =>
  `Ecco lo stato dell'asta in JSON. I campi a null sono dati che non ho: non stimarli.\n\n${JSON.stringify(contesto, null, 1)}`;

/** Nessun tentativo automatico e timeout corto: le impostazioni di default del
 *  client (dieci minuti, due ritentativi) sono l'opposto di quello che serve
 *  qui, dove tardi vuol dire inutile. */
export const nuovoClient = () => new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 });

export const chiaveMancante = () => !process.env.ANTHROPIC_API_KEY;

export async function chiedi(client, contesto) {
  const lega = contesto?.lega ?? {};
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
    if (!testo) return { ok: false, errore: 'risposta vuota' };
    return {
      ok: true,
      testo,
      // Il costo di una singola domanda: si vede a schermo, cosi' non e' una
      // spesa che si accumula senza che nessuno la guardi.
      uso: { input: risposta.usage.input_tokens, output: risposta.usage.output_tokens },
      costo: (risposta.usage.input_tokens / 1e6) * PREZZO.input + (risposta.usage.output_tokens / 1e6) * PREZZO.output,
      troncata: risposta.stop_reason === 'max_tokens',
    };
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError)
      return { ok: false, errore: `nessuna risposta entro ${TIMEOUT_MS / 1000} secondi` };
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, errore: 'chiave API non valida' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, errore: "rate limit: riprova fra poco" };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, errore: `richiesta rifiutata: ${e.message}` };
    if (e instanceof Anthropic.APIError) return { ok: false, errore: `errore API ${e.status}` };
    return { ok: false, errore: e.message };
  }
}
