/** Gol contro expected goals dell'ultima stagione disponibile.
 *
 *  Va detto ogni volta che cosa sono: xG e' quanto valevano le occasioni avute,
 *  misurato su calcio vero. Non e' un voto, non e' una fantamedia. Chi legge
 *  "3 gol / 5.4 xG" senza l'etichetta pensa a un punteggio del fantacalcio. */

/** Sopra questo scarto il rendimento e' abbastanza sopra le occasioni da
 *  aspettarsi un ritorno verso il basso. Sotto lo zero il segnale e' opposto e
 *  vale subito: chi si costruisce occasioni e non segna, di solito poi segna. */
const MOLTO_SOPRA = 2;

export function classeScarto(scarto) {
  if (scarto === null || scarto === undefined) return '';
  if (scarto < 0) return 'occasione';
  if (scarto >= MOLTO_SOPRA) return 'calo';
  return '';
}

const numero = (n, d = 1) => (n === null || n === undefined ? '-' : Number(n).toFixed(d));

export default function Xg({ dati, compatto = false }) {
  if (!dati) return null;
  const s = dati.scarto_xg;
  const classe = classeScarto(s);
  const segno = s === null || s === undefined ? '' : s > 0 ? '+' : '';

  return (
    <div className={`xg${compatto ? ' compatto' : ''}`}>
      <div className="xg-riga">
        <span className="xg-st">{dati.stagione}</span>
        <span className="xg-cifre">
          <strong>{dati.gol ?? '-'}</strong> gol <span className="muted">vs</span>{' '}
          <strong>{numero(dati.xg)}</strong> xG
        </span>
        {s !== null && s !== undefined && (
          <span className={`xg-scarto ${classe}`} title="gol meno expected goals">
            {segno}
            {numero(s)}
          </span>
        )}
      </div>
      {!compatto && (
        <div className="xg-dett muted">
          {dati.partite ?? '-'} partite · {dati.minuti ?? '-'}&#39; · {dati.assist ?? '-'} assist vs {numero(dati.xa)} xA
          {dati.npg !== null && dati.npg !== undefined && (
            <>
              {' '}
              · su azione {dati.npg} vs {numero(dati.npxg)} npxG
            </>
          )}
        </div>
      )}
      <div className="xg-fonte">
        dati Understat, non fanta
        {classe === 'occasione' && <span className="xg-nota occasione"> · segna meno di quanto si crea</span>}
        {classe === 'calo' && <span className="xg-nota calo"> · rende sopra le occasioni, atteso in calo</span>}
      </div>
    </div>
  );
}
