import { BadgeGiocatore } from './Badge.jsx';
import { alternative, etichetta, ETICHETTE_STATO } from './alternative.js';
import { scriviPercentuale } from './ballottaggi.js';
import { PannelloBallottaggi } from './Ballottaggi.jsx';
import Gerarchie from './Gerarchie.jsx';
import { perGiocatore as gerarchieDi } from './gerarchie.js';

/** La colonna di destra del pannello centrale.
 *
 *  Con un lotto aperto mostra gli altri dello stesso ruolo e della stessa
 *  squadra del giocatore che si sta battendo: serve a sapere, prima di
 *  rilanciare, se dietro c'e' un'alternativa a due crediti.
 *  Senza lotto aperto resta quello che c'era: i ballottaggi dichiarati dei
 *  giocatori gia' in rosa.
 *
 *  Le due liste non sono la stessa cosa e non devono sembrarlo. I ballottaggi
 *  li afferma la fonte; queste alternative le deduciamo noi da squadra e ruolo,
 *  e sotto il titolo c'e' scritto. */

function Alternativa({ a, onApri }) {
  return (
    <li className={`alt-riga alt-${a.stato}`}>
      <BadgeGiocatore nome={a.g.nome} ruolo={a.g.ruolo} size={24} />
      <button className="link-nome alt-nome" onClick={() => onApri?.(a.g.id)}>
        {a.g.nome}
      </button>
      {/* Il ballottaggio dichiarato e' l'unica riga di questa lista che la
          fonte afferma: si distingue, con la stessa etichetta delle altre 23. */}
      {a.ballottaggio && (
        <span className="chip ballo-eti" title="in ballottaggio con il giocatore aperto">
          in ballottaggio
        </span>
      )}
      <span className="spazio" />
      <span className="alt-perc" title="titolarita' stimata">
        {scriviPercentuale(a.percentuale)}
      </span>
      <span className="alt-qt" title="quotazione">
        {a.g.quotazione}
      </span>
      <span className={`chip alt-stato ${a.stato}`}>{ETICHETTE_STATO[a.stato]}</span>
    </li>
  );
}

/** Le alternative del giocatore aperto nel lotto. */
export function PannelloAlternative({ stato, g, onApri }) {
  const righe = alternative(stato.giocatori, g, stato.rosa.presi, stato.ballottaggi);
  if (!righe.length) return null;
  return (
    <div className="pannello alt-pannello">
      <h3 className="ballo-titolo">{etichetta(g)}</h3>
      <p className="alt-avvertenza">dedotto da squadra e ruolo, non dichiarato dalla fonte</p>
      <ul className="alt-lista">
        {righe.map((a) => (
          <Alternativa key={a.g.id} a={a} onApri={onApri} />
        ))}
      </ul>
    </div>
  );
}

/** Quante righe avrebbe la colonna destra: serve alla pagina per decidere se
 *  disegnarla o allargare il lotto a tutta larghezza. Chiederlo al componente
 *  a cose fatte avrebbe voluto dire misurare il DOM. */
export const colonnaDestraPiena = (stato, lotto) =>
  lotto
    ? alternative(stato.giocatori, lotto, stato.rosa.presi, stato.ballottaggi).length > 0 ||
      gerarchieDi(stato.gerarchie, lotto.id).length > 0
    : true;

export function ColonnaDestra({ stato, lotto, onApri }) {
  if (!lotto) return <PannelloBallottaggi stato={stato} onApri={onApri} />;
  // Prima quello che una fonte dichiara, poi quello che deduciamo noi: se le
  // due cose fossero mescolate non si distinguerebbe piu chi lo ha scritto da
  // chi lo ha calcolato.
  return (
    <div className="colonna-destra">
      <Gerarchie stato={stato} g={lotto} onApri={onApri} />
      <PannelloAlternative stato={stato} g={lotto} onApri={onApri} />
    </div>
  );
}
