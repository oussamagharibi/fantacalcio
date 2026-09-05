import { useState } from 'react';
import { commutaObiettivo } from './azioni.js';

/** La stella "obiettivo": un solo componente per tutte e quattro le viste.
 *
 *  La card di Analisi l'aveva scritta dentro di se'. Ora che compare anche in
 *  due tabelle e nella scheda, la definizione sta qui: stesso endpoint, stesso
 *  stato che torna, stessa animazione. Quattro copie sarebbero state quattro
 *  modi di divergere.
 *
 *  Il click sostituisce lo stato globale, quindi marcare un obiettivo da una
 *  pagina si vede subito in tutte le altre - come per "preso da me" e "uscito". */
export default function Stella({ g, onStato, onAvviso, angolo = false }) {
  const [pop, setPop] = useState(false);
  const [inCorso, setInCorso] = useState(false);

  async function commuta(e) {
    // Nelle tabelle la stella sta dentro una riga cliccabile e trascinabile:
    // il click e' suo e non deve risalire.
    e.stopPropagation();
    if (inCorso) return;
    setInCorso(true);
    setPop(true);
    setTimeout(() => setPop(false), 240);
    try {
      const { stato } = await commutaObiettivo(g);
      onStato(stato);
    } catch (err) {
      onAvviso?.(err.message, 'ko');
    } finally {
      setInCorso(false);
    }
  }

  return (
    <button
      className={`stella${angolo ? ' angolo' : ''}${g.target ? ' attiva' : ''}${pop ? ' pop' : ''}`}
      onClick={commuta}
      title={g.target ? 'togli dagli obiettivi' : 'segna come obiettivo'}
      aria-pressed={!!g.target}
      aria-label={`obiettivo: ${g.nome}`}
    >
      {g.target ? '★' : '☆'}
    </button>
  );
}
