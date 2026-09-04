import Xg from './Xg.jsx';
import { golSubiti } from './giocatore.js';

/** Il blocco di rendimento sotto i numeri di una card. Stesso posto nel layout,
 *  contenuto diverso per ruolo: gol contro expected goals per chi attacca,
 *  gol subiti a partita per chi para.
 *
 *  La scelta sta qui e non nelle pagine, cosi' non si puo' dimenticare un punto
 *  di chiamata. Xg resta com'era: per D, C e A non cambia niente. */

/** Sotto questa media un portiere tiene bene; sopra l'altra, la difesa davanti
 *  a lui fa acqua. Sono soglie scelte, non calcolate, e valgono per la Serie A:
 *  circa un gol a partita e' la media di squadra di meta' classifica. */
const BENE = 1.0;
const MALE = 1.6;

export const classeMedia = (m) => (m === null || m === undefined ? '' : m < BENE ? 'occasione' : m >= MALE ? 'calo' : '');

function GolSubiti({ dati, compatto }) {
  if (!dati) return null;
  const ultima = dati.stagioni.at(-1);
  const classe = classeMedia(dati.media);
  return (
    <div className={`xg${compatto ? ' compatto' : ''}`}>
      <div className="xg-riga">
        <span className="xg-st">{dati.stagioni.length > 1 ? `${dati.stagioni.length} stagioni` : ultima.stagione}</span>
        <span className="xg-cifre">
          <strong>{dati.gs}</strong> gol subiti <span className="muted">in</span> <strong>{dati.pv}</strong> partite
        </span>
        <span className={`xg-scarto ${classe}`} title="gol subiti per partita giocata">
          {dati.media}
        </span>
      </div>
      {!compatto && (
        <div className="xg-dett muted">
          {dati.stagioni.map((s) => `${s.stagione}: ${s.gs} in ${s.pv} (${s.media})`).join(' · ')}
        </div>
      )}
      <div className="xg-fonte">
        gol subiti a partita, dagli Excel di fantacalcio.it
        {classe === 'occasione' && <span className="xg-nota occasione"> · prende poco</span>}
        {classe === 'calo' && <span className="xg-nota calo"> · difesa che concede</span>}
      </div>
    </div>
  );
}

export default function Rendimento({ g, compatto = false }) {
  if (g?.ruolo === 'P') return <GolSubiti dati={golSubiti(g)} compatto={compatto} />;
  return <Xg dati={g?.xg} compatto={compatto} />;
}
