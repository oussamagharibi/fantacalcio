import { useState } from 'react';
import { RUOLI } from './squadre.js';
import { BadgeSquadra, BadgeGiocatore, Fascia } from './Badge.jsx';
import AzioniGiocatore from './AzioniGiocatore.jsx';
import Stella from './Stella.jsx';
import { classeMedia } from './Rendimento.jsx';
import { fasciaModificatore } from './regolamento.js';
import {
  MOTIVO_INSUFFICIENTE,
  arrotonda,
  cambioSquadra,
  contatoreVero,
  fantamedie,
  golSubiti,
  indisponibilita,
  minutiVeri,
  rigoriFanta,
  rigorista,
  sciogliEntita,
  sezioni,
  stagioniXg,
  stelle,
  titolarita,
} from './giocatore.js';

const quando = (d) => (d ? new Date(d).toLocaleDateString('it-IT') : null);

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

export default function Giocatore({ g, stato, onStato, onAvviso, onIndietro, provenienza }) {
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
  const ind = indisponibilita(g);
  const rigori = rigoriFanta(g);
  const subiti = golSubiti(g);
  const cambio = cambioSquadra(g);
  const portiere = g.ruolo === 'P';
  /** Il modificatore di difesa si calcola sul portiere e sui tre migliori
   *  difensori: per gli altri ruoli la fascia non vuol dire niente. */
  const contaPerModificatore = g.ruolo === 'P' || g.ruolo === 'D';
  const diff = g.quotazione_iniziale === null ? null : g.quotazione - g.quotazione_iniziale;

  return (
    <main className="wrap largo dettaglio">
      <button className="det-indietro" onClick={onIndietro}>
        ← torna a {provenienza ?? 'Analisi'}
      </button>

      {/* Non piu' in listino cambia tutto quello che segue: si legge prima dei
          dati, non incastrato fra un chip e l'altro. */}
      {g.assente_dal && (
        <p className="det-banner fuori">
          <strong>Non piu' nel listino</strong> dal {new Date(g.assente_dal).toLocaleDateString('it-IT')}. Non e' piu'
          acquistabile: i dati qui sotto restano per consultazione.
        </p>
      )}

      {/* Ogni segnalazione per esteso, con da dove viene e di quando e'. Piu'
          fonti sullo stesso giocatore restano tutte: se concordano il segnale
          e' forte, se discordano voglio vederlo, non voglio che una vinca in
          silenzio sull'altra. */}
      {ind.gruppi.length > 0 && (
        <div className={`det-banner ${ind.gruppi[0].tipo === 'diffida' ? 'cambio' : 'infortunio'}`}>
          {ind.discordi && (
            <p className="det-discordi">
              <strong>Le fonti non concordano.</strong> Sotto ci sono tutte, con data e provenienza.
            </p>
          )}
          {ind.gruppi.map((gr) => (
            <div key={gr.tipo} className="det-segnalazione">
              <strong>
                {gr.etichetta}
                {gr.righe.length > 1 && <span className="det-concordi"> · {gr.righe.length} fonti concordi</span>}
              </strong>
              {gr.righe.map((r, i) => (
                <p key={i}>
                  {sciogliEntita(r.testo)}
                  <span className="det-provenienza">
                    {r.fonte ?? 'fonte non registrata'}
                    {quando(r.data) && ` · ${quando(r.data)}`}
                  </span>
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Cambio squadra: il rendimento passato l'ha fatto da un'altra parte. */}
      {cambio?.cambiata && (
        <p className="det-banner cambio">
          {/* Senza articoli davanti ai nomi di club: "al Inter" e "al Fiorentina"
              richiederebbero un accordo che non vale la pena indovinare. */}
          <strong>Ha cambiato squadra.</strong> Nel listone: <strong>{cambio.attuale}</strong>. Ultima stagione in
          carriera ({cambio.stagione}): <strong>{cambio.precedente}</strong>. Il rendimento passato l'ha fatto
          altrove.
        </p>
      )}

      <header className="det-testa">
        <BadgeGiocatore nome={g.nome} ruolo={g.ruolo} />
        <div style={{ minWidth: 0 }}>
          {/* La stella accanto al nome, non una targhetta "obiettivo" piu' sotto:
              qui si decide se un giocatore interessa, e la decisione si prende
              dove si legge il nome. */}
          <div className="det-nome">
            <h2>{g.nome}</h2>
            <Stella g={g} onStato={onStato} onAvviso={onAvviso} />
          </div>
          <div className="det-sotto">
            <BadgeSquadra nome={g.squadra} size={18} titolo={false} /> {g.squadra}
            <span className="chip" style={{ borderColor: RUOLI[g.ruolo]?.colore, color: RUOLI[g.ruolo]?.colore }}>
              {RUOLI[g.ruolo]?.nome.slice(0, -1)}
            </span>
            <Fascia valore={g.fascia} ruolo={g.ruolo} />
          </div>
        </div>
        <Punteggio g={g} />
      </header>

      {/* Le azioni in alto, prima dei dati: da qui si decide, e la decisione
          non deve stare in fondo a una pagina che si scorre. */}
      {!g.assente_dal && (
        <section className="det-azioni">
          <AzioniGiocatore g={g} stato={stato} onStato={onStato} onAvviso={onAvviso} />
        </section>
      )}

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
                  {contaPerModificatore && <th>Modificatore</th>}
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
                    {contaPerModificatore && (
                      <td className="reg-fascia">
                        {(() => {
                          const f = fasciaModificatore(r.mv, g.ruolo);
                          return f ? (
                            <>
                              <span className={`chip${f.punti >= 3 ? ' tit' : f.punti === 0 ? '' : ' rig'}`}>
                                {f.punti} pt
                              </span>
                              <span className="muted"> {f.etichetta}</span>
                            </>
                          ) : (
                            ''
                          );
                        })()}
                      </td>
                    )}
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

        {/* Per un portiere gli expected goals non dicono niente: al loro posto,
            nello stesso punto, quanti gol prende a partita. */}
        {portiere && s.golSubiti && (
          <Sezione titolo="Gol subiti" fonte="Excel fantacalcio.it">
            <table className="det-tab">
              <thead>
                <tr>
                  <th>Stagione</th>
                  <th className="num">Presenze</th>
                  <th className="num">Gol subiti</th>
                  <th className="num">Media a partita</th>
                </tr>
              </thead>
              <tbody>
                {subiti.stagioni.map((r) => (
                  <tr key={r.stagione}>
                    <td>{r.stagione}</td>
                    <td className="num">{r.pv}</td>
                    <td className="num forte">{r.gs}</td>
                    <td className={`num scarto ${classeMedia(r.media)}`}>{r.media}</td>
                  </tr>
                ))}
                <tr className="det-somma">
                  <td>
                    <strong>totale</strong>
                  </td>
                  <td className="num">{subiti.pv}</td>
                  <td className="num forte">{subiti.gs}</td>
                  <td className={`num scarto ${classeMedia(subiti.media)}`}>{subiti.media}</td>
                </tr>
              </tbody>
            </table>
            {/* Media pesata sulle partite, non media delle medie: una stagione
                da tre presenze non puo' contare come una da trentotto. */}
            <p className="muted det-nota">media pesata sulle presenze</p>
          </Sezione>
        )}

        {!portiere && s.xg && (
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

        {(s.rigorista || s.rigori || s.titolarita || s.infortunio) && (
          <Sezione titolo="Segnali" fonte="liste fantacalcio.it">
            <dl className="det-dati">
              {s.rigorista && (
                <div>
                  <dt>Rigorista</dt>
                  <dd>si'{rig.ordine ? ` — ${rig.ordine}ª scelta` : ''}</dd>
                </div>
              )}
              {/* I rigori tirati vengono dagli Excel e non dalla lista dei
                  rigoristi: uno puo' averne calciati senza essere il designato
                  di oggi, e viceversa. Percentuale calcolata, mai salvata. */}
              {s.rigori && (
                <div>
                  <dt>Rigori calciati</dt>
                  <dd>
                    <strong>{rigori.segnati}</strong> su <strong>{rigori.tirati}</strong>{' '}
                    <span className={rigori.percentuale >= 80 ? 'su' : rigori.percentuale < 60 ? 'giu' : ''}>
                      ({rigori.percentuale}%)
                    </span>
                    <span className="muted">
                      {' '}
                      · {rigori.stagioni.join(', ')}
                      {rigori.sbagliati > 0 && ` · ${rigori.sbagliati} sbagliati`}
                    </span>
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
                <div>
                  <dt>Disponibilità</dt>
                  <dd className="giu">
                    {ind.gruppi.map((x) => x.etichetta).join(', ').toLowerCase()} — il dettaglio e' in cima alla scheda
                  </dd>
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
