import { useEffect, useMemo, useRef, useState } from 'react';
import { postTarget, postGeneraAnalisi, getStatoAnalisi, getStato } from './api.js';
import { RUOLI, ORDINE_RUOLI } from './squadre.js';
import { BadgeSquadra, BadgeGiocatore, Fascia } from './Badge.jsx';
import UploadListone from './UploadListone.jsx';
import Carriera from './Carriera.jsx';
import Xg from './Xg.jsx';

/** Segnale come chip colorato: rosso infortunio, blu rigorista, verde
 *  titolarita'. Il testo lungo resta nel title, la card non si allarga. */
function ChipSegnale({ s }) {
  if (s.tipo === 'infortunio') return <span className="chip inf" title={s.testo}>infortunio</span>;
  if (s.tipo === 'rigorista') return <span className="chip rig" title={s.testo}>{s.testo.replace('rigorista ', 'rig ')}</span>;
  const perc = /(\d+)%/.exec(s.testo)?.[1];
  const titolare = s.testo.startsWith('titolare');
  return (
    <span className={titolare ? 'chip tit' : 'chip panca'} title={s.testo}>
      {titolare ? `titolare ${perc ?? ''}%` : `panchina ${perc ?? ''}%`}
    </span>
  );
}

function CardGiocatore({ g, onStella, onApri }) {
  const [aperta, setAperta] = useState(false);
  const [pop, setPop] = useState(false);
  const colore = RUOLI[g.ruolo]?.colore;

  const stella = () => {
    setPop(true);
    setTimeout(() => setPop(false), 240);
    onStella(g.id);
  };

  return (
    <article className={`card-g${g.uscito || g.acquistato ? ' fuori' : ''}`} style={{ '--linea-ruolo': colore }}>
      <button
        className={`stella${g.target ? ' attiva' : ''}${pop ? ' pop' : ''}`}
        onClick={stella}
        title={g.target ? 'togli dagli obiettivi' : 'segna come obiettivo'}
        aria-pressed={g.target}
      >
        {g.target ? '★' : '☆'}
      </button>

      <div className="card-testa">
        <BadgeGiocatore nome={g.nome} ruolo={g.ruolo} />
        <div style={{ minWidth: 0 }}>
          <button className="card-nome link-nome" onClick={() => onApri(g.id)}>
            {g.nome}
          </button>
          <div className="card-squadra">
            <BadgeSquadra nome={g.squadra} size={15} titolo={false} /> {g.squadra}
          </div>
        </div>
      </div>

      <div className="card-numeri">
        <div>
          <span className="quota">{g.quotazione}</span> <span className="quota-eti">Qt.A</span>
        </div>
        <div className="muted">
          FVM <strong style={{ color: 'var(--fg)' }}>{g.fvm ?? '-'}</strong>
        </div>
        <div className="spazio" />
        <Fascia valore={g.fascia} ruolo={g.ruolo} />
      </div>

      {g.segnali.length > 0 && (
        <div className="card-chip">
          {g.segnali.map((s) => (
            <ChipSegnale key={s.tipo} s={s} />
          ))}
        </div>
      )}

      <Xg dati={g.xg} compatto />
      <Carriera righe={g.carriera} ruolo={g.ruolo} />

      {g.note && (
        <>
          <button className="nota-toggle" onClick={() => setAperta((a) => !a)}>
            {aperta ? '▾ nascondi analisi AI' : '▸ analisi AI'}
          </button>
          {aperta && (
            <div className="nota-corpo">
              {g.note}
              <span className="nota-data">generata il {new Date(g.note_generated_at).toLocaleString('it-IT')}</span>
            </div>
          )}
        </>
      )}
    </article>
  );
}

