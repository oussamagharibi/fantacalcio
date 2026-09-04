import { useMemo, useState } from 'react';
import { RUOLI, ORDINE_RUOLI } from './squadre.js';
import { BadgeSquadra } from './Badge.jsx';
import { conStato, filtra, riepilogo, STATI } from './situazione.js';
import { eseguiAzione } from './azioni.js';
import AzioniGiocatore from './AzioniGiocatore.jsx';

/** Dove siamo con l'asta: ogni giocatore del listone con il suo stato, e le
 *  stesse azioni della pagina Asta direttamente sulla riga.
 *
 *  Le azioni non hanno logica propria: chiamano gli endpoint gia' usati
 *  dall'asta e rimettono in circolo lo stato che tornano. Due schermate che
 *  scrivono la stessa cosa in due modi diversi sarebbero due modi di sbagliare. */

function Etichetta({ g }) {
  // Il prezzo sta nella sua colonna: ripeterlo qui era la stessa cifra due volte.
  if (g.stato === 'me') return <span className="chip tit">preso da me</span>;
  if (g.stato === 'uscito') return <span className="chip">uscito</span>;
  return <span className="chip rig">disponibile</span>;
}

/** Le due zone di rilascio. Il trascinamento e' una scorciatoia, non l'unica
 *  strada: i pulsanti in riga restano, e sotto i 900px le zone spariscono
 *  perche' su uno schermo stretto trascinare in una tabella non funziona. */
function ZoneRilascio({ inCorso, configurata, onRilascia }) {
  const [sopra, setSopra] = useState(null);
  const zona = (chiave, titolo, sotto, spenta) => (
    <div
      className={`rilascio-zona${sopra === chiave ? ' sopra' : ''}${spenta ? ' spenta' : ''}`}
      onDragOver={(e) => {
        if (spenta) return;
        e.preventDefault(); // senza questo il browser non considera l'area un bersaglio
        setSopra(chiave);
      }}
      onDragLeave={() => setSopra((x) => (x === chiave ? null : x))}
      onDrop={(e) => {
        e.preventDefault();
        setSopra(null);
        if (!spenta) onRilascia(chiave);
      }}
    >
      <strong>{titolo}</strong>
      <span className="muted">{sotto}</span>
    </div>
  );
  return (
    <div className={`rilascio${inCorso ? ' in-corso' : ''}`}>
      {zona('me', 'La mia squadra', configurata ? 'chiede il prezzo' : "prima prepara l'asta", !configurata)}
      {zona('altri', 'Preso da altri', 'esce senza prezzo', false)}
    </div>
  );
}

export default function Situazione({ stato, onStato, filtri, onFiltri, onApri, onAvviso }) {
  /* I filtri arrivano da App e tornano ad App: aprire la scheda di un
     giocatore smonta questa pagina, e con i filtri in uno stato locale
     tornare indietro li avrebbe azzerati. */
  const { stato: filtroStato, ruolo, squadra, fascia, cerca } = filtri;
  const setFiltroStato = (v) => onFiltri({ ...filtri, stato: typeof v === 'function' ? v(filtri.stato) : v });
  const setRuolo = (v) => onFiltri({ ...filtri, ruolo: typeof v === 'function' ? v(filtri.ruolo) : v });
  const setSquadra = (v) => onFiltri({ ...filtri, squadra: typeof v === 'function' ? v(filtri.squadra) : v });
  const setFascia = (v) => onFiltri({ ...filtri, fascia: typeof v === 'function' ? v(filtri.fascia) : v });
  const setCerca = (v) => onFiltri({ ...filtri, cerca: typeof v === 'function' ? v(filtri.cerca) : v });

  /** Quale riga ha un campo aperto. Di norma se lo governa AzioniGiocatore da
   *  solo; qui serve saperlo da fuori, perche' il rilascio del trascinamento
   *  deve aprire il prezzo di una riga che non e' stata cliccata. */
  const [apertura, setApertura] = useState(null);
  /** Quale riga si sta trascinando. La verita' sta qui e non in dataTransfer:
   *  quello si riempie lo stesso per il browser, ma leggerlo al rilascio e'
   *  soggetto ai limiti che ogni browser mette sul contenuto trascinato. */
  const [trascinato, setTrascinato] = useState(null);

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

  /** Rilasciare fa esattamente quello che fanno i due pulsanti: sulla mia
   *  squadra apre il campo prezzo di quella riga, sugli altri registra
   *  l'uscita chiamando la stessa eseguiAzione che usa il componente. */
  async function rilascia(zona) {
    const g = tutti.find((x) => x.id === trascinato);
    setTrascinato(null);
    if (!g || g.stato !== 'disponibile') return;
    if (zona === 'me') return setApertura({ tipo: 'prezzo', id: g.id });
    try {
      const { stato: nuovo, messaggio } = await eseguiAzione({ tipo: 'uscita', g });
      onStato(nuovo);
      onAvviso(messaggio);
    } catch (e) {
      onAvviso(e.message, 'ko');
    }
  }

  const configurata = !!stato.rosa.squadra;

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

      <ZoneRilascio inCorso={trascinato !== null} configurata={configurata} onRilascia={rilascia} />

      {righe.length === 0 ? (
        <p className="muted">Nessun giocatore con questi filtri.</p>
      ) : (
        <table className="tabella-listone tabella-situazione">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Squadra</th>
              <th className="stretta">R</th>
              <th className="num">Qt.A</th>
              <th className="num">FVM</th>
              <th className="num">Fascia</th>
              <th className="num">Prezzo</th>
              <th>Stato</th>
              <th className="azioni">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {righe.map((g) => (
              <tr
                key={g.id}
                className={
                  (g.stato === 'me' ? 'riga-me' : g.stato === 'uscito' ? 'riga-uscito' : 'riga-libera') +
                  (trascinato === g.id ? ' si-trascina' : '')
                }
                draggable={g.stato === 'disponibile'}
                onDragStart={(e) => {
                  setTrascinato(g.id);
                  e.dataTransfer?.setData?.('text/plain', String(g.id));
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setTrascinato(null)}
              >
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
                <td className="num">{g.fvm ?? '-'}</td>
                <td className="num">{g.fascia ?? '-'}</td>
                {/* Il prezzo c'e' solo per i miei: di un uscito non lo sappiamo. */}
                <td className="num prezzo">{g.prezzo ?? ''}</td>
                <td>
                  <Etichetta g={g} />
                </td>
                <td className="azioni">
                  {/* Il prezzo ha gia' la sua colonna, quindi qui non si ripete.
                      L'apertura e' governata dalla pagina per via del rilascio. */}
                  <AzioniGiocatore
                    g={g}
                    stato={stato}
                    onStato={onStato}
                    onAvviso={onAvviso}
                    mostraPrezzo={false}
                    compatto
                    apertura={apertura?.id === g.id ? apertura.tipo : null}
                    onApertura={(t) => setApertura(t ? { tipo: t, id: g.id } : null)}
                  />
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
