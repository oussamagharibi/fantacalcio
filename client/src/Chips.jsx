import { MOLTI_PARA_RIGORI, paraRigori, rigorista } from './giocatore.js';

/** I due chip che si vedono uguali su Analisi, Listone e Situazione.
 *
 *  Sono un componente solo perche' l'unica cosa peggiore di un chip sbagliato
 *  e' lo stesso chip scritto in tre modi diversi: chi guarda si convince che
 *  significhino cose diverse. */

/** La gerarchia, non solo il fatto di esserci.
 *
 *  Classe "rigorista" e non "rig": quest ultima la usa gia la pagina
 *  Situazione per l etichetta "disponibile", e due cose diverse con lo stesso
 *  nome prima o poi prendono lo stesso stile.
 *
 *  "Rigorista" e basta metteva sulla stessa riga chi i rigori li calcia e chi
 *  li calcerebbe se non ci fosse l'altro, e sono due giocatori con due prezzi
 *  diversi. Il numero viene dall'ordine della lista di fantacalcio.it, che e'
 *  gia' la gerarchia; se la fonte non lo dice, il chip resta generico invece
 *  di indovinare una posizione. */
export function ChipRigorista({ g }) {
  const r = rigorista(g);
  if (!r) return null;
  if (r.ordine === null) return <span className="chip rigorista" title={r.testo}>rigorista</span>;
  return (
    <span className={`chip rigorista rigorista${r.ordine === 1 ? '1' : '2'}`} title={r.testo}>
      rigorista {r.ordine}ª scelta
    </span>
  );
}

/** I rigori parati di un portiere, sommati sulle stagioni in archivio. */
export function ChipParaRigori({ g }) {
  const p = paraRigori(g);
  if (!p) return null;
  const molti = p.totale >= MOLTI_PARA_RIGORI;
  return (
    <span
      className={`chip para${molti ? ' molti' : ''}`}
      title={`${p.stagioni.map((s) => `${s.stagione}: ${s.parati}`).join(', ')}${
        molti ? ` — in questa lega un rigore parato vale +3, come un gol` : ''
      }`}
    >
      para-rigori: {p.totale}
    </span>
  );
}

/** I due insieme, nell'ordine in cui hanno senso: prima chi li calcia, poi chi
 *  li para. Non rende niente se non c'e' niente da dire, cosi' la cella di una
 *  tabella resta vuota invece di contenere uno spazio. */
export function ChipsGiocatore({ g }) {
  const r = rigorista(g);
  const p = paraRigori(g);
  if (!r && !p) return null;
  return (
    <span className="chips-g">
      <ChipRigorista g={g} />
      <ChipParaRigori g={g} />
    </span>
  );
}