export default function Analisi({ stato, onStato, onRicarica, filtri, onFiltri, onApri }) {
  /* I filtri arrivano da App e tornano ad App: aprire la scheda di un
     giocatore smonta questa pagina, e con i filtri in uno stato locale
     tornare indietro li avrebbe azzerati. */
  const { reparto, fascia, soloSegnali, soloTarget } = filtri;
  const setReparto = (v) => onFiltri({ ...filtri, reparto: typeof v === 'function' ? v(filtri.reparto) : v });
  const setFascia = (v) => onFiltri({ ...filtri, fascia: typeof v === 'function' ? v(filtri.fascia) : v });
  const setSoloSegnali = (v) => onFiltri({ ...filtri, soloSegnali: typeof v === 'function' ? v(filtri.soloSegnali) : v });
  const setSoloTarget = (v) => onFiltri({ ...filtri, soloTarget: typeof v === 'function' ? v(filtri.soloTarget) : v });
  const [batch, setBatch] = useState({ inCorso: false, righe: [] });
  const timer = useRef(null);

  useEffect(() => {
    if (!batch.inCorso) return undefined;
    timer.current = setInterval(async () => {
      const s = await getStatoAnalisi().catch(() => null);
      if (!s) return;
      setBatch(s);
      if (!s.inCorso) {
        clearInterval(timer.current);
        onRicarica();
      }
    }, 1000);
    return () => clearInterval(timer.current);
  }, [batch.inCorso]);

  async function genera() {
    const r = await postGeneraAnalisi(true).catch((e) => ({ errore: e.message }));
    if (r.errore) return setBatch({ inCorso: false, righe: [`errore: ${r.errore}`] });
    setBatch({ inCorso: true, righe: ['avviato...'] });
  }

  const stella = async (id) => {
    await postTarget(id);
    onStato(await getStato());
  };

  const perReparto = useMemo(() => {
    const m = Object.fromEntries(ORDINE_RUOLI.map((r) => [r, []]));
    // Chi e' uscito dal listino resta nello stato per la pagina Listone, ma
    // qui non si compra piu': fuori dai reparti.
    for (const g of stato.giocatori) if (!g.assente_dal) m[g.ruolo]?.push(g);
    return m;
  }, [stato.giocatori]);

  const visibili = useMemo(
    () =>
      (perReparto[reparto] ?? [])
        .filter((g) => fascia === null || g.fascia === fascia)
        .filter((g) => !soloSegnali || g.segnali.length > 0)
        .filter((g) => !soloTarget || g.target),
    [perReparto, reparto, fascia, soloSegnali, soloTarget]
  );

  return (
    <main className="wrap largo">
      {/* I reparti come tab: si cambia senza scorrere una pagina lunga. */}
      {/* Wikipedia da' presenze e gol, non la fantamedia: se stats e' vuota
          va detto, altrimenti sembra che i dati fanta non esistano. */}
      {stato.statsVuote && (
        <p className="avviso banner">
          Storico fanta non disponibile: carica gli Excel statistiche di fantacalcio.it in <code>/data</code> e lancia{' '}
          <code>npm run import-stats</code>. Lo storico carriera qui sotto viene da Wikipedia e riporta presenze e gol
          reali, non media voto ne' fantamedia.
        </p>
      )}

      <div className="tabs-reparto">
        {ORDINE_RUOLI.map((r) => (
          <button
            key={r}
            data-ruolo={r}
            className={`tab-reparto${reparto === r ? ' attivo' : ''}`}
            onClick={() => setReparto(r)}
          >
            <span className="punto" style={{ background: RUOLI[r].colore }} />
            {RUOLI[r].nome}
            <span className="muted">{perReparto[r]?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="filtri">
        <span className="etichetta">Fascia</span>
        <button className={`chip${fascia === null ? ' on' : ''}`} onClick={() => setFascia(null)}>
          tutte
        </button>
        {[1, 2, 3, 4, 5].map((f) => (
          <button key={f} className={`chip${fascia === f ? ' on' : ''}`} onClick={() => setFascia(fascia === f ? null : f)}>
            {f}
          </button>
        ))}
        <span style={{ width: 10 }} />
        <button className={`chip${soloSegnali ? ' on' : ''}`} onClick={() => setSoloSegnali((v) => !v)}>
          con segnali
        </button>
        <button className={`chip${soloTarget ? ' on' : ''}`} onClick={() => setSoloTarget((v) => !v)}>
          ★ obiettivi
        </button>
      </div>

      {visibili.length === 0 ? (
        <p className="muted">Nessun giocatore con questi filtri.</p>
      ) : (
        <div className="griglia-card">
          {visibili.map((g) => (
            <CardGiocatore key={g.id} g={g} onStella={stella} onApri={onApri} />
          ))}
        </div>
      )}

      {/* Sezione Dati: sta qui e non nella configurazione perche' deve
          restare raggiungibile sempre, anche a config bloccata o assente. */}
      <section className="dati">
        <h2>Dati</h2>
        <UploadListone />

        <div className="blocco-dati">
          <h3>Analisi AI</h3>
          <p className="muted">
            Legge le notizie delle fonti attive e scrive una nota per giocatore. Da lanciare prima dell'asta: fa
            richieste di rete lente.
          </p>
          <button className="bottone" onClick={genera} disabled={batch.inCorso}>
            {batch.inCorso ? 'Analisi in corso…' : 'Genera analisi AI'}
          </button>
          {(batch.inCorso || batch.righe.length > 0) && (
            <pre className="avanzamento">{batch.righe.slice(-12).join('\n')}</pre>
          )}
        </div>
      </section>
    </main>
  );
}
