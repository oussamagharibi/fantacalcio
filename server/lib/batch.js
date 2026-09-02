import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../db.js';

/** Lancia "npm run news" come processo figlio e tiene le righe di avanzamento
 *  in memoria, cosi' la pagina Analisi puo' mostrarle mentre gira. Uno alla
 *  volta: due batch insieme si contenderebbero le stesse tabelle. */

const MAX_RIGHE = 500;

let corsa = null;

export const statoBatch = () =>
  corsa
    ? { inCorso: corsa.inCorso, avviatoIl: corsa.avviatoIl, righe: corsa.righe, uscita: corsa.uscita, errore: corsa.errore }
    : { inCorso: false, avviatoIl: null, righe: [], uscita: null, errore: null };

export function avviaBatch({ conferma = false } = {}) {
  if (corsa?.inCorso) return { ok: false, errore: 'un batch e\' gia\' in corso' };

  const args = [path.join(ROOT, 'server', 'news.js'), ...(conferma ? ['--yes'] : [])];
  corsa = { inCorso: true, avviatoIl: new Date().toISOString(), righe: [], uscita: null, errore: null };

  const figlio = spawn(process.execPath, ['--env-file-if-exists=.env', ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const accoda = (blocco) => {
    for (const riga of String(blocco).split(/\r?\n/)) {
      if (!riga.trim()) continue;
      corsa.righe.push(riga);
      // Un batch lungo non deve far crescere la memoria all'infinito: si tiene
      // la coda, che e' quella che interessa a chi guarda l'avanzamento.
      if (corsa.righe.length > MAX_RIGHE) corsa.righe.splice(0, corsa.righe.length - MAX_RIGHE);
    }
  };
  figlio.stdout.on('data', accoda);
  figlio.stderr.on('data', accoda);
  figlio.on('error', (e) => {
    corsa.errore = e.message;
    corsa.inCorso = false;
  });
  figlio.on('close', (code) => {
    corsa.uscita = code;
    corsa.inCorso = false;
  });

  return { ok: true, avviatoIl: corsa.avviatoIl };
}
