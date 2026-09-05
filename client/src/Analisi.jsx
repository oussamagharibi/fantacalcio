import { useMemo, useState } from 'react';
import { uploadStats, uploadXg } from './api.js';
import { RUOLI, ORDINE_RUOLI } from './squadre.js';
import { BadgeSquadra, BadgeGiocatore, Fascia } from './Badge.jsx';
import UploadListone from './UploadListone.jsx';
import UploadFonte from './UploadFonte.jsx';
import Carriera from './Carriera.jsx';
import Rendimento from './Rendimento.jsx';
import AzioniGiocatore from './AzioniGiocatore.jsx';
import Stella from './Stella.jsx';
import Aggiorna from './Aggiorna.jsx';
import { commutaFascia, filtra, perReparto as soloDelReparto, quantiAttivi, squadreDi, FILTRI_VUOTI } from './analisiFiltri.js';

/** Segnale come chip colorato: rosso infortunio, blu rigorista, verde
 *  titolarita'. Il testo lungo resta nel title, la card non si allarga. */
const ETICHETTE_CHIP = { infortunio: 'infortunio', dubbio: 'in dubbio', squalifica: 'squalificato', diffida: 'diffidato' };

function ChipSegnale({ s }) {
  if (ETICHETTE_CHIP[s.tipo]) {
    const titolo = `${s.testo}${s.fonte ? ` — ${s.fonte}` : ''}`;
    return (
      <span className={`chip ${s.tipo === 'dubbio' || s.tipo === 'diffida' ? 'dub' : 'inf'}`} title={titolo}>
        {ETICHETTE_CHIP[s.tipo]}
      </span>
    );
  }
  if (s.tipo === 'rigorista') return <span className="chip rig" title={s.testo}>{s.testo.replace('rigorista ', 'rig ')}</span>;
  const perc = /(\d+)%/.exec(s.testo)?.[1];
  const titolare = s.testo.startsWith('titolare');
  return (
    <span className={titolare ? 'chip tit' : 'chip panca'} title={s.testo}>
      {titolare ? `titolare ${perc ?? ''}%` : `panchina ${perc ?? ''}%`}
    </span>
  );
}

function CardGiocatore({ g, onApri, stato, onStato, onAvviso }) {
  const [aperta, setAperta] = useState(false);
  const colore = RUOLI[g.ruolo]?.colore;

  return (
    <article className={`card-g${g.uscito || g.acquistato ? ' fuori' : ''}`} style={{ '--linea-ruolo': colore }}>
      <Stella g={g} onStato={onStato} onAvviso={onAvviso} angolo />

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
          {/* Una chip per riga: due fonti sullo stesso tipo sono due chip,
              e la differenza si vede invece di sparire. */}
          {g.segnali.map((s, i) => (
            <ChipSegnale key={`${s.tipo}-${s.fonte ?? i}`} s={s} />
          ))}
        </div>
      )}

      <div className="card-azioni">
        <AzioniGiocatore g={g} stato={stato} onStato={onStato} onAvviso={onAvviso} />
      </div>

      <Rendimento g={g} compatto />
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

