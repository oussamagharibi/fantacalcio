import { useState } from 'react';
import { uploadListone } from './api.js';

const RUOLI = [
  ['P', 'Portieri'],
  ['D', 'Difensori'],
  ['C', 'Centrocampisti'],
  ['A', 'Attaccanti'],
];

/** Caricamento del listone. Sta sia nel setup sia nella schermata principale:
 *  serve prima dell'asta ma anche dopo, e a config bloccata il setup non e'
 *  piu' raggiungibile. Aggiornare il listone non tocca gli acquisti, quindi
 *  non c'e' motivo di bloccarlo insieme alla configurazione. */
export default function UploadListone({ onImportato }) {
  const [file, setFile] = useState(null);
  const [carico, setCarico] = useState(false);
  const [esito, setEsito] = useState(null);
  const [errore, setErrore] = useState(null);

  function scegli(e) {
    setFile(e.target.files?.[0] ?? null);
    setEsito(null);
    setErrore(null);
  }

  async function carica() {
    if (!file) return;
    setCarico(true);
    setErrore(null);
    setEsito(null);
    try {
      setEsito(await uploadListone(file));
      onImportato?.();
    } catch (err) {
      setErrore(err.message);
    } finally {
      setCarico(false);
    }
  }

  return (
    <section className="listone">
      <h2>Listone giocatori</h2>
      <p className="muted">
        Scarica il listone Classic da fantacalcio.it (Quotazioni &rarr; Excel) e caricalo qui. Il download automatico
        dal server non e' affidabile: fantacalcio.it risponde 401 alle richieste che partono da un datacenter.
      </p>

      <div className="riga">
        <label>
          File .xlsx
          <input type="file" accept=".xlsx" onChange={scegli} disabled={carico} />
        </label>
        <button type="button" onClick={carica} disabled={!file || carico}>
          {carico ? 'Importo...' : 'Carica e importa'}
        </button>
      </div>

      {errore && <p className="err">{errore}</p>}

      {esito && (
        <div className="esito">
          <p>
            <strong>{esito.totale} giocatori in archivio</strong> da {esito.nomeFile}
          </p>
          <p className="muted">
            {esito.righeLette} righe lette &middot; {esito.inserite} inserite &middot; {esito.aggiornate} aggiornate
            &middot; {esito.scartate} scartate
          </p>
          <ul className="squadre">
            {RUOLI.map(([k, etichetta]) => (
              <li key={k}>
                {etichetta}: <strong>{esito.perRuolo?.[k] ?? 0}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
