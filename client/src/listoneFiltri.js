/** Filtri e ordinamento della pagina Listone. Stanno fuori dal componente
 *  perche' sono la parte che vale la pena verificare da sola: con sei filtri
 *  combinabili e dieci colonne ordinabili, un errore qui e' invisibile a occhio. */

const senzaAccenti = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Quanto il listino si e' mosso da inizio stagione. Non e' una colonna del db:
 *  si calcola qui, come in ogni altra vista che la mostra. */
export const differenza = (g) => (g.quotazione_iniziale === null ? null : g.quotazione - g.quotazione_iniziale);

export const COLONNE = [
  { chiave: 'nome', etichetta: 'Nome', testo: true },
  { chiave: 'squadra', etichetta: 'Squadra', testo: true },
  { chiave: 'ruolo', etichetta: 'R', testo: true, stretta: true },
  { chiave: 'quotazione', etichetta: 'Qt.A', num: true },
  { chiave: 'quotazione_iniziale', etichetta: 'Qt.I', num: true },
  { chiave: 'diff', etichetta: 'Δ', num: true, calcolata: differenza },
  { chiave: 'fvm', etichetta: 'FVM', num: true },
  { chiave: 'rapporto_fvm', etichetta: 'FVM/Qt', num: true },
  { chiave: 'fascia', etichetta: 'Fascia', num: true },
  { chiave: 'assente_dal', etichetta: 'Stato', testo: true },
];

const valore = (g, c) => (c?.calcolata ? c.calcolata(g) : g[c?.chiave]);

/** Filtri combinabili e ordinamento. I vuoti finiscono sempre in fondo, in un
 *  senso e nell'altro: una casella senza dato non e' "il valore piu' basso". */
export function filtraOrdina(giocatori, { ruolo = null, squadra = '', fascia = null, cerca = '', soloAttivi = true, soloObiettivi = false } = {}, ordine = { chiave: 'quotazione', crescente: false }) {
  const q = senzaAccenti(cerca).trim();
  const col = COLONNE.find((c) => c.chiave === ordine.chiave) ?? COLONNE[3];
  return giocatori
    .filter((g) => !soloAttivi || !g.assente_dal)
    .filter((g) => !ruolo || g.ruolo === ruolo)
    .filter((g) => !squadra || g.squadra === squadra)
    .filter((g) => fascia === null || g.fascia === fascia)
    .filter((g) => !q || senzaAccenti(g.nome).includes(q))
    .filter((g) => !soloObiettivi || g.target)
    .slice()
    .sort((a, b) => {
      const x = valore(a, col);
      const y = valore(b, col);
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      const c = col.testo ? String(x).localeCompare(String(y), 'it') : x - y;
      return ordine.crescente ? c : -c;
    });
}

/** Click sull'intestazione: stessa colonna inverte il verso, colonna nuova
 *  parte crescente per il testo e decrescente per i numeri - che e' quasi
 *  sempre quello che si vuole vedere per primo. */
export const prossimoOrdine = (ordine, colonna) => ({
  chiave: colonna.chiave,
  crescente: ordine.chiave === colonna.chiave ? !ordine.crescente : !!colonna.testo,
});
