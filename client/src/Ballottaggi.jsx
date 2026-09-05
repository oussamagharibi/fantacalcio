import { BadgeGiocatore } from './Badge.jsx';
import { RUOLI } from './squadre.js';
import { perGiocatore, perRosa, scriviPercentuale, sommaStrana } from './ballottaggi.js';

/** I ballottaggi delle probabili formazioni.
 *
 *  "In ballottaggio con", non "si contendono lo stesso posto": in 6 casi su 23
 *  i due hanno ruoli diversi (Berardi attaccante contro Volpato centrocampista)
 *  perche' la scelta e' di modulo, non di maglia. Scrivere che si giocano lo
 *  stesso posto sarebbe falso un quarto delle volte.
 *
 *  Nessuna posizione in campo: nei dati non c'e'. Il sito disegna una
 *  formazione, ma non dice chi e' il terzino destro e chi il centrale, e
 *  dedurlo dall'ordine dei nomi sarebbe indovinare. */

function Riga({ b, onApri }) {
  const strana = sommaStrana(b);
  return (
    <li className="ballo-riga">
      <div className="ballo-coppia">
        <span className="ballo-lato">
          <BadgeGiocatore nome={b.io.nome} ruolo={b.io.ruolo} size={24} />
          <strong>{b.io.nome}</strong>
          <span className="ballo-perc">{scriviPercentuale(b.io.percentuale)}</span>
        </span>

        <span className="ballo-fra" title="in ballottaggio con">
          ⟷
        </span>

        <span className="ballo-lato">
          <BadgeGiocatore nome={b.altro.nome} ruolo={b.altro.ruolo} size={24} />
          {/* Il rivale e' cliccabile: da qui si va a vedere chi e'. */}
          <button className="link-nome" onClick={() => onApri?.(b.altro.id)}>
            {b.altro.nome}
          </button>
          <span
            className="chip"
            style={{ borderColor: RUOLI[b.altro.ruolo]?.colore, color: RUOLI[b.altro.ruolo]?.colore }}
          >
            {b.altro.ruolo}
          </span>
          <span className="ballo-perc">{scriviPercentuale(b.altro.percentuale)}</span>
        </span>
      </div>

      {b.nota && <p className="ballo-nota">{b.nota}</p>}

      {/* Le due percentuali vengono da due righe diverse della lista titolari:
          non sono due fette di una torta, e non devono fare 100. Detto qui,
          perche' altrimenti sembra un errore di conto. */}
      {strana && (
        <p className="ballo-spiega">
          Le due percentuali sono quelle che il sito da' a ciascuno nella lista titolari: sono indipendenti, non due
          parti di cento.
        </p>
      )}
    </li>
  );
}

/** Il pannello della pagina Asta: solo i ballottaggi che toccano la mia rosa. */
export function PannelloBallottaggi({ stato, onApri }) {
  const righe = perRosa(stato.ballottaggi, stato.rosa.presi);
  return (
    <div className="pannello ballo-pannello">
      <h3 className="ballo-titolo">Ballottaggi della mia rosa</h3>
      {righe.length === 0 ? (
        <p className="muted">
          {(stato.ballottaggi?.length ?? 0) === 0
            ? "Nessun ballottaggio in archivio: lancia “Aggiorna tutto” dalla sezione Dati della pagina Analisi."
            : `Nessuno dei giocatori in rosa e' in ballottaggio. In archivio ce ne sono ${stato.ballottaggi.length}, ma riguardano altri.`}
        </p>
      ) : (
        <ul className="ballo-lista">
          {righe.map((b) => (
            <Riga key={`${b.io.id}-${b.altro.id}`} b={b} onApri={onApri} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** La sezione nella scheda giocatore: i suoi ballottaggi, se ne ha. */
export function BallottaggiGiocatore({ stato, giocatore, onApri }) {
  const righe = perGiocatore(stato.ballottaggi, giocatore.id);
  if (!righe.length) return null;
  return (
    <ul className="ballo-lista">
      {righe.map((b) => (
        <Riga key={`${b.io.id}-${b.altro.id}`} b={b} onApri={onApri} />
      ))}
    </ul>
  );
}
