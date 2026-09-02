import { useEffect, useState } from 'react';
import { getConfig, getStato } from './api.js';
import Setup from './Setup.jsx';
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
  const [modifica, setModifica] = useState(false);

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
        <p>Carico...</p>
      </main>
    );

  if (!config.configurata || modifica)
    return (
      <Setup
        iniziale={config.config}
        onSalvata={(c) => {
          setConfig(c);
          setModifica(false);
          ricarica();
        }}
        onAnnulla={config.configurata ? () => setModifica(false) : null}
      />
    );

  const vai = (p) => {
    window.location.hash = `#/${p}`;
    setPagina(p);
  };

  return (
    <>
      <nav className="barra">
        <strong className="marchio">Asta {config.config.miaSquadra}</strong>
        <button className={pagina === 'analisi' ? 'tab attiva' : 'tab'} onClick={() => vai('analisi')}>
          Analisi
        </button>
        <button className={pagina === 'asta' ? 'tab attiva' : 'tab'} onClick={() => vai('asta')}>
          Asta
        </button>
        <span className="spazio" />
        <span className="muted">
          {stato.rosa.presi.length}/{Object.values(stato.rosa.slot).reduce((a, b) => a + b, 0)} slot &middot;{' '}
          {stato.rosa.residuo} crediti
        </span>
        {!config.bloccata && (
          <button className="tab" onClick={() => setModifica(true)}>
            Configurazione
          </button>
        )}
      </nav>
      {pagina === 'asta' ? (
        <Asta stato={stato} onStato={setStato} />
      ) : (
        <Analisi stato={stato} onStato={setStato} onRicarica={ricarica} />
      )}
    </>
  );
}
