import { useMemo, useState } from 'react';
import { BadgeGiocatore } from './Badge.jsx';
import { REGOLE_SCAMBI } from './regolamento.js';
import { RUOLI as RUOLI_NOMI } from './squadre.js';
import { gruppi as calcolaGruppi, squilibri as calcolaSquilibri } from './gestione.js';

/** Gestione rosa: cosa tenere, cosa mettere sul mercato, cosa lasciar andare.
 *
 *  Nessun nome di giocatore da prendere in cambio: non so chi hanno gli altri,
 *  e suggerire un nome vorrebbe dire inventarmi un mercato che non vedo. Qui
 *  si dice solo chi dei miei ha senso mettere sul tavolo, e perche'.
 *
 *  Ogni gruppo porta scritto il criterio che lo ha prodotto. Un elenco di nomi
 *  senza il criterio e' un oracolo: si crede o non si crede, e non si puo'
 *  discutere. */

const GRUPPI = [
  { chiave: 'intoccabili', titolo: 'Intoccabili', classe: 'ok' },
  { chiave: 'valutare', titolo: 'Da valutare', classe: 'medio' },
  { chiave: 'sacrificabili', titolo: 'Sacrificabili', classe: 'ko' },
];

const pct = (x) => (x === null || x === undefined ? '—' : `${x}%`);

function Voce({ g, onApri }) {
  return (
    <li className="ge-voce">
      <BadgeGiocatore nome={g.nome} ruolo={g.ruolo} size={22} />
      <button className="link-nome ge-nome" onClick={() => onApri?.(g.id)}>
        {g.nome}
      </button>
      <span className="muted ge-squadra">{g.squadra}</span>
      <span className="ge-prezzo" title="prezzo pagato">
        {g.prezzo}cr
      </span>
      {/* La resa contro il prezzo, come posizione dentro la rosa: due numeri
          che non hanno la stessa unita' si confrontano solo cosi'. */}
      {g.scarto === null ? (
        <span className="ge-scarto muted" title={g.res.motivo ?? ''}>
          non confrontabile
        </span>
      ) : (
        <span className={`ge-scarto${g.scarto >= 25 ? ' su' : g.scarto <= -25 ? ' giu' : ''}`} title={`resa ${g.rangoResa}° percentile, prezzo ${g.rangoPrezzo}°`}>
          {g.scarto > 0 ? '+' : ''}
          {g.scarto}
        </span>
      )}
      <span className="ge-perche">{g.perche.join(' · ')}</span>
    </li>
  );
}

export default function Gestione({ rosa, formazione, onApri }) {
  const [aperto, setAperto] = useState(true);
  const g = useMemo(() => calcolaGruppi(rosa), [rosa]);
  const s = useMemo(() => calcolaSquilibri(rosa, formazione), [rosa, formazione]);

  return (
    <section className="pannello ge">
      <div className="sq-modulo-testa">
        <h3>Gestione rosa</h3>
        <span className="muted">chi tenere, chi mettere sul mercato</span>
        <span className="spazio" />
        <button className="nota-toggle" onClick={() => setAperto((x) => !x)}>
          {aperto ? '▾ nascondi' : '▸ mostra'}
        </button>
      </div>

      {aperto && (
        <>
          {/* I vincoli prima dei suggerimenti: uno scambio e' una risorsa
              contata, e leggere "sacrificabile" senza sapere che ne hai cinque
              in tutta la stagione porta a bruciarne uno per un difensore da
              due crediti. */}
          <div className="ge-vincoli">
            <strong>
              {REGOLE_SCAMBI.massimo} scambi in tutta la stagione
            </strong>
            <ul>
              {REGOLE_SCAMBI.testo.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>

          {GRUPPI.map(({ chiave, titolo, classe }) => (
            <div className={`ge-gruppo ${classe}`} key={chiave}>
              <h4>
                {titolo} <span className="muted">— {g[chiave].length}</span>
              </h4>
              <p className="ge-criterio">{g.criteri[chiave]}</p>
              {g[chiave].length === 0 ? (
                <p className="muted">Nessuno.</p>
              ) : (
                <ul className="ge-lista">
                  {g[chiave].map((x) => (
                    <Voce key={x.id} g={x} onApri={onApri} />
                  ))}
                </ul>
              )}
            </div>
          ))}

          <h4 className="ge-titolo-squilibri">Squilibri</h4>
          {s.avvisi.length === 0 ? (
            <p className="muted">Nessuno squilibrio evidente: reparti in proporzione, nessuna concentrazione, copertura sufficiente.</p>
          ) : (
            <ul className="ge-squilibri">
              {s.avvisi.map((a, i) => (
                <li key={`${a.tipo}-${i}`} className={`ge-squilibrio g${a.gravita}`}>
                  <strong>{a.titolo}</strong>
                  <span className="muted">{a.testo}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="ge-tabelle">
            <div>
              <h5>Spesa contro rosa</h5>
              <table className="det-tab">
                <thead>
                  <tr>
                    <th>Reparto</th>
                    <th className="num">Quota rosa</th>
                    <th className="num">Quota spesa</th>
                    <th className="num">Scostamento</th>
                  </tr>
                </thead>
                <tbody>
                  {s.reparti.map((x) => (
                    <tr key={x.ruolo}>
                      <td>{RUOLI_NOMI[x.ruolo].nome}</td>
                      <td className="num">{x.quotaRosa}%</td>
                      <td className="num">{x.quotaSpesa}%</td>
                      <td className={`num${x.scostamento > 0 ? ' su' : x.scostamento < 0 ? ' giu' : ''}`}>
                        {x.scostamento > 0 ? '+' : ''}
                        {x.scostamento}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h5>Concentrazione per squadra</h5>
              <ul className="ge-conc">
                {s.concentrazione.map((c) => (
                  <li key={c.squadra} className={c.quanti >= 3 ? 'molti' : ''}>
                    <strong>{c.quanti}</strong> {c.squadra}
                    <span className="muted"> — {c.nomi.join(', ')} ({c.spesa}cr)</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h5>Copertura per ruolo</h5>
              <ul className="ge-cop">
                {s.copertura.map((c) => (
                  <li key={c.ruolo} className={c.affidabili < c.servono ? 'scarsa' : c.affidabili === c.servono ? 'giusta' : ''}>
                    <strong>{RUOLI_NOMI[c.ruolo].nome}</strong>
                    <span className="muted">
                      {c.affidabili} sopra il 50% di titolarita' su {c.inRosa} in rosa · il modulo ne schiera {c.servono}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h5>Blocco difensivo</h5>
              <p className="muted">
                {s.difesa.gruppo.map((x) => `${x.nome} ${x.mv ?? '—'}`).join(' + ')}
              </p>
              <p className={s.difesa.sottoSoglia ? 'err' : s.difesa.senzaMv.length ? 'avviso' : 'muted'}>
                {s.difesa.media !== null
                  ? `media ${s.difesa.media}`
                  : `non calcolabile: manca la media voto di ${s.difesa.senzaMv.join(', ')}`}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
