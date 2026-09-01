import { useEffect, useState } from 'react';
import { getConfig } from './api.js';
import Setup from './Setup.jsx';

export default function App() {
  const [stato, setStato] = useState(null);
  const [errore, setErrore] = useState(null);
  const [modifica, setModifica] = useState(false);

  useEffect(() => {
    getConfig()
      .then(setStato)
      .catch((e) => setErrore(e.message));
  }, []);

  if (errore)
    return (
      <main className="wrap">
        <p className="err">Server non raggiungibile: {errore}</p>
      </main>
    );

  if (!stato)
    return (
      <main className="wrap">
        <p>Carico...</p>
      </main>
    );

  if (!stato.configurata || modifica) {
    return (
      <Setup
        iniziale={stato.config}
        onSalvata={(s) => {
          setStato(s);
          setModifica(false);
        }}
        onAnnulla={stato.configurata ? () => setModifica(false) : null}
      />
    );
  }

  const c = stato.config;
  const slotTotali = c.slotP + c.slotD + c.slotC + c.slotA;

  return (
    <main className="wrap">
      <h1>Asta pronta</h1>
      <p className="muted">Placeholder: la schermata di asta arriva agli step successivi.</p>

      <dl className="riepilogo">
        <div>
          <dt>Budget</dt>
          <dd>{c.budget}</dd>
        </div>
        <div>
          <dt>Squadre</dt>
          <dd>{c.numeroSquadre}</dd>
        </div>
        <div>
          <dt>Rosa</dt>
          <dd>
            {c.slotP}P {c.slotD}D {c.slotC}C {c.slotA}A ({slotTotali} slot)
          </dd>
        </div>
        <div>
          <dt>La mia squadra</dt>
          <dd>
            <strong>{c.miaSquadra}</strong>
          </dd>
        </div>
        <div>
          <dt>Acquisti registrati</dt>
          <dd>{stato.acquisti}</dd>
        </div>
      </dl>

      <ul className="squadre">
        {c.nomiSquadre.map((n) => (
          <li key={n} className={n === c.miaSquadra ? 'mia' : ''}>
            {n}
          </li>
        ))}
      </ul>

      {stato.bloccata ? (
        <p className="lock">
          Configurazione bloccata: ci sono {stato.acquisti} acquisti. Si sblocca solo con un reset esplicito.
        </p>
      ) : (
        <button onClick={() => setModifica(true)}>Modifica configurazione</button>
      )}
    </main>
  );
}
