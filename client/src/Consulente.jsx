import { useEffect, useRef, useState } from 'react';
import { postConsulente } from './api.js';
import { costruisciContesto } from './consulente.js';

/** Il consulente d'asta: un pulsante, e la risposta resta li'.
 *
 *  Parte SOLO se lo si preme. Nessuna chiamata quando si apre un lotto: la
 *  risposta ci mette qualche secondo e durante i rilanci quei secondi non ci
 *  sono. La risposta rimane a schermo finche' non se ne chiede un'altra: in
 *  asta si guarda, si rilancia, si torna a guardare. */

/** Il motivo, in una parola. Il resto della frase lo scrive gia il server, e
 *  ripeterlo qui produceva "errore dalla parte di Anthropic (errore dalla
 *  parte di Anthropic)": due volte la stessa cosa fra parentesi. */
const ETICHETTE_MOTIVO = {
  chiave: 'chiave API',
  timeout: 'timeout',
  rete: 'rete',
  autorizzazione: 'permessi',
  limite: 'limite di richieste',
  richiesta: 'richiesta',
  server: 'servizio Anthropic',
  malformata: 'risposta malformata',
};

/** Il contatore dei secondi: un pulsante spento e basta sembra bloccato, e
 *  dopo dieci secondi di niente si e' tentati di ricaricare la pagina proprio
 *  mentre la risposta sta arrivando. */
function Attesa({ da }) {
  const [ora, setOra] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setOra(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="cons-attesa">
      <span className="cons-punti" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      Sto pensando… {((ora - da) / 1000).toFixed(1)}s
    </p>
  );
}

export default function Consulente({ stato, config, lotto }) {
  const [risposta, setRisposta] = useState(null);
  const [errore, setErrore] = useState(null);
  const [da, setDa] = useState(null);
  const inCorso = da !== null;
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  async function chiedi() {
    if (inCorso) return;
    setDa(Date.now());
    setErrore(null);
    const partito = Date.now();
    try {
      // Il contesto si compone qui dai dati gia' in memoria: nessuna richiesta
      // in piu' prima di quella vera.
      const r = await postConsulente(costruisciContesto(stato, config, lotto));
      if (vivo.current) setRisposta({ ...r, secondi: (Date.now() - partito) / 1000 });
    } catch (e) {
      // Un errore non ferma niente: l'asta prosegue senza consulente.
      if (vivo.current)
        setErrore({ testo: e.message, motivo: e.motivo, secondi: (Date.now() - partito) / 1000 });
    } finally {
      if (vivo.current) setDa(null);
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
        </span>
      </div>

      {inCorso && <Attesa da={da} />}

      {errore && !inCorso && (
        <p className="err cons-errore">
          Il consulente non ha risposto dopo {errore.secondi.toFixed(1)}s
          {ETICHETTE_MOTIVO[errore.motivo] ? ` — ${ETICHETTE_MOTIVO[errore.motivo]}` : ''}: {errore.testo}. L'asta
          prosegue lo stesso.
        </p>
      )}

      {risposta && !inCorso && (
        <>
          <div className="cons-risposta">{risposta.testo}</div>
          <p className="cons-conto muted">
            {risposta.secondi.toFixed(1)}s · {risposta.uso.input.toLocaleString('it-IT')} token in,{' '}
            {risposta.uso.output.toLocaleString('it-IT')} out · ${risposta.costo.toFixed(4)}
            {risposta.troncata && <span className="avviso"> · risposta tagliata dal limite di lunghezza</span>}
          </p>
        </>
      )}
    </div>
  );
}
