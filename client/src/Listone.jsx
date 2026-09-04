import { useMemo } from 'react';
import { RUOLI, ORDINE_RUOLI } from './squadre.js';
import { BadgeSquadra } from './Badge.jsx';
import { COLONNE, differenza, filtraOrdina, prossimoOrdine } from './listoneFiltri.js';
import AzioniGiocatore from './AzioniGiocatore.jsx';

/** Vista tabellare del listone: dati grezzi, densi, da consultare. Niente card
 *  e niente segnali - per quelli c'e' la pagina Analisi. Qui si vuole vedere
 *  tante righe insieme e ordinarle. */

export default function Listone({ stato, filtri, onFiltri, onApri, onStato, onAvviso }) {
  /* I filtri arrivano da App e tornano ad App: aprire la scheda di un
     giocatore smonta questa pagina, e con i filtri in uno stato locale
     tornare indietro li avrebbe azzerati. */
  const { ordine, ruolo, squadra, fascia, cerca, soloAttivi } = filtri;
  const setOrdine = (v) => onFiltri({ ...filtri, ordine: typeof v === 'function' ? v(filtri.ordine) : v });
  const setRuolo = (v) => onFiltri({ ...filtri, ruolo: typeof v === 'function' ? v(filtri.ruolo) : v });
  const setSquadra = (v) => onFiltri({ ...filtri, squadra: typeof v === 'function' ? v(filtri.squadra) : v });
  const setFascia = (v) => onFiltri({ ...filtri, fascia: typeof v === 'function' ? v(filtri.fascia) : v });
  const setCerca = (v) => onFiltri({ ...filtri, cerca: typeof v === 'function' ? v(filtri.cerca) : v });
  const setSoloAttivi = (v) => onFiltri({ ...filtri, soloAttivi: typeof v === 'function' ? v(filtri.soloAttivi) : v });

  const squadre = useMemo(
    () => [...new Set(stato.giocatori.map((g) => g.squadra))].sort((a, b) => a.localeCompare(b, 'it')),
    [stato.giocatori]
  );

  const righe = useMemo(
    () => filtraOrdina(stato.giocatori, { ruolo, squadra, fascia, cerca, soloAttivi }, ordine),
    [stato.giocatori, ordine, ruolo, squadra, fascia, cerca, soloAttivi]
  );

  const ordina = (c) => setOrdine((o) => prossimoOrdine(o, c));

  const l = stato.listone;

  return (
    <main className="wrap largo">
      <section className="testata-listone">
        <div>
          <h2>Listone</h2>
          <p className="muted">
            {l.nomeFile ? (
              <>
                da <strong>{l.nomeFile}</strong>
                {l.caricatoIl && <> · caricato il {new Date(l.caricatoIl).toLocaleString('it-IT')}</>}
              </>
            ) : (
              <>nessun caricamento registrato: il listone in archivio e' precedente a questa versione</>
            )}
          </p>
        </div>
        <div className="contatori">
          <span>
            totale <strong>{l.totale}</strong>
          </span>
          <span>
            in listino <strong>{l.attivi}</strong>
          </span>
          {l.totale > l.attivi && (
            <span className="avviso">
              usciti <strong>{l.totale - l.attivi}</strong>
            </span>
          )}
        </div>
      </section>

      <div className="filtri">
        <button className={`chip${ruolo === null ? ' on' : ''}`} onClick={() => setRuolo(null)}>
          tutti
        </button>
        {ORDINE_RUOLI.map((r) => (
          <button key={r} className={`chip${ruolo === r ? ' on' : ''}`} onClick={() => setRuolo(ruolo === r ? null : r)}>
            <i className="punto" style={{ background: RUOLI[r].colore }} />
            {RUOLI[r].nome}
          </button>
        ))}
        <span style={{ width: 8 }} />
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
        <label className="inline">
          <input type="checkbox" checked={soloAttivi} onChange={(e) => setSoloAttivi(e.target.checked)} /> solo attivi
        </label>
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
              {COLONNE.map((c) => (
                <th
                  key={c.chiave}
                  onClick={() => ordina(c)}
                  className={`ordinabile${c.num ? ' num' : ''}${c.stretta ? ' stretta' : ''}`}
                >
                  {c.etichetta}
                  {ordine.chiave === c.chiave ? (ordine.crescente ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th className="azioni">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {righe.map((g) => {
              const d = differenza(g);
              return (
                <tr key={g.id} className={g.assente_dal ? 'uscito' : ''}>
                  <td>
                    <button className="link-nome" onClick={() => onApri(g.id)}>
                      {g.nome}
                    </button>
                  </td>
                  <td className="sq">
                    <BadgeSquadra nome={g.squadra} size={17} titolo={false} /> {g.squadra}
                  </td>
                  <td className="stretta">
                    <span className="ruolo" style={{ borderColor: RUOLI[g.ruolo]?.colore, color: RUOLI[g.ruolo]?.colore }}>
                      {g.ruolo}
                    </span>
                  </td>
                  <td className="num">{g.quotazione}</td>
                  <td className="num">{g.quotazione_iniziale ?? '-'}</td>
                  <td className={`num${d > 0 ? ' su' : d < 0 ? ' giu' : ''}`}>
                    {d === null ? '-' : d > 0 ? `+${d}` : d}
                  </td>
                  <td className="num">{g.fvm ?? '-'}</td>
                  <td className="num">{g.rapporto_fvm === null ? '-' : g.rapporto_fvm.toFixed(2)}</td>
                  <td className="num">{g.fascia ?? '-'}</td>
                  <td>
                    {g.assente_dal ? (
                      <span className="avviso">non piu' in listino dal {new Date(g.assente_dal).toLocaleDateString('it-IT')}</span>
                    ) : (
                      <span className="muted">attivo</span>
                    )}
                  </td>
                  <td className="azioni">
                    {/* Chi non e' piu' in listino non si compra: niente pulsanti. */}
                    {!g.assente_dal && (
                      <AzioniGiocatore g={g} stato={stato} onStato={onStato} onAvviso={onAvviso} compatto />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
