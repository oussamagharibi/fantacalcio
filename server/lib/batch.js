import { getDb } from '../db.js';
import { aggiorna, nuovoStato, leggibile } from './aggiornamento.js';

/** Ospita la corsa di aggiornamento e ne serve lo stato alla pagina.
 *
 *  Gira DENTRO il server, non in un processo figlio. Online quel figlio voleva
 *  dire un secondo Node nella stessa istanza e un secondo scrittore sullo
 *  stesso file SQLite, e l'avanzamento andava ricavato leggendo il suo stdout.
 *  Qui la funzione riempie una struttura e il client la legge com'e'.
 *
 *  Uno alla volta: due corse insieme si contenderebbero le stesse tabelle. */

const CHIAVE = 'aggiornamento';
/** Ogni cambiamento salverebbe su disco centinaia di volte durante le note.
 *  Il salvataggio serve solo a sopravvivere a un riavvio: due secondi di
 *  ritardo sono accettabili, e l'inizio e la fine si salvano comunque. */
const PAUSA_SALVATAGGIO_MS = 2000;

const VUOTO = {
  inCorso: false,
  esito: null,
  avviatoIl: null,
  finitoIl: null,
  fase: null,
  fonti: [],
  avvisi: [],
  note: { stato: 'attesa', motivo: null, fatte: 0, fallite: 0, totali: null },
  riepilogo: null,
  errore: null,
  righe: [],
};

let corsa = null;
let recuperato = false;
let ultimoSalvataggio = 0;

/** Su disco non finiscono le righe di log: sono la parte grossa e servono solo
 *  mentre la corsa e' viva. Quel che deve sopravvivere e' l'esito. */
const perDisco = (s) => ({ ...s, righe: [] });

function salva(s, forza = false) {
  const ora = Date.now();
  if (!forza && ora - ultimoSalvataggio < PAUSA_SALVATAGGIO_MS) return;
  ultimoSalvataggio = ora;
  try {
    getDb()
      .prepare('INSERT INTO meta (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore')
      .run(CHIAVE, JSON.stringify(perDisco(s)));
  } catch {
    // Un aggiornamento non deve morire perche' non si e' potuto annotare il
    // suo stesso avanzamento.
  }
}

function daDisco() {
  try {
    const r = getDb().prepare('SELECT valore FROM meta WHERE chiave = ?').get(CHIAVE);
    return r?.valore ? JSON.parse(r.valore) : null;
  } catch {
    return null;
  }
}

/** Se il servizio si e' riavviato a meta' corsa, in archivio resta scritto
 *  "in corso" e nessuno lo cambiera' mai piu': il processo che doveva farlo
 *  non c'e'. Quindi al primo sguardo dopo un riavvio la corsa in sospeso si
 *  chiude come interrotta - e si vede che e' successo, invece di restare
 *  appesa a un avanzamento che non avanza. */
function recupera() {
  if (recuperato) return;
  recuperato = true;
  const p = daDisco();
  if (!p) return;
  if (p.inCorso) {
    p.inCorso = false;
    p.esito = 'interrotta';
    p.finitoIl = new Date().toISOString();
    for (const f of p.fonti ?? []) if (f.stato === 'in-corso' || f.stato === 'attesa') f.stato = 'interrotta';
    if (p.note?.stato === 'in-corso') p.note.stato = 'interrotta';
    p.avvisi = [
      ...(p.avvisi ?? []),
      "Il servizio si e' riavviato mentre l'aggiornamento era in corso: la corsa e' stata interrotta. Quello che era gia' stato letto e' salvato; rilancia per completare.",
    ];
    salva(p, true);
  }
  corsa = { ...p, righe: [] };
}

/** Il client interroga una volta al secondo: mandargli 600 righe di log a ogni
 *  giro sarebbe traffico sprecato per qualcosa che sta dietro a un "mostra
 *  dettaglio". La coda basta, ed e' la parte che interessa a chi guarda. */
const RIGHE_SERVITE = 120;

export function statoBatch() {
  recupera();
  if (!corsa) return { ...VUOTO };
  return { ...corsa, righe: (corsa.righe ?? []).slice(-RIGHE_SERVITE) };
}

export function avviaBatch({ conferma = false } = {}) {
  recupera();
  if (corsa?.inCorso) return { ok: false, errore: "un aggiornamento e' gia' in corso" };

  const s = nuovoStato();
  corsa = s;
  salva(s, true);

  // Deliberatamente non atteso: la richiesta HTTP torna subito e il client
  // interroga /api/news/stato. Una richiesta che restasse appesa per minuti
  // verrebbe chiusa dal proxy molto prima della fine.
  aggiorna({
    stato: s,
    conNote: conferma,
    log: () => {},
    su: (x) => salva(x),
  })
    .catch((e) => {
      s.esito = 'errore';
      s.errore = leggibile(e?.message ?? e);
      s.avvisi.push(`L'aggiornamento si e' fermato: ${s.errore}`);
    })
    .finally(() => {
      s.inCorso = false;
      s.finitoIl = new Date().toISOString();
      salva(s, true);
    });

  return { ok: true, avviatoIl: s.avviatoIl };
}
