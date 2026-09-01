import { useEffect, useState } from 'react';
import { getConfig } from './api.js';
import Setup from './Setup.jsx';
import UploadListone from './UploadListone.jsx';

export default function App() {
  const [stato, setStato] = useState(null);
  const [errore, setErrore] = useState(null);
  const [modifica, setModifica] = useState(false);

  const ricarica = () =>
    getConfig()
      .then(setStato)
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
          <dt>Listone</dt>
          <dd>
            {stato.giocatori.totale === 0 ? (
              <span className="avviso">Listone non caricato</span>
            ) : (
              <>
                {stato.giocatori.totale} giocatori ({stato.giocatori.perRuolo.P}P {stato.giocatori.perRuolo.D}D{' '}
                {stato.giocatori.perRuolo.C}C {stato.giocatori.perRuolo.A}A)
              </>
            )}
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

      {/* Fuori dal ramo bloccata/non bloccata: il listone si carica sempre, anche
          a config bloccata, altrimenti a meta' asta non sarebbe piu' aggiornabile.
          onImportato ricarica lo stato: il conteggio qui sopra sta a due righe di
          distanza, lasciarlo fermo su "non caricato" sembrerebbe un errore. */}
      <UploadListone onImportato={ricarica} />
    </main>
  );
}