export default function Analisi({ stato, onStato, onRicarica, filtri, onFiltri, onApri, onAvviso }) {
  /* I filtri arrivano da App e tornano ad App: aprire la scheda di un
     giocatore smonta questa pagina, e con i filtri in uno stato locale
     tornare indietro li avrebbe azzerati. */
  const { reparto } = filtri;
  /** Un solo modo di scrivere i filtri: cambiare reparto non tocca gli altri
   *  campi, ed e' cosi' che una fascia scelta sui Difensori resta accesa
   *  passando agli Attaccanti. */
  const imposta = (patch) => onFiltri({ ...filtri, ...patch });
  const setReparto = (r) => imposta({ reparto: r });
  const commuta = (campo) => imposta({ [campo]: !filtri[campo] });

  const perReparto = useMemo(
    () => Object.fromEntries(ORDINE_RUOLI.map((r) => [r, soloDelReparto(stato.giocatori, r)])),
    [stato.giocatori]
  );
  const squadre = useMemo(() => squadreDi(stato.giocatori), [stato.giocatori]);

  // Il reparto attivo e' il totale del contatore; visibili e' il numeratore.
  const delReparto = perReparto[reparto] ?? [];
  const visibili = useMemo(
    () => filtra(delReparto, filtri, stato.rosa.presi),
    [delReparto, filtri, stato.rosa.presi]
  );
  const attivi = quantiAttivi(filtri);

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
        {/* Ricerca mentre si digita: i dati sono gia' tutti nel browser, non
            c'e' niente da aspettare e quindi niente da confermare con Invio. */}
        <input
          className="cerca-listone"
          value={filtri.cerca}
          onChange={(e) => imposta({ cerca: e.target.value })}
          placeholder={`cerca fra i ${RUOLI[reparto].nome.toLowerCase()}`}
        />
        <span className="etichetta">Fascia</span>
        {[1, 2, 3, 4, 5].map((f) => (
          <button
            key={f}
            className={`chip${filtri.fasce.includes(f) ? ' on' : ''}`}
            onClick={() => imposta({ fasce: commutaFascia(filtri.fasce, f) })}
          >
            {f}
          </button>
        ))}
        <select value={filtri.squadra} onChange={(e) => imposta({ squadra: e.target.value })}>
          <option value="">tutte le squadre</option>
          {squadre.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className={`chip${filtri.soloDisponibili ? ' on' : ''}`} onClick={() => commuta('soloDisponibili')}>
          solo disponibili
        </button>
        <button className={`chip${filtri.soloSegnali ? ' on' : ''}`} onClick={() => commuta('soloSegnali')}>
          con segnali
        </button>
        <button className={`chip${filtri.soloTarget ? ' on' : ''}`} onClick={() => commuta('soloTarget')}>
          ★ obiettivi
        </button>
        {attivi > 0 && (
          <button className="chip" onClick={() => imposta(FILTRI_VUOTI)}>
            azzera ({attivi})
          </button>
        )}
        <span className="spazio" />
        <span className="conteggio">
          <strong>{visibili.length}</strong> di {delReparto.length}
        </span>
      </div>

      {visibili.length === 0 ? (
        <p className="muted">Nessun giocatore con questi filtri.</p>
      ) : (
        <div className="griglia-card">
          {visibili.map((g) => (
            <CardGiocatore
              key={g.id}
              g={g}
              onApri={onApri}
              stato={stato}
              onStato={onStato}
              onAvviso={onAvviso}
            />
          ))}
        </div>
      )}

      {/* Sezione Dati: sta qui e non nella configurazione perche' deve
          restare raggiungibile sempre, anche a config bloccata o assente. */}
      <section className="dati">
        <h2>Dati</h2>

        {/* Un pulsante solo, sopra i caricamenti a mano: le fonti si rileggono
            dalla rete, i file si caricano qui sotto. */}
        <Aggiorna onFinito={onRicarica} />

        <UploadListone onImportato={onRicarica} />

        <UploadFonte
          titolo="Statistiche storiche"
          descrizione="Gli Excel delle statistiche di fantacalcio.it, uno per stagione. Sono i dati di FANTACALCIO: media voto e fantamedia. Servono al punteggio in stelle, e per i portieri sono l'unica base possibile."
          accept=".xlsx"
          attesi="File stats-2025-26.xlsx e stats-2024-25.xlsx"
          invia={uploadStats}
          onImportato={onRicarica}
          risultato={(e) => (
            <>
              <p>
                <strong>{e.coperti} giocatori</strong> con almeno una stagione in archivio
              </p>
              {e.stagioni.map((s) => (
                <p key={s.stagione} className="muted">
                  <strong>{s.stagione}</strong> da {s.nomeFile} &middot; foglio "{s.foglio}" &middot; {s.righeLette} righe
                  lette &middot; {s.inserite} inserite &middot; {s.aggiornate} aggiornate
                  {s.scartate > 0 && <> &middot; {s.scartate} scartate</>}
                  {s.senzaGiocatore > 0 && <> &middot; {s.senzaGiocatore} senza giocatore nel listone</>}
                </p>
              ))}
              {/* Una colonna attesa che non c'e' si vede: un NULL silenzioso
                  aveva gia' lasciato i gol vuoti per due caricamenti di fila. */}
              {e.stagioni.flatMap((s) => (s.colonneMancanti ?? []).map((c) => `${s.stagione}: ${c}`)).map((c) => (
                <p className="avviso" key={c}>
                  {c}
                </p>
              ))}
            </>
          )}
        />

        <UploadFonte
          titolo="Expected goals"
          descrizione="Le esportazioni json di Understat, una per stagione. Sono dati di CALCIO VERO, non fanta: quanto valevano le occasioni avute. Understat vieta il download automatico (robots.txt), quindi i file si salvano dal browser."
          accept=".json,.csv"
          attesi="File serie_a_2025.json e serie_a_2024.json"
          invia={uploadXg}
          onImportato={onRicarica}
          risultato={(e) => (
            <>
              {e.stagioni.map((s) => (
                <p key={s.stagione} className="muted">
                  <strong>{s.stagione}</strong> da {s.nomeFile} &middot; {s.righeFile} righe nel file &middot;{' '}
                  <strong>{s.abbinati}</strong> abbinati su {e.giocatori}
                  {s.ambigui > 0 && <> &middot; {s.ambigui} scartati per ambiguita'</>}
                  {s.campiMancanti.length > 0 && (
                    <> &middot; campi assenti: {s.campiMancanti.join(', ')}</>
                  )}
                </p>
              ))}
              {e.orfane.length > 0 && (
                <p className="avviso">
                  In archivio restano stagioni senza file caricato:{' '}
                  {e.orfane.map((o) => `${o.stagione} (${o.n} righe)`).join(', ')}. Nessuno le aggiornera' piu'.
                </p>
              )}
            </>
          )}
        />

      </section>
    </main>
  );
}
