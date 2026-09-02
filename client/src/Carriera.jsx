/** Storico di carriera da Wikipedia. Va detto ogni volta che cos'e': presenze
 *  e gol REALI, di calcio. Non media voto, non fantamedia - quelle non stanno
 *  su Wikipedia e arrivano solo dagli Excel di fantacalcio.it. */
export default function Carriera({ righe, ruolo }) {
  if (!righe?.length) return null;
  const portiere = ruolo === 'P';
  const fonte = righe[0].fonte ?? 'it.wikipedia.org';
  return (
    <div className="carriera">
      <div className="carriera-testa">
        ultime {righe.length} stagioni
        <span className="muted"> · presenze e {portiere ? 'reti subite' : 'gol'}, dati reali non fanta</span>
      </div>
      <table className="carriera-tab">
        <tbody>
          {righe.map((r) => (
            <tr key={`${r.stagione}-${r.squadra}`}>
              <td className="st">{r.stagione}</td>
              <td className="sq">{r.squadra}</td>
              <td className="n">{r.presenze}</td>
              <td className="muted">pres</td>
              {/* Su Wikipedia i portieri hanno le reti negative: sono subite. */}
              <td className="n">{portiere ? Math.abs(r.gol) : r.gol}</td>
              <td className="muted">{portiere ? 'sub' : 'gol'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="carriera-fonte">fonte: {fonte}</div>
    </div>
  );
}
