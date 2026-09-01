import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Avvio di produzione: un solo processo che serve API e frontend.
 *  Se client/dist manca lo builda al volo, cosi' "npm start" funziona anche
 *  su una macchina appena clonata o se il build phase di Railway non e' girato. */
const ROOT = path.resolve(import.meta.dirname, '..');
const INDEX = path.join(ROOT, 'client', 'dist', 'index.html');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const esegui = (...args) =>
  execFileSync(npm, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });

if (fs.existsSync(INDEX)) {
  console.log('[start] client/dist presente, salto la build');
} else {
  console.log('[start] client/dist assente: builda il client');
  if (!fs.existsSync(path.join(ROOT, 'client', 'node_modules'))) esegui('--prefix', 'client', 'install');
  esegui('--prefix', 'client', 'run', 'build');
}

await import('../server/index.js');
