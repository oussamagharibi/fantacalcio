import { useEffect, useState } from 'react';
import { getConfig, getStato } from './api.js';
import Analisi from './Analisi.jsx';
import Asta from './Asta.jsx';

/** Routing sull'hash invece di una libreria: due pagine non giustificano una
 *  dipendenza, e l'hash sopravvive al refresh senza toccare il server. */
const paginaDaHash = () => (window.location.hash.replace('#/', '') === 'asta' ? 'asta' : 'analisi');

export default function App() {
  const [config, setConfig] = useState(null);
  const [stato, setStato] = useState(null);
  const [errore, setErrore] = useState(null);
  const [pagina, setPagina] = useState(paginaDaHash);

  useEffect(() => {
    const cambio = () => setPagina(paginaDaHash());
    window.addEventListener('hashchange', cambio);
    return () => window.removeEventListener('hashchange', cambio);
  }, []);

  const ricarica = () =>
    Promise.all([getConfig(), getStato()])
      .then(([c, s]) => {
        setConfig(c);
        setStato(s);
      })
      .catch((e) => setErrore(e.message));

  useEffect(() => {
    ricarica();
  }, []);

  if (errore)
    return (
      <main className="wrap">
        <p className="err">Server non raggiungibile: {errore}</p>
      </main>
    );
  if (!config || !stato)
    return (
      <main className="wrap">
        <p className="muted">Carico…</p>
      </main>
    );

  const vai = (p) => {
    window.location.hash = `#/${p}`;
    setPagina(p);
  };
  const slotTotali = Object.values(stato.rosa.slot).reduce((a, b) => a + b, 0);

  return (
    <>
      <nav className="barra">
        {/* Senza configurazione non c'e' una "mia squadra" da mostrare: la
            pagina Analisi si usa lo stesso, quindi la barra non deve dipenderne. */}
        <span className="marchio">{config.configurata ? config.config.miaSquadra : 'Asta Fantacalcio'}</span>
        <button className={pagina === 'analisi' ? 'tab attiva' : 'tab'} onClick={() => vai('analisi')}>
          Analisi
        </button>
        <button className={pagina === 'asta' ? 'tab attiva' : 'tab'} onClick={() => vai('asta')}>
          Asta
        </button>
        <span className="spazio" />
        {config.configurata ? (
          <span className="stato-barra">
            <span>
              rosa <strong>{stato.rosa.presi.length}</strong>/{slotTotali}
            </span>
            <span>
              crediti <strong>{stato.rosa.residuo}</strong>
            </span>
            <span>
              max <strong>{stato.rosa.massimoSostenibile}</strong>
            </span>
          </span>
        ) : (
          <span className="stato-barra muted">asta non ancora configurata</span>
        )}
      </nav>
      {pagina === 'asta' ? (
        <Asta stato={stato} onStato={setStato} config={config} onRicarica={ricarica} />
      ) : (
        <Analisi stato={stato} onStato={setStato} onRicarica={ricarica} />
      )}
    </>
  );
}
