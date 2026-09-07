import { useEffect, useState } from 'react';
import { getConsumo } from './api.js';
import { costo, ETICHETTE_TIPO, somma, token } from './consumo.js';

/** Quanto e' costato chiedere a Claude, in tutto.
 *
 *  Sta nella sezione Dati accanto a chi la spesa la produce: il pulsante
 *  "Aggiorna tutto" e, attraverso l'asta, il consulente. Un conto che si vede
 *  solo a fattura arrivata non serve a decidere se premere di nuovo. */
export default function Consumo({ ricarica }) {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);

  useEffect(() => {
    let vivo = true;
    getConsumo()
      .then((d) => vivo && setDati(d))
      .catch((e) => vivo && setErrore(e.message));
    return () => {
      vivo = false;
    };
  }, [ricarica]);

  if (errore) return null;
  if (!dati) return null;

  const totale = somma(dati.perTipo);

  return (
    <div className="blocco-dati">
      <h3>Speso con Claude</h3>
      <p className="muted">
        Una riga per chiamata, con i token che l'API ha davvero contato. Le tariffe sono annotate a mano nel codice,
        aggiornate al {new Date(dati.tariffeAggiornateAl).toLocaleDateString('it-IT')}:{' '}
        {dati.tariffe.map((t) => `${t.modello} $${t.input}/$${t.output} per milione`).join(', ')}.
      </p>

      {totale.chiamate === 0 ? (
        <p className="muted">Nessuna chiamata ancora.</p>
      ) : (
        <table className="tabella-listone consumo-tab">
          <thead>
            <tr>
              <th>Tipo</th>
              <th className="num">Chiamate</th>
              <th className="num">Token in</th>
              <th className="num">Token out</th>
              <th className="num">Costo</th>
            </tr>
          </thead>
          <tbody>
            {dati.perTipo.map((r) => (
              <tr key={r.tipo} className={r.chiamate === 0 ? 'uscito' : ''}>
                <td>{ETICHETTE_TIPO[r.tipo] ?? r.tipo}</td>
                <td className="num">{r.chiamate}</td>
                <td className="num">{token(r.input)}</td>
                <td className="num">{token(r.output)}</td>
                <td className="num">{costo(r)}</td>
              </tr>
            ))}
            <tr className="consumo-totale">
              <td>
                <strong>Totale</strong>
              </td>
              <td className="num">
                <strong>{totale.chiamate}</strong>
              </td>
              <td className="num">{token(totale.input)}</td>
              <td className="num">{token(totale.output)}</td>
              <td className="num">
                <strong>{costo(totale)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* Un modello fuori tariffario non fa sparire i token: fa sparire il suo
          costo, e va detto invece di lasciar credere che sia stato gratis. */}
      {totale.senzaCosto > 0 && (
        <p className="avviso">
          {totale.senzaCosto} chiamate hanno un modello che non era nel tariffario: i token ci sono, il costo no. Il
          totale qui sopra e' quindi una sottostima.
        </p>
      )}
    </div>
  );
}
