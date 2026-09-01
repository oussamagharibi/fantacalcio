import { getDb, DB_PATH } from '../db.js';

const righe = getDb()
  .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type DESC, name")
  .all();

console.log(`-- ${DB_PATH}\n`);
for (const r of righe) console.log(r.sql + ';\n');
console.log(`-- ${righe.length} oggetti`);
