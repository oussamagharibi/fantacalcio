import { aggiorna, nuovoStato } from './lib/aggiornamento.js';

/** Script batch del modulo notizie. Da lanciare PRIMA dell'asta, mai durante:
 *  fa decine di richieste con due secondi di pausa e puo' durare minuti.
 *  Se fallisce non rompe niente: players.note e' opzionale e l'app funziona
 *  identica senza.
 *
 *  Il lavoro vero sta in lib/aggiornamento.js, perche' lo fa anche il pulsante
 *  "Aggiorna tutto" della pagina Analisi. Qui restano solo le opzioni da riga
 *  di comando e la stampa. */
const ARGS = new Set(process.argv.slice(2));
const CONFERMATO = ARGS.has('--yes');
const SOLO_RACCOLTA = ARGS.has('--solo-raccolta');

const stato = nuovoStato();
await aggiorna({
  stato,
  conNote: CONFERMATO,
  soloRaccolta: SOLO_RACCOLTA,
  log: (m) => console.log(`[news] ${m}`),
});

if (!SOLO_RACCOLTA && !CONFERMATO && stato.note.stato === 'saltata' && stato.note.totali > 0)
  console.log('[news] Rilancia con --yes per confermare la spesa e generare le note.');

// Una fonte caduta non e' un fallimento della corsa: la corsa ha fatto quel che
// poteva, ed e' scritto sopra quale non ha risposto. Uscire con un codice di
// errore direbbe che non e' stato aggiornato niente, e non e' vero.
const falliti = stato.riepilogo?.fontiKo ?? 0;
if (falliti) console.log(`[news] ATTENZIONE: ${falliti} fonti su ${stato.riepilogo.fontiTotali} non hanno risposto.`);
process.exit(0);
