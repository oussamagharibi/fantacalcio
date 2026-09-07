import { useState } from 'react';
import { postConsulente } from './api.js';
import { costruisciContesto } from './consulente.js';

/** Il consulente d'asta: un pulsante, e la risposta resta li'.
 *
 *  Parte SOLO se lo si preme. Nessuna chiamata quando si apre un lotto: la
 *  risposta ci mette qualche secondo e durante i rilanci quei secondi non ci
 *  sono. Il costo di quella scelta e' che il consiglio arriva quando lo si
 *  chiede, non prima - ed e' il costo giusto.
 *
 *  La risposta rimane a schermo finche' non se ne chiede un'altra: in asta si
 *  guarda, si rilancia, si torna a guardare. Sparire da sola sarebbe la cosa
 *  peggiore che potrebbe fare. */
export default function Consulente({ stato, config, lotto }) {
  const [risposta, setRisposta] = useState(null);
  const [errore, setErrore] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  async function chiedi() {
    if (inCorso) return;
    setInCorso(true);
    setErrore(null);
    try {
      // Il contesto si compone qui dai dati gia' in memoria: nessuna richiesta
      // in piu' prima di quella vera.
      setRisposta(await postConsulente(costruisciContesto(stato, config, lotto)));
    } catch (e) {
      // Un errore non ferma niente: l'asta prosegue senza consulente.
      setErrore(e.message);
    } finally {
      setInCorso(false);
    }
  }

  return (
    <div className="pannello cons">
      <div className="cons-testa">
        <button className="bottone" onClick={chiedi} disabled={inCorso}>
          {inCorso ? 'Sto chiedendo…' : 'Chiedi a Claude'}
        </button>
        <span className="muted cons-nota">
          {lotto ? `valuta ${lotto.nome} e la rosa` : 'valuta la rosa e cosa manca'}
          {' · '}
          3-8 secondi
        </span>
      </div>

      {errore && (
        <p className="err cons-errore">
          Il consulente non ha risposto: {errore}. L'asta prosegue lo stesso.
        </p>
      )}

      {risposta && (
        <>
          <div className="cons-risposta">{risposta.testo}</div>
          <p className="cons-conto muted">
            {risposta.uso.input.toLocaleString('it-IT')} token in, {risposta.uso.output.toLocaleString('it-IT')} out ·
            ${risposta.costo.toFixed(4)}
            {risposta.troncata && <span className="avviso"> · risposta tagliata dal limite di lunghezza</span>}
          </p>
        </>
      )}
    </div>
  );
}
