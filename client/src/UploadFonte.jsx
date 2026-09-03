import { useState } from 'react';

/** Il blocco di caricamento di una fonte a piu' file (statistiche, xG).
 *
 *  La meccanica e' la stessa dell'upload del listone - scegli, carica, leggi
 *  l'esito - e ripeterla due volte con due copie sarebbe stato due posti dove
 *  sbagliare. Cambia solo cosa si accetta e come si racconta il risultato,
 *  che ogni fonte passa come funzione. */
export default function UploadFonte({ titolo, descrizione, accept, attesi, invia, risultato, onImportato }) {
  const [file, setFile] = useState([]);
  const [carico, setCarico] = useState(false);
  const [esito, setEsito] = useState(null);
  const [errore, setErrore] = useState(null);

  function scegli(e) {
    setFile([...(e.target.files ?? [])]);
    setEsito(null);
    setErrore(null);
  }

  async function carica() {
    if (!file.length) return;
    setCarico(true);
    setErrore(null);
    setEsito(null);
    try {
      setEsito(await invia(file));
      onImportato?.();
    } catch (err) {
      setErrore(err.message);
    } finally {
      setCarico(false);
    }
  }

  return (
    <div className="blocco-dati">
      <h3>{titolo}</h3>
      <p className="muted">{descrizione}</p>

      <div className="riga">
        <label>
          {attesi}
          {/* multiple: le due stagioni si caricano insieme, in una richiesta sola */}
          <input type="file" accept={accept} multiple onChange={scegli} disabled={carico} />
        </label>
        <button type="button" onClick={carica} disabled={!file.length || carico}>
          {carico ? 'Importo...' : `Carica e importa${file.length > 1 ? ` (${file.length} file)` : ''}`}
        </button>
      </div>

      {file.length > 0 && !esito && !errore && (
        <p className="muted">selezionati: {file.map((f) => f.name).join(', ')}</p>
      )}
      {errore && <p className="err">{errore}</p>}
      {esito && <div className="esito">{risultato(esito)}</div>}
    </div>
  );
}
