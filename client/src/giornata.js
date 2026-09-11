/** Le verifiche sul consiglio di Claude, senza browser dentro.
 *
 *  Un consiglio arrivato da un modello non si mostra e basta: si controlla
 *  che stia in piedi da solo. Undici giocatori, un portiere, i reparti che
 *  tornano col modulo dichiarato, nessun infortunato in campo. Sono le cose
 *  che si vedrebbero al primo sguardo, e che a schermo e' meglio trovare gia'
 *  segnalate invece di doverle contare a mano ogni domenica. */

export const MODULI = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1'];

/** Il modificatore di difesa vale fino a +6 e si calcola su portiere piu' i 3
 *  migliori difensori, ma SOLO da 4 difensori in su. E' la regola che pesa
 *  piu' di tutte: i moduli a 3 partono con un handicap, e va detto. */
export const MODIFICATORE_MIN_D = 4;
export const MODIFICATORE_MAX = 6;

export const scomponi = (modulo) => {
  const p = String(modulo ?? '').split('-').map(Number);
  if (p.length !== 3 || p.some((x) => !Number.isInteger(x) || x < 0)) return null;
  const [D, C, A] = p;
  return { D, C, A, totale: D + C + A };
};

export const conModificatore = (modulo) => (scomponi(modulo)?.D ?? 0) >= MODIFICATORE_MIN_D;

/** Un giocatore e' indisponibile se qualche fonte lo segnala fuori. "dubbio"
 *  non basta a escluderlo - e' un dubbio, non un'assenza - ma va distinto,
 *  perche' schierare un dubbio e' una scelta e schierare un out e' un errore. */
export const FUORI = ['infortunio', 'squalifica'];
export const INCERTO = ['dubbio'];

export const statoDisponibilita = (g) => {
  const tipi = (g?.indisponibilita ?? []).map((i) => i.tipo);
  if (tipi.some((t) => FUORI.includes(t))) return 'fuori';
  if (tipi.some((t) => INCERTO.includes(t))) return 'incerto';
  return 'ok';
};

/** I controlli, tutti insieme. Ognuno torna un rilievo con la sua gravita':
 *  'errore' e' qualcosa che non si puo' schierare, 'nota' e' qualcosa da
 *  sapere prima di copiare la formazione. */
/** Il modulo su cui si controlla.
 *
 *  Se l'ho scelto io, e' il mio: la risposta va misurata su quello che le ho
 *  chiesto, non su quello che ha deciso lei. Altrimenti e' quello proposto. */
export const moduloDiRiferimento = (a) => a?.moduloScelto ?? a?.modulo ?? null;

