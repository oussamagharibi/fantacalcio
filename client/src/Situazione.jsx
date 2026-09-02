import { useMemo, useState } from 'react';
import { RUOLI, ORDINE_RUOLI } from './squadre.js';
import { BadgeSquadra } from './Badge.jsx';
import { conStato, filtra, riepilogo, STATI } from './situazione.js';

/** Dove siamo con l'asta: ogni giocatore del listone con il suo stato. La
 *  pagina Listone mostra i dati del listino, questa mostra cosa ne e' stato. */

function Etichetta({ g }) {
  if (g.stato === 'me')
    return (
      <span className="chip tit">
        preso da me · <strong>{g.prezzo}</strong>
      </span>
    );
  if (g.stato === 'uscito') return <span className="chip">uscito</span>;
  return <span className="chip rig">disponibile</span>;
}

export default function Situazione({ stato }) {
  const [filtroStato, setFiltroStato] = useState(null);
  const [ruolo, setRuolo] = useState(null);
  const [squadra, setSquadra] = useState('');
  const [fascia, setFascia] = useState(null);
  const [cerca, setCerca] = useState('');

  const tutti = useMemo(() => conStato(stato.giocatori, stato.rosa.presi), [stato.giocatori, stato.rosa.presi]);
  const righe = useMemo(
    () => filtra(tutti, { stato: filtroStato, ruolo, squadra, fascia, cerca }),
    [tutti, filtroStato, ruolo, squadra, fascia, cerca]
  );
  const r = useMemo(() => riepilogo(tutti), [tutti]);
  const squadre = useMemo(
    () => [...new Set(tutti.map((g) => g.squadra))].sort((a, b) => a.localeCompare(b, 'it')),
    [tutti]
  );

  return (
    <main className="wrap largo">
      <section className="riepilogo-situazione">
        <div className="rs-totali">
          <div className="rs-voce">
            <span className="rs-n">{r.disponibile}</span>
            <span className="muted">disponibili</span>
          </div>
          <div className="rs-voce">
            <span className="rs-n ok">{r.me}</span>
            <span className="muted">presi da me{r.spesa > 0 && <> · {r.spesa} crediti</>}</span>
          </div>
          <div className="rs-voce">
            <span className="rs-n">{r.uscito}</span>
            <span className="muted">usciti</span>
          </div>
          <div className="rs-voce">
            <span className="rs-n acc">{r.percentualeAndata}%</span>
            <span className="muted">
              di listone andato ({r.andati}/{r.totale})
            </span>
          </div>
        </div>

        <div className="rs-ruoli">
          {ORDINE_RUOLI.map((k) => (
            <div className="rs-ruolo" key={k}>
              <span className="punto" style={{ background: RUOLI[k].colore }} />
              <strong>{RUOLI[k].nome}</strong>
              <span className="rs-dett">
                <strong>{r.perRuolo[k].disponibile}</strong> disponibili
                <span className="muted">
                  {' '}
                  · {r.perRuolo[k].me} miei · {r.perRuolo[k].uscito} usciti
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="filtri">
        <button className={`chip${filtroStato === null ? ' on' : ''}`} onClick={() => setFiltroStato(null)}>
          tutti
        </button>
        {STATI.map((s) => (
          <button
            key={s.chiave}
            className={`chip${filtroStato === s.chiave ? ' on' : ''}`}
            onClick={() => setFiltroStato(filtroStato === s.chiave ? null : s.chiave)}
          >
            {s.etichetta.toLowerCase()}
          </button>
        ))}
        <span style={{ width: 8 }} />
        <button className={`chip${ruolo === null ? ' on' : ''}`} onClick={() => setRuolo(null)}>
          ogni ruolo
        </button>
        {ORDINE_RUOLI.map((k) => (
          <button key={k} className={`chip${ruolo === k ? ' on' : ''}`} onClick={() => setRuolo(ruolo === k ? null : k)}>
            <i className="punto" style={{ background: RUOLI[k].colore }} />
            {k}
          </button>
        ))}
        <select value={squadra} onChange={(e) => setSquadra(e.target.value)}>
          <option value="">tutte le squadre</option>
          {squadre.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="etichetta">Fascia</span>
        <button className={`chip${fascia === null ? ' on' : ''}`} onClick={() => setFascia(null)}>
          tutte
        </button>
        {[1, 2, 3, 4, 5].map((f) => (
          <button key={f} className={`chip${fascia === f ? ' on' : ''}`} onClick={() => setFascia(fascia === f ? null : f)}>
            {f}
          </button>
        ))}
        <input
          className="cerca-listone"
          value={cerca}
          onChange={(e) => setCerca(e.target.value)}
          placeholder="cerca per nome"
        />
        <span className="spazio" />
        <span className="conteggio">
          <strong>{righe.length}</strong> risultati
        </span>
      </div>

      {righe.length === 0 ? (
        <p className="muted">Nessun giocatore con questi filtri.</p>
      ) : (
        <table className="tabella-listone">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Squadra</th>
              <th className="stretta">R</th>
              <th className="num">Qt.A</th>
              <th className="num">FVM</th>
              <th className="num">Fascia</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody>
            {righe.map((g) => (
              <tr key={g.id} className={g.stato === 'uscito' ? 'uscito' : ''}>
                <td>{g.nome}</td>
                <td className="sq">
                  <BadgeSquadra nome={g.squadra} size={17} titolo={false} /> {g.squadra}
                </td>
                <td className="stretta">
                  <span className="ruolo" style={{ borderColor: RUOLI[g.ruolo]?.colore, color: RUOLI[g.ruolo]?.colore }}>
                    {g.ruolo}
                  </span>
                </td>
                <td className="num">{g.quotazione}</td>
                <td className="num">{g.fvm ?? '-'}</td>
                <td className="num">{g.fascia ?? '-'}</td>
                <td>
                  <Etichetta g={g} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted nota-usciti">
        "Uscito" vuol dire preso da un altro partecipante: l'applicazione registra solo che non e' piu' disponibile,
        non a chi e' andato ne' a quanto. Il prezzo compare solo per i giocatori presi da me.
      </p>
    </main>
  );
}
