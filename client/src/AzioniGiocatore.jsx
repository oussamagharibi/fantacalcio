import { useState } from 'react';
import { eseguiAzione, statoGiocatore } from './azioni.js';

/** Le azioni dell'asta su un giocatore, ovunque compaia: card in Analisi, riga
 *  in Listone, riga in Situazione, scheda del giocatore. Nessuna logica
 *  propria: chiama eseguiAzione() e rimette in circolo lo stato che torna.
 *
 *  Tre forme, secondo lo stato del giocatore:
 *    disponibile -> "Preso da me" (apre il prezzo in linea) e "Uscito"
 *    mio         -> il prezzo pagato e la X per disfare
 *    uscito      -> "torna disponibile"
 *
 *  L'apertura (campo prezzo, conferma) di norma vive qui dentro, una copia per
 *  istanza: e' interfaccia, non un dato dell'asta. Chi ha bisogno di aprirla
 *  da fuori - Situazione, quando si rilascia una riga trascinata sulla zona
 *  "La mia squadra" - passa apertura e onApertura e se la governa. */
export default function AzioniGiocatore({
  g,
  stato,
  onStato,
  onAvviso,
  mostraPrezzo = true,
  compatto = false,
  apertura: aperturaEsterna,
  onApertura,
}) {
  const [aperturaLocale, setAperturaLocale] = useState(null);
  const [prezzo, setPrezzo] = useState('');
  const [inCorso, setInCorso] = useState(false);

  const governata = typeof onApertura === 'function';
  const apertura = governata ? aperturaEsterna ?? null : aperturaLocale;
  const setApertura = governata ? onApertura : setAperturaLocale;

  const { stato: qualEe, prezzo: pagato } = statoGiocatore(g, stato.rosa.presi);
  const massimo = stato.rosa.massimoSostenibile;
  const configurata = !!stato.rosa.squadra;
  const chiudi = () => {
    setApertura(null);
    setPrezzo('');
  };

  async function azione(tipo) {
    if (inCorso) return;
    setInCorso(true);
    try {
      const { stato: nuovo, messaggio } = await eseguiAzione({ tipo, g, prezzo });
      onStato(nuovo);
      onAvviso(messaggio);
      chiudi();
    } catch (e) {
      onAvviso(e.message, 'ko');
    } finally {
      setInCorso(false);
    }
  }

  const classe = `az-gruppo${compatto ? ' compatto' : ''}`;

  if (apertura === 'annulla')
    return (
      <div className={classe}>
        <span className="muted">rimettere in lista?</span>
        <button className="az ko" disabled={inCorso} onClick={() => azione('annulla')}>
          sì
        </button>
        <button className="az" onClick={chiudi}>
          no
        </button>
      </div>
    );

  if (qualEe === 'disponibile') {
    if (apertura === 'prezzo') {
      const n = Number(prezzo);
      const oltre = prezzo !== '' && Number.isFinite(n) && n > massimo;
      return (
        <div className="az-prezzo">
          <input
            type="number"
            min="0"
            value={prezzo}
            autoFocus
            placeholder="prezzo"
            onChange={(e) => setPrezzo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') azione('acquisto');
              if (e.key === 'Escape') chiudi();
            }}
          />
          <button className="az ok" disabled={inCorso} onClick={() => azione('acquisto')} title="conferma (Invio)">
            ✓
          </button>
          <button className="az" onClick={chiudi} title="annulla (Esc)">
            ✕
          </button>
          {/* Avviso, non blocco: il prezzo lo decide l'asta, non l'applicazione. */}
          {oltre && <span className="az-avviso">oltre il massimo sostenibile ({massimo})</span>}
        </div>
      );
    }
    return (
      <div className={classe}>
        <button
          className="az"
          disabled={!configurata || inCorso}
          title={configurata ? 'registra il prezzo e mettilo in rosa' : "prima prepara l'asta nella pagina Asta"}
          onClick={() => {
            setPrezzo('');
            setApertura('prezzo');
          }}
        >
          Preso da me
        </button>
        <button className="az" disabled={inCorso} title="preso da un altro partecipante" onClick={() => azione('uscita')}>
          Uscito
        </button>
      </div>
    );
  }

  /** Preso da me: il prezzo pagato e la X per disfare. In Situazione il prezzo
   *  ha gia' una colonna sua, quindi li' non si ripete. */
  if (qualEe === 'me')
    return (
      <div className={classe}>
        {mostraPrezzo && (
          <span className="az-pagato">
            preso a <strong>{pagato}</strong>
          </span>
        )}
        <button className="az x" title="annulla l'acquisto e rimetti in lista" onClick={() => setApertura('annulla')}>
          ✕
        </button>
      </div>
    );

  return (
    <div className={classe}>
      {compatto ? (
        <button className="az x" title="annulla l'uscita e rimetti in lista" onClick={() => setApertura('annulla')}>
          ✕
        </button>
      ) : (
        <button className="az" title="annulla l'uscita" onClick={() => setApertura('annulla')}>
          torna disponibile
        </button>
      )}
    </div>
  );
}
