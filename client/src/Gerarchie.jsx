import { BadgeGiocatore } from './Badge.jsx';
import { perGiocatore, frase, ETICHETTE_CERTEZZA } from './gerarchie.js';

/** "Vice dichiarato": le coppie titolare/vice che una fonte afferma.
 *
 *  Sta sopra le alternative dedotte da squadra e ruolo perche' vale di piu':
 *  qui qualcuno ha scritto chi sta dietro a chi. Ma vale di piu' solo se si
 *  vede da dove viene e quanto e' sicuro, quindi fonte, data e livello di
 *  certezza stanno su ogni riga, non in una nota a fondo pannello. */

const quando = (d) => (d ? new Date(d).toLocaleDateString('it-IT') : null);

export default function Gerarchie({ stato, g, onApri }) {
  const righe = perGiocatore(stato.gerarchie, g?.id);
  if (!righe.length) return null;
  return (
    <div className="pannello ger-pannello">
      <h3 className="ballo-titolo">Vice dichiarato</h3>
      <ul className="ger-lista">
        {righe.map((r) => (
          <li key={`${r.titolare.id}-${r.alternativa.id}-${r.fonte}`} className={`ger-riga cert-${r.certezza}`}>
            <div className="ger-coppia">
              <span className="muted">{frase(r)}</span>
              <BadgeGiocatore nome={r.altro.nome} ruolo={r.altro.ruolo} size={22} />
              <button className="link-nome" onClick={() => onApri?.(r.altro.id)}>
                {r.altro.nome}
              </button>
              {r.posizione && <span className="ger-posizione">{r.posizione}</span>}
            </div>
            {/* Provenienza e certezza sempre, su ogni riga: e' l'unica cosa che
                distingue "lo dice il testo" da "lo abbiamo dedotto". */}
            <div className="ger-provenienza">
              <span className={`chip ger-cert ${r.certezza}`}>{ETICHETTE_CERTEZZA[r.certezza] ?? r.certezza}</span>
              {r.fonte}
              {quando(r.data) && ` · ${quando(r.data)}`}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