export function verifica(a, dati = []) {
  const rilievi = [];
  const per = new Map(dati.map((g) => [g.id, g]));
  const undici = a?.undici ?? [];
  const scelto = a?.moduloScelto ?? null;
  const riferimento = moduloDiRiferimento(a);
  const m = scomponi(riferimento);

  if (!riferimento) rilievi.push({ gravita: 'errore', testo: `modulo non riconosciuto: "${a?.moduloDichiarato ?? '(assente)'}"` });

  // Avevo chiesto un modulo e ne e' arrivato un altro: si controlla comunque
  // sul mio, ma la disobbedienza va vista - e' il motivo per cui il selettore
  // esiste.
  if (scelto && a?.modulo && a.modulo !== scelto)
    rilievi.push({ gravita: 'errore', testo: `avevo chiesto il ${scelto} e la risposta propone il ${a.modulo}` });

  if (undici.length !== 11)
    rilievi.push({ gravita: 'errore', testo: `l'undici ne ha ${undici.length}, non 11` });

  const conta = { P: 0, D: 0, C: 0, A: 0 };
  for (const g of undici) conta[g.ruolo] = (conta[g.ruolo] ?? 0) + 1;

  if (conta.P !== 1) rilievi.push({ gravita: 'errore', testo: `portieri in campo: ${conta.P}, non 1` });

  if (m) {
    for (const [ruolo, atteso] of [['D', m.D], ['C', m.C], ['A', m.A]])
      if (conta[ruolo] !== atteso)
        rilievi.push({ gravita: 'errore', testo: `il ${riferimento} vuole ${atteso} ${ruolo}, in campo ce ne sono ${conta[ruolo]}` });
  }

  // Il pezzo che conta: chi non puo' giocare non deve stare in campo.
  for (const g of undici) {
    const d = per.get(g.id);
    const s = statoDisponibilita(d);
    if (s === 'fuori')
      rilievi.push({
        gravita: 'errore',
        testo: `${g.nome} e' schierato ma risulta fuori: ${(d.indisponibilita ?? []).map((i) => i.tipo).join(', ')}`,
      });
    else if (s === 'incerto')
      rilievi.push({ gravita: 'nota', testo: `${g.nome} e' schierato ed e' dato in dubbio` });
  }

  // Un doppione non e' una formazione.
  const visti = new Set();
  for (const g of undici) {
    if (visti.has(g.id)) rilievi.push({ gravita: 'errore', testo: `${g.nome} compare due volte nell'undici` });
    visti.add(g.id);
  }

  // Chi e' fuori dai giochi non dovrebbe nemmeno stare in panchina come
  // "probabile che entri": non e' un errore, ma e' fuorviante.
  for (const g of a?.panchina ?? [])
    if (statoDisponibilita(per.get(g.id)) === 'fuori')
      rilievi.push({ gravita: 'nota', testo: `${g.nome} e' in panchina ma risulta fuori` });

  // Modulo senza modificatore. Chi l'ha scelto cambia la gravita': se l'ho
  // imposto io, la scelta e' mia e quello che manca e' al piu' il promemoria
  // di cosa ci rimetto. Se l'ha scelto il modello senza spiegarsi, e' un
  // errore: la richiesta diceva di spiegarlo.
  if (riferimento && !conModificatore(riferimento)) {
    const d = scomponi(riferimento).D;
    if (scelto)
      rilievi.push({
        gravita: 'nota',
        testo: a?.perche_modulo
          ? `${riferimento}: ${d} difensori, niente modificatore — l'hai scelto tu e il promemoria c'e'`
          : `${riferimento}: ${d} difensori, niente modificatore — l'hai scelto tu, ma manca il promemoria di cosa ci rimetti`,
      });
    else
      rilievi.push({
        gravita: a?.perche_modulo ? 'nota' : 'errore',
        testo: a?.perche_modulo
          ? `${riferimento}: ${d} difensori, niente modificatore — la motivazione c'e'`
          : `${riferimento}: ${d} difensori, niente modificatore, e non e' spiegato perche'`,
      });
  }

  return {
    rilievi,
    errori: rilievi.filter((r) => r.gravita === 'errore').length,
    note: rilievi.filter((r) => r.gravita === 'nota').length,
    conta,
    riferimento,
    scelto,
    // Quello che dice il modulo di riferimento...
    modificatore: riferimento ? conModificatore(riferimento) : null,
    // ...e quello che succede davvero. Di solito coincidono, ma se l'undici
    // non rispetta il modulo sono due cose diverse, e il modificatore lo
    // decide chi e' in campo, non l'etichetta del modulo.
    modificatoreInCampo: conta.D >= MODIFICATORE_MIN_D,
  };
}

/** Le voci del selettore, col costo della scelta gia' scritto accanto: si
 *  vede cosa si perde PRIMA di sceglierlo, che era il punto. */
export const OPZIONI_MODULO = [
  { valore: '', etichetta: 'Scegli tu', nota: 'decide Claude qual e\' il migliore', modificatore: null, difensori: null },
  ...MODULI.map((m) => {
    const d = scomponi(m).D;
    return {
      valore: m,
      etichetta: m,
      difensori: d,
      modificatore: d >= MODIFICATORE_MIN_D,
      nota: d >= MODIFICATORE_MIN_D ? `${d} difensori · modificatore fino a +${MODIFICATORE_MAX}` : `${d} difensori · niente modificatore`,
    };
  }),
];

/** Gli esclusi: chi e' in rosa e non compare ne' in campo ne' in panchina.
 *  Vale la pena vederli, perche' un infortunato escluso e' giusto e un
 *  titolare dimenticato no. */
export function esclusi(a, dati = []) {
  const dentro = new Set([...(a?.undici ?? []), ...(a?.panchina ?? [])].map((g) => g.id));
  return dati
    .filter((g) => !dentro.has(g.id))
    .map((g) => ({ ...g, perche: statoDisponibilita(g) }));
}

export const ETICHETTE_RISCHIO = {
  'non-gioca': 'potrebbe non giocare',
  'difesa-forte': 'difesa forte',
  rientro: 'appena rientrato',
};
