async function json(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { campo: body.campo, status: r.status });
  return body;
}

export const getConfig = () => json('/api/config');
export const getHealth = () => json('/api/health');
export const postConfig = (c) =>
  json('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(c),
  });

/** Niente content-type a mano: lo imposta il browser con il boundary giusto. */
export function uploadListone(file) {
  const dati = new FormData();
  dati.append('file', file);
  return json('/api/listone/upload', { method: 'POST', body: dati });
}
