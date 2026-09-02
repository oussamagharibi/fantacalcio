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

/** Stato completo: giocatori, rosa, contatori. Le azioni dell'asta lo
 *  restituiscono gia' aggiornato, cosi' una registrazione e' un round trip solo. */
export const getStato = () => json('/api/stato');
export const postAcquisto = (playerId, prezzo) => invia('/api/acquisti', { playerId, prezzo });
export const postUscita = (playerId) => invia('/api/usciti', { playerId });
export const postAnnulla = () => invia('/api/annulla', {});
export const postTarget = (playerId) => invia('/api/target', { playerId });

export const postGeneraAnalisi = (conferma) => invia('/api/news/genera', { conferma });
export const getStatoAnalisi = () => json('/api/news/stato');
