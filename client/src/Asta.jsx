import { useEffect, useMemo, useRef, useState } from 'react';
import { postAcquisto, postUscita, postAnnulla } from './api.js';

const RUOLI = [
  ['P', 'Portieri'],
  ['D', 'Difensori'],
  ['C', 'Centrocampisti'],
  ['A', 'Attaccanti'],
];
const MIN_LETTERE = 3;
const MAX_RISULTATI = 9;

const senzaAccenti = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function Asta({ stato, onStato }) {
  const [cerca, setCerca] = useState('');
  /** Il lotto in corso vive solo qui: non e' un dato dell'asta finche' non si
   *  decide, e persisterlo significherebbe doverlo anche ripulire. */
  const [lotto, setLotto] = useState(null);
  const [prezzo, setPrezzo] = useState('');
  const [toast, setToast] = useState(null);
  const campo = useRef(null);
  const campoPrezzo = useRef(null);

  const avvisa = (testo, tipo = 'ok') => {
    setToast({ testo, tipo });
    setTimeout(() => setToast(null), 4000);
  };
  const tornaAllaRicerca = () => {
    setLotto(null);
    setPrezzo('');
    setCerca('');
    setTimeout(() => campo.current?.focus(), 0);
  };

  const disponibili = useMemo(
    () => stato.giocatori.filter((g) => !g.uscito && g.prezzoPagato === null),
    [stato.giocatori]
  );

  const risultati = useMemo(() => {
    const q = senzaAccenti(cerca).trim();
    if (q.length < MIN_LETTERE) return [];
    return disponibili
      .filter((g) => senzaAccenti(g.nome).includes(q) || senzaAccenti(g.squadra).includes(q))
      .slice(0, MAX_RISULTATI);
  }, [cerca, disponibili]);

  async function agisci(fn, descrizione) {
    try {
      const r = await fn();
      onStato({ giocatori: r.giocatori, rosa: r.rosa, restanti: r.restanti });
      avvisa(descrizione(r));
      tornaAllaRicerca();
    } catch (e) {
      avvisa(e.message, 'ko');
    }
  }

  const presoDaMe = () => {
    const p = Number(prezzo);
    if (!Number.isInteger(p) || p < 0) return avvisa('prezzo non valido', 'ko');
    agisci(() => postAcquisto(lotto.id, p), () => `${lotto.nome} preso a ${p}`);
  };
  const presoDaAltri = () => agisci(() => postUscita(lotto.id), () => `${lotto.nome} preso da altri`);
  const annulla = () =>
    agisci(
      () => postAnnulla(),
      (r) =>
        r.annullata.tipo === 'acquisto'
          ? `annullato: ${r.annullata.nome} a ${r.annullata.prezzo} crediti, tornato in lista`
          : `annullato: ${r.annullata.nome} e' tornato in lista`
    );

  const apri = (g) => {
    setLotto(g);
    setPrezzo('');
  };

  // Tastiera globale: Ctrl+Z ovunque, Esc chiude il lotto, i numeri scelgono
  // dai risultati. Il mouse non serve mai.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        annulla();
        return;
      }
      if (e.key === 'Escape' && lotto) {
        e.preventDefault();
        tornaAllaRicerca();
        return;
      }
      if (lotto) {
        if (e.key.toLowerCase() === 'a') {
          e.preventDefault();
          presoDaAltri();
        }
        return;
      }
      if (/^[1-9]$/.test(e.key) && risultati.length) {
        const g = risultati[Number(e.key) - 1];
        if (g) {
          e.preventDefault();
          apri(g);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lotto, risultati, prezzo]);

  useEffect(() => {
    if (!lotto) campo.current?.focus();
    else setTimeout(() => campoPrezzo.current?.focus(), 0);
  }, [lotto]);

  const r = stato.rosa;
  const perRuoloFascia = (ruolo, fascia) =>
    stato.restanti.filter((x) => x.ruolo === ruolo && (fascia === null || x.fascia === fascia)).reduce((s, x) => s + x.n, 0);

  return (
    <main className="wrap largo asta">
      <section className="rosa">
        <div className="rosa-testata">
          <h2>La mia rosa &mdash; {r.squadra}</h2>
          <div className="contatori">
            <span>
              residuo <strong>{r.residuo}</strong>/{r.budget}
            </span>
            <span>
              slot liberi <strong>{r.slotLiberi}</strong>
            </span>
            {RUOLI.map(([k]) => (
              <span key={k}>
                {k} <strong>{r.presiPerRuolo[k]}</strong>/{r.slot[k]}
              </span>
            ))}
          </div>
        </div>
        {r.presi.length === 0 ? (
          <p className="muted">Nessun acquisto registrato.</p>
        ) : (
          <ul className="presi">
            {r.presi.map((p) => (
              <li key={p.id}>
                <span className="ruolo">{p.ruolo}</span> {p.nome} <span className="muted">{p.squadra}</span>{' '}
                <strong>{p.prezzo}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="restanti">
        {RUOLI.map(([k, etichetta]) => (
          <div key={k}>
            <strong>{etichetta}</strong>: {perRuoloFascia(k, null)} disponibili
            <span className="muted">
              {' '}
              ({[1, 2, 3, 4, 5].map((f) => `f${f}:${perRuoloFascia(k, f)}`).join('  ')})
            </span>
          </div>
        ))}
      </section>

      {!lotto && (
        <section className="ricerca">
          <input
            ref={campo}
            className="campo-cerca"
            value={cerca}
            onChange={(e) => setCerca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && risultati[0]) apri(risultati[0]);
            }}
            placeholder={`Cerca un giocatore (almeno ${MIN_LETTERE} lettere), 1-9 per scegliere, Invio per il primo`}
            autoFocus
          />
          {cerca.trim().length >= MIN_LETTERE && risultati.length === 0 && (
            <p className="muted">Nessun giocatore disponibile con questo nome.</p>
          )}
          <ol className="risultati">
            {risultati.map((g, i) => (
              <li key={g.id} onClick={() => apri(g)}>
                <kbd>{i + 1}</kbd> <strong>{g.nome}</strong> <span className="muted">{g.squadra}</span>
                <span className="ruolo">{g.ruolo}</span>
                <span className="muted">
                  Qt {g.quotazione} &middot; f{g.fascia}
                </span>
                {g.target && <span className="stella attiva">★</span>}
                {g.segnali.map((s) => (
                  <span key={s.tipo} className="segnale" title={s.testo}>
                    {s.tipo === 'infortunio' ? 'inf' : s.tipo === 'rigorista' ? 'rig' : /(\d+)%/.exec(s.testo)?.[1] + '%'}
                  </span>
                ))}
              </li>
            ))}
          </ol>
        </section>
      )}

      {lotto && (
        <section className="lotto">
          <div className="lotto-testa">
            <h2>
              {lotto.nome} <span className="ruolo">{lotto.ruolo}</span> <span className="muted">{lotto.squadra}</span>
              {lotto.target && <span className="stella attiva">★</span>}
            </h2>
            <div className="massimo">
              <span className="muted">massimo sostenibile</span>
              <strong>{r.massimoSostenibile}</strong>
            </div>
          </div>
          <div className="lotto-dati">
            <span>
              Qt.A <strong>{lotto.quotazione}</strong>
            </span>
            <span>
              FVM <strong>{lotto.fvm ?? '-'}</strong>
            </span>
            <span>
              fascia <strong>{lotto.fascia ?? '-'}</strong>
            </span>
            {lotto.segnali.map((s) => (
              <span key={s.tipo} className="segnale" title={s.testo}>
                {s.tipo}: {s.testo.slice(0, 60)}
              </span>
            ))}
          </div>
          {lotto.note && (
            <div className="nota-lotto">
              <pre>{lotto.note}</pre>
              <span className="muted">generata il {new Date(lotto.note_generated_at).toLocaleString('it-IT')}</span>
            </div>
          )}
          <div className="riga azioni-lotto">
            <label>
              Prezzo pagato
              <input
                ref={campoPrezzo}
                inputMode="numeric"
                value={prezzo}
                onChange={(e) => setPrezzo(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') presoDaMe();
                }}
                placeholder="poi Invio"
              />
            </label>
            <button onClick={presoDaMe}>Preso da me (Invio)</button>
            <button className="secondario" onClick={presoDaAltri}>
              Preso da altri (A)
            </button>
            <button className="secondario" onClick={tornaAllaRicerca}>
              Chiudi (Esc)
            </button>
          </div>
        </section>
      )}

      <p className="muted scorciatoie">
        Ctrl+Z annulla l'ultima azione &middot; Esc chiude il lotto &middot; 1-9 scelgono dai risultati
      </p>

      {toast && <div className={`toast ${toast.tipo}`}>{toast.testo}</div>}
    </main>
  );
}
