async function json(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { campo: body.campo, status: r.status });
  return body;
}

const invia = (url, corpo) =>
  json(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

export const getConfig = () => json('/api/config');
export const getHealth = () => json('/api/health');
export const postConfig = (c) => invia('/api/config', c);

/** Niente content-type a mano: lo imposta il browser con il boundary giusto. */
export function uploadListone(file) {
  const dati = new FormData();
  dati.append('file', file);
  return json('/api/listone/upload', { method: 'POST', body: dati });
}

/** Statistiche storiche ed expected goals: piu' file in una richiesta sola,
 *  uno per stagione. Il campo si chiama sempre "file", come per il listone. */
const uploadPiu = (url, files) => {
  const dati = new FormData();
  for (const f of files) dati.append('file', f);
  return json(url, { method: 'POST', body: dati });
};
export const uploadStats = (files) => uploadPiu('/api/stats/upload', files);
export const uploadXg = (files) => uploadPiu('/api/xg/upload', files);

/** Stato completo: giocatori, rosa, contatori. Le azioni dell'asta lo
 *  restituiscono gia' aggiornato, cosi' una registrazione e' un round trip solo. */
export const getStato = () => json('/api/stato');
export const postAcquisto = (playerId, prezzo) => invia('/api/acquisti', { playerId, prezzo });
export const postUscita = (playerId) => invia('/api/usciti', { playerId });
/** Senza argomenti annulla l'ultima azione (Ctrl+Z dell'asta); con un
 *  playerId annulla quella di quel giocatore (la X in pagina Situazione). */
export const postAnnulla = (playerId) => invia('/api/annulla', playerId ? { playerId } : {});
export const postTarget = (playerId) => invia('/api/target', { playerId });

/** Azzera l'asta: cancella tutti gli acquisti. Chi la chiama deve gia' aver
 *  chiesto conferma - qui non c'e' rete di sicurezza. */
export const postReset = () => invia('/api/reset', {});

/** Aggiornamento di tutte le fonti, note AI comprese. Torna subito: la corsa
 *  dura minuti e va seguita interrogando lo stato, non tenendo aperta questa.
 *  409 se ne sta gia' girando una. */
export const postAggiorna = () => invia('/api/news/genera', { conferma: true });
export const getStatoAggiornamento = () => json('/api/news/stato');
