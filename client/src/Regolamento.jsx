import { sezioniRegolamento } from './regolamento.js';

/** Il regolamento della lega, per esteso. Non un riassunto: quando si discute
 *  di una regola serve la frase, non la sintesi.
 *
 *  I valori che l'applicazione conosce davvero - budget e composizione della
 *  rosa - arrivano dalla configurazione e sono marcati come tali, cosi' si
 *  vede a colpo d'occhio che quel numero e' lo stesso che l'asta sta usando
 *  per contare gli slot. */

function Voci({ voci }) {
  return (
    <dl className="reg-voci">
      {voci.map(([etichetta, valore, fonte]) => (
        <div key={etichetta}>
          <dt>{etichetta}</dt>
          <dd>
            {valore === null ? (
              <span className="muted">non configurato</span>
            ) : (
              <>
                {valore}
                {fonte === 'config' && <span className="reg-fonte">dalla configurazione</span>}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Tabella({ tabella }) {
  return (
    <table className="det-tab reg-tab">
      <thead>
        <tr>
          {tabella.intestazione.map((c, i) => (
            <th key={i} className={i ? 'num' : ''}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tabella.righe.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={j ? 'num' : ''}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Regolamento({ stato }) {
  const sezioni = sezioniRegolamento({ rosa: stato.rosa });

  return (
    <main className="wrap largo regolamento">
      <header className="reg-testa">
        <h2>Regolamento</h2>
        <p className="muted">
          Fanta Nexi &middot; stagione 2026/27. Le sezioni sono quelle del documento della lega. Composizione della
          rosa e crediti arrivano dalla configurazione dell'asta: cambiandola, qui cambiano di conseguenza.
        </p>
      </header>

      {sezioni.map((s) => (
        <section className="reg-sez" key={s.n}>
          <h3>
            <span className="reg-numero">{s.n}</span>
            {s.titolo}
          </h3>
          {s.paragrafi?.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {s.voci && <Voci voci={s.voci} />}
          {s.tabella && <Tabella tabella={s.tabella} />}
          {s.elenco && (
            <ul className="reg-elenco">
              {s.elenco.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {/* Dove il documento originale aveva un buco, il buco si dichiara. */}
          {s.nota && <p className="muted reg-nota">{s.nota}</p>}
        </section>
      ))}
    </main>
  );
}
