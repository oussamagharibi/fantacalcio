import Anthropic from '@anthropic-ai/sdk';

/** Il modello e' quello chiesto per questo modulo. Non e' il default del
 *  progetto: e' una scelta di costo per un compito di sola sintesi. */
export const MODELLO = 'claude-sonnet-4-6';
/** Listino Anthropic per Sonnet 4.6, dollari per milione di token. */
export const PREZZO = { input: 3.0, output: 15.0 };
/** La nota sono tre righe piu' un verdetto: mille token sono gia' abbondanti. */
const MAX_TOKENS = 1000;
/** Tetto per estratto. L'estratto arriva gia' ritagliato attorno al punto in
 *  cui il giocatore e' nominato: questo e' solo una cintura di sicurezza. */
export const CARATTERI_PER_ARTICOLO = 2000;

export const ISTRUZIONI = `Sintetizza in massimo 3 righe la situazione di questo giocatore per l'asta di fantacalcio: titolarita', condizione fisica, rigori.
Termina con PRENDI, VALUTA o EVITA e una riga di motivazione.
Basati SOLO sugli estratti forniti, non su conoscenze pregresse.
Se gli estratti non bastano, scrivi DATI INSUFFICIENTI.`;

export function costruisciPrompt(g) {
  const estratti = g.articoli
    .map((a, i) => `[${i + 1}] ${a.fonte} - ${a.titolo ?? '(senza titolo)'}${a.data ? ` (${a.data.slice(0, 10)})` : ''}\n${(a.estratto ?? '').slice(0, CARATTERI_PER_ARTICOLO)}`)
    .join('\n\n');
  return `Giocatore: ${g.nome} (${g.ruolo}, ${g.squadra})\n\nEstratti:\n\n${estratti}`;
}

/** Stima locale, dichiarata come tale: serve solo a decidere se procedere.
 *  Il costo vero viene dai campi usage della risposta, stampati a fine giro. */
export const stimaToken = (testo) => Math.ceil(testo.length / 3.5);

export function stimaCosto(giocatori) {
  let input = 0;
  for (const g of giocatori) input += stimaToken(ISTRUZIONI) + stimaToken(costruisciPrompt(g));
  const output = giocatori.length * 250; // tre righe piu' verdetto, con margine
  return {
    chiamate: giocatori.length,
    tokenInput: input,
    tokenOutput: output,
    dollari: (input / 1e6) * PREZZO.input + (output / 1e6) * PREZZO.output,
  };
}

export const costoReale = (uso) => (uso.input / 1e6) * PREZZO.input + (uso.output / 1e6) * PREZZO.output;

export const chiaveMancante = () => !process.env.ANTHROPIC_API_KEY;

/** Una chiamata per giocatore. Errori tipizzati, dal piu' specifico al piu'
 *  generico: un 429 si riprova piu' tardi, un 400 no. */
export async function generaNota(client, g) {
  try {
    const risposta = await client.messages.create({
      model: MODELLO,
      max_tokens: MAX_TOKENS,
      system: ISTRUZIONI,
      messages: [{ role: 'user', content: costruisciPrompt(g) }],
    });
    const testo = risposta.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return {
      ok: true,
      testo,
      uso: { input: risposta.usage.input_tokens, output: risposta.usage.output_tokens },
      stop: risposta.stop_reason,
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, errore: 'chiave API non valida' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, errore: 'rate limit: riprova piu\' tardi' };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, errore: `richiesta rifiutata: ${e.message}` };
    if (e instanceof Anthropic.APIError) return { ok: false, errore: `errore API ${e.status}: ${e.message}` };
    return { ok: false, errore: e.message };
  }
}

/** La nota che finisce in players.note porta con se' le fonti usate: senza,
 *  a distanza di giorni non si sa piu' su cosa si basava. */
export const conFonti = (testo, articoli) =>
  `${testo}\n\nFonti (${articoli.length}):\n` + articoli.map((a) => `- ${a.fonte}: ${a.titolo ?? a.url}\n  ${a.url}`).join('\n');

export const nuovoClient = () => new Anthropic();
