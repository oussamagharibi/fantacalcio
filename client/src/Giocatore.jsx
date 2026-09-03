import { useState } from 'react';
import { RUOLI } from './squadre.js';
import { BadgeSquadra, BadgeGiocatore, Fascia } from './Badge.jsx';
import {
  MOTIVO_INSUFFICIENTE,
  arrotonda,
  contatoreVero,
  fantamedie,
  infortunio,
  minutiVeri,
  rigorista,
  sciogliEntita,
  sezioni,
  stagioniXg,
  stelle,
  titolarita,
} from './giocatore.js';

/** Tutto quello che l'applicazione sa di un giocatore, in una pagina sola.
 *  Ogni blocco compare solo se ha un dato dietro: una sezione con i trattini
 *  o con degli zeri messi li' per riempire direbbe una cosa falsa. */

function Sezione({ titolo, fonte, children }) {
  return (
    <section className="det-sez">
      <h3>
        {titolo}
        {fonte && <span className="det-fonte">{fonte}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Le stelle: mezze comprese, perche' i bonus valgono 0.5 e 0.3. */
function Stelle({ n }) {
  return (
    <span className="det-stelle" title={`${n} su 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={n >= i ? 'piena' : n >= i - 0.5 ? 'mezza' : ''} />
      ))}
    </span>
  );
}

function Punteggio({ g }) {
  const [aperto, setAperto] = useState(false);
  const p = stelle(g);

  if (!p.disponibile)
    return (
      <div className="det-punteggio vuoto">
        <span className="muted">{p.motivo}</span>
        {/* Il perche' arriva da stelle(): cambia col ruolo, e scriverlo qui
            vorrebbe dire tenerlo allineato a mano a due condizioni diverse. */}
        <span className="muted det-perche">{p.spiegazione}</span>
      </div>
    );

  return (
    <div className="det-punteggio">
      <div className="det-voto">
        <Stelle n={p.totale} />
        <strong>{p.totale}</strong>
        <span className="muted">su 5</span>
        {p.debole && <span className="chip">stima debole</span>}
      </div>
      <button className="nota-toggle" onClick={() => setAperto((a) => !a)}>
        {aperto ? '▾ nascondi come si calcola' : '▸ come si calcola'}
      </button>
      {aperto && (
        <div className="det-conto">
          {/* Gli stessi passi che hanno prodotto il numero: non una seconda
              descrizione scritta a mano, che prima o poi non corrisponderebbe. */}
          <table>
            <tbody>
              {p.passi.map((x, i) => (
                <tr key={i}>
                  <td className="det-delta">
                    {x.delta > 0 && i > 0 ? '+' : ''}
                    {x.delta}
                  </td>
                  <td>
                    <strong>{x.voce}</strong>
                    <span className="muted"> — {x.dettaglio}</span>
                  </td>
                </tr>
              ))}
              <tr className="det-somma">
                <td className="det-delta">{p.grezzo}</td>
                <td>
                  somma dei passi
                  {p.grezzo !== p.totale && <span className="muted"> — troncata fra 1 e 5: {p.totale}</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Giocatore({ g, onIndietro, provenienza }) {
  if (!g)
    return (
      <main className="wrap">
        <p className="muted">Giocatore non trovato.</p>
        <button className="bottone" onClick={onIndietro}>
          Indietro
        </button>
      </main>
    );

  const s = sezioni(g);
  const fm = fantamedie(g);
  const xg = stagioniXg(g);
  const rig = rigorista(g);
  const tit = titolarita(g);
  const inf = infortunio(g);
  const portiere = g.ruolo === 'P';
  const diff = g.quotazione_iniziale === null ? null : g.quotazione - g.quotazione_iniziale;

  return (
    <main className="wrap largo dettaglio">
      <button className="det-indietro" onClick={onIndietro}>
        ← torna a {provenienza ?? 'Analisi'}
      </button>

      <header className="det-testa">
        <BadgeGiocatore nome={g.nome} ruolo={g.ruolo} />
        <div style={{ minWidth: 0 }}>
          <h2>{g.nome}</h2>
          <div className="det-sotto">
            <BadgeSquadra nome={g.squadra} size={18} titolo={false} /> {g.squadra}
            <span className="chip" style={{ borderColor: RUOLI[g.ruolo]?.colore, color: RUOLI[g.ruolo]?.colore }}>
              {RUOLI[g.ruolo]?.nome.slice(0, -1)}
            </span>
            <Fascia valore={g.fascia} ruolo={g.ruolo} />
            {g.target && <span className="chip" style={{ color: 'var(--oro)', borderColor: 'var(--oro)' }}>★ obiettivo</span>}
            {g.assente_dal && <span className="chip avviso">non piu' in listino</span>}
          </div>
        </div>
        <Punteggio g={g} />
      </header>

      <div className="det-colonne">
        <Sezione titolo="Listone" fonte="fantacalcio.it">
          <dl className="det-dati">
            <div>
              <dt>Quotazione</dt>
              <dd>{g.quotazione}</dd>
            </div>
            {g.quotazione_iniziale !== null && (
              <div>
                <dt>Quotazione iniziale</dt>
                <dd>
                  {g.quotazione_iniziale}
                  {diff !== null && diff !== 0 && (
                    <span className={diff > 0 ? 'su' : 'giu'}>
                      {' '}
                      {diff > 0 ? '+' : ''}
                      {diff}
                    </span>
                  )}
                </dd>
              </div>
            )}
            {g.fvm !== null && (
              <div>
                <dt>FVM</dt>
                <dd>{g.fvm}</dd>
              </div>
            )}
            {g.fascia !== null && (
              <div>
                <dt>Fascia</dt>
                <dd>{g.fascia} su 5</dd>
              </div>
            )}
          </dl>
        </Sezione>

        {s.storicoFanta && (
          <Sezione titolo="Storico fanta" fonte="Excel fantacalcio.it">
            <table className="det-tab">
              <thead>
                <tr>
                  <th>Stagione</th>
                  <th className="num">Fm</th>
                  <th className="num">Mv</th>
                  <th className="num">Pv</th>
                  <th className="num">{portiere ? 'Gs' : 'Gol'}</th>
                  <th className="num">Ass</th>
                  <th className="num">Amm</th>
                  <th className="num">Esp</th>
                </tr>
              </thead>
              <tbody>
                {fm.map((r) => (
                  <tr key={r.stagione}>
                    <td>{r.stagione}</td>
                    <td className="num forte">{arrotonda(r.fm, 2)}</td>
                    <td className="num">{r.mv === null ? '' : arrotonda(r.mv, 2)}</td>
                    <td className="num">{r.pv ?? ''}</td>
                    <td className="num">{(portiere ? r.gs : r.gol) ?? ''}</td>
                    <td className="num">{r.assist ?? ''}</td>
                    <td className="num">{r.amm ?? ''}</td>
                    <td className="num">{r.esp ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sezione>
        )}

        {s.xg && (
          <Sezione titolo="Gol contro expected goals" fonte="Understat — calcio vero, non fanta">
            <table className="det-tab">
              <thead>
                <tr>
                  <th>Stagione</th>
                  <th>Squadra</th>
                  <th className="num">Gol</th>
                  <th className="num">xG</th>
                  <th className="num">Scarto</th>
                  <th className="num">Ass</th>
                  <th className="num">xA</th>
                  <th className="num">Minuti</th>
                </tr>
              </thead>
              <tbody>
                {xg.map((r) => {
                  const sc = r.scarto_xg;
                  const cl = sc === null || sc === undefined ? '' : sc < 0 ? 'occasione' : sc >= 2 ? 'calo' : '';
                  const ass = contatoreVero(r, 'assist');
                  return (
                    <tr key={r.stagione}>
                      <td>{r.stagione}</td>
                      <td>{r.squadra ?? ''}</td>
                      <td className="num forte">{r.gol ?? ''}</td>
                      <td className="num">{r.xg === null ? '' : arrotonda(r.xg, 2)}</td>
                      <td className={`num scarto ${cl}`}>
                        {sc === null || sc === undefined ? '' : `${sc > 0 ? '+' : ''}${arrotonda(sc, 2)}`}
                      </td>
                      {/* Vuoto e non zero quando il file non portava la colonna:
                          uno zero inventato qui sarebbe un dato falso. */}
                      <td className="num">{ass ?? ''}</td>
                      <td className="num">{r.xa === null ? '' : arrotonda(r.xa, 2)}</td>
                      <td className="num">{minutiVeri(r) ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Sezione>
        )}

        {(s.rigorista || s.titolarita || s.infortunio) && (
          <Sezione titolo="Segnali" fonte="liste fantacalcio.it">
            <dl className="det-dati">
              {s.rigorista && (
                <div>
                  <dt>Rigorista</dt>
                  <dd>
                    si'{rig.ordine ? ` — ${rig.ordine}ª scelta` : ''}
                    {/* segnati/tirati arrivano dagli Excel: si mostrano solo se ci sono */}
                    {fm.some((r) => r.rig_tirati) && (
                      <span className="muted">
                        {' '}
                        · {fm.reduce((a, r) => a + (r.rig_segnati ?? 0), 0)} su{' '}
                        {fm.reduce((a, r) => a + (r.rig_tirati ?? 0), 0)} realizzati in carriera fanta
                      </span>
                    )}
                  </dd>
                </div>
              )}
              {s.titolarita && (
                <div>
                  <dt>Titolarita'</dt>
                  <dd>
                    <strong>{tit.percentuale}%</strong> <span className="muted">di impiego stimato</span>
                  </dd>
                </div>
              )}
              {s.infortunio && (
                <div className="det-infortunio">
                  <dt>Infortunio</dt>
                  <dd>{sciogliEntita(inf.testo)}</dd>
                </div>
              )}
            </dl>
          </Sezione>
        )}

        {s.carriera && (
          <Sezione titolo="Carriera" fonte="it.wikipedia.org — presenze e gol reali">
            <table className="det-tab">
              <thead>
                <tr>
                  <th>Stagione</th>
                  <th>Squadra</th>
                  <th className="num">Presenze</th>
                  <th className="num">{portiere ? 'Reti subite' : 'Gol'}</th>
                </tr>
              </thead>
              <tbody>
                {g.carriera.map((r) => (
                  <tr key={`${r.stagione}-${r.squadra}`}>
                    <td>{r.stagione}</td>
                    <td>{r.squadra}</td>
                    <td className="num">{r.presenze ?? ''}</td>
                    <td className="num">{r.gol === null ? '' : portiere ? Math.abs(r.gol) : r.gol}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sezione>
        )}

        {s.nota && (
          <Sezione titolo="Analisi AI" fonte="Claude, dalle notizie raccolte">
            <div className="nota-corpo">
              {g.note}
              <span className="nota-data">generata il {new Date(g.note_generated_at).toLocaleString('it-IT')}</span>
            </div>
          </Sezione>
        )}
      </div>
    </main>
  );
}
