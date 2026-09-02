import { useEffect, useMemo, useRef, useState } from 'react';
import { postAcquisto, postUscita, postAnnulla } from './api.js';
import { RUOLI, ORDINE_RUOLI } from './squadre.js';
import { BadgeSquadra, BadgeGiocatore, Fascia } from './Badge.jsx';
import { percentuale, perSlot, proiezionePrezzo } from './budget.js';
import Carriera from './Carriera.jsx';
import Preparazione from './Preparazione.jsx';
import { postReset } from './api.js';

const MIN_LETTERE = 3;
const MAX_RISULTATI = 9;

const senzaAccenti = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function ChipSegnale({ s }) {
  if (s.tipo === 'infortunio') return <span className="chip inf" title={s.testo}>infortunio</span>;
  if (s.tipo === 'rigorista') return <span className="chip rig" title={s.testo}>{s.testo.replace('rigorista ', 'rig ')}</span>;
  const perc = /(\d+)%/.exec(s.testo)?.[1];
  const titolare = s.testo.startsWith('titolare');
  return <span className={titolare ? 'chip tit' : 'chip panca'} title={s.testo}>{titolare ? `titolare ${perc ?? ''}%` : `panchina ${perc ?? ''}%`}</span>;
}

export default function Asta({ stato, onStato, config, onRicarica }) {
  /** Dopo un reset la configurazione resta in archivio ma gli acquisti no:
   *  si torna comunque alla preparazione, perche' "Nuova asta" vuol dire
   *  ricominciare, non riprendere con gli stessi numeri. */
  const [riprepara, setRiprepara] = useState(false);
  const [cerca, setCerca] = useState('');
  /** Il lotto in corso vive solo qui: non e' un dato dell'asta finche' non si
   *  decide, e persisterlo vorrebbe dire doverlo anche ripulire. */
  const [lotto, setLotto] = useState(null);
  const [prezzo, setPrezzo] = useState('');
  const [toast, setToast] = useState(null);
  /** Serve solo al flash dello slot appena riempito: feedback, non stato. */
  const [appenaPreso, setAppenaPreso] = useState(null);
  const campo = useRef(null);
  const campoPrezzo = useRef(null);

  const avvisa = (testo, tipo = 'ok') => {
    setToast({ testo, tipo });
    setTimeout(() => setToast(null), 3500);
  };
  const tornaAllaRicerca = () => {
    setLotto(null);
    setPrezzo('');
    setCerca('');
    setTimeout(() => campo.current?.focus(), 0);
  };

  const disponibili = useMemo(
    () => stato.giocatori.filter((g) => !g.uscito && !g.acquistato && !g.assente_dal),
    [stato.giocatori]
  );

  const risultati = useMemo(() => {
    const q = senzaAccenti(cerca).trim();
    if (q.length < MIN_LETTERE) return [];
    return disponibili
      .filter((g) => senzaAccenti(g.nome).includes(q) || senzaAccenti(g.squadra).includes(q))
      .slice(0, MAX_RISULTATI);
  }, [cerca, disponibili]);

  async function agisci(fn, descrizione, idFlash) {
    try {
      const r = await fn();
      onStato({ giocatori: r.giocatori, rosa: r.rosa, restanti: r.restanti });
      if (idFlash) {
        setAppenaPreso(idFlash);
        setTimeout(() => setAppenaPreso(null), 500);
      }
      avvisa(descrizione(r));
      tornaAllaRicerca();
    } catch (e) {
      avvisa(e.message, 'ko');
    }
  }

  const presoDaMe = () => {
    const p = Number(prezzo);
    if (prezzo === '' || !Number.isInteger(p) || p < 0) return avvisa('prezzo non valido', 'ko');
    agisci(() => postAcquisto(lotto.id, p), () => `${lotto.nome} preso a ${p}`, lotto.id);
  };
  const presoDaAltri = () => agisci(() => postUscita(lotto.id), () => `${lotto.nome} preso da altri`);
  const annulla = () =>
    agisci(
      () => postAnnulla(),
      (r) =>
        r.annullata.tipo === 'acquisto'
          ? `annullato: ${r.annullata.nome} a ${r.annullata.prezzo}, torna in lista`
          : `annullato: ${r.annullata.nome} torna in lista`
    );

  /** Cancella TUTTI gli acquisti: si chiede conferma per esteso, perche' e'
   *  l'unica azione dell'applicazione che butta via dati senza un annulla. */
  async function nuovaAsta() {
    const quanti = stato.rosa.presi.length;
    const messaggio =
      quanti > 0
        ? `Nuova asta: cancella i ${quanti} acquisti registrati e riapre la preparazione.

L'operazione non si annulla. Procedere?`
        : 'Nuova asta: riapre la schermata di preparazione. Procedere?';
    if (!window.confirm(messaggio)) return;
    try {
      await postReset();
      setRiprepara(true);
      await onRicarica();
      avvisa(quanti > 0 ? `asta azzerata: ${quanti} acquisti cancellati` : 'preparazione riaperta');
    } catch (e) {
      avvisa(e.message, 'ko');
    }
  }

  const apri = (g) => {
    setLotto(g);
    setPrezzo('');
  };

  // Tastiera globale: l'asta si conduce senza mouse.
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
  const pct = (x) => percentuale(x, r.budget);
  /** Ricalcolata a ogni tasto: il valore di prezzo viene dallo stato, quindi
   *  ogni battuta rifa' il render e con esso la proiezione. */
  const proiezione = proiezionePrezzo(r, prezzo);
  const totalePerRuolo = (ruolo) => stato.restanti.filter((x) => x.ruolo === ruolo).reduce((s, x) => s + x.n, 0);
  const perFascia = (ruolo, f) => stato.restanti.filter((x) => x.ruolo === ruolo && x.fascia === f).reduce((s, x) => s + x.n, 0);
  const massimoRuolo = Math.max(1, ...ORDINE_RUOLI.map(totalePerRuolo));

  /** La preparazione non ricompare mai con acquisti registrati: la config e'
   *  congelata dal primo acquisto e riaprirla darebbe l'idea di poterla
   *  cambiare a meta' asta. */
  if ((!config.configurata || riprepara) && config.acquisti === 0)
    return (
      <Preparazione
        iniziale={config.config}
        onIniziata={() => {
          setRiprepara(false);
          onRicarica();
        }}
      />
    );

  return (
    <div className="asta-griglia">
      {/* ------------------------------------------------ sinistra: la rosa */}
      <aside className="zona">
        <h3>La mia rosa &mdash; {r.squadra}</h3>

        <div className="budget">
          <div className="budget-riga">
            <span className="muted">speso</span>
            <span>
              <strong>{r.spesa}</strong>
              <span className="muted">/{r.budget}</span>
            </span>
            <span className="budget-pct">{pct(r.spesa)}%</span>
          </div>
          <div className="budget-riga">
            <span className="muted">residuo</span>
            <span>
              <strong>{r.residuo}</strong>
            </span>
            <span className="budget-pct">{pct(r.residuo)}%</span>
          </div>
          <div className="budget-traccia">
            <div className="budget-speso" style={{ width: `${Math.min(100, (100 * r.spesa) / (r.budget || 1))}%` }} />
          </div>
          <div className="budget-riga media">
            <span className="muted">per slot libero</span>
            <span>
              <strong>{perSlot(r.residuo, r.slotLiberi)}</strong>
              <span className="muted"> crediti medi su {r.slotLiberi}</span>
            </span>
          </div>
        </div>
        {ORDINE_RUOLI.map((ruolo) => {
          const presi = r.presi.filter((p) => p.ruolo === ruolo);
          const posti = Array.from({ length: r.slot[ruolo] ?? 0 }, (_, i) => presi[i] ?? null);
          return (
            <div className="gruppo-slot" key={ruolo}>
              <div className="gruppo-testa">
                <span className="punto" style={{ background: RUOLI[ruolo].colore }} />
                {RUOLI[ruolo].nome}
                <span className="spazio" />
                {presi.length}/{r.slot[ruolo] ?? 0}
              </div>
              {posti.map((p, i) => (
                <div
                  key={p ? p.id : `vuoto-${i}`}
                  className={`slot ${p ? 'pieno' : 'vuoto'}${p && p.player_id === appenaPreso ? ' flash' : ''}`}
                  style={{ '--colore-ruolo': RUOLI[ruolo].colore }}
                >
                  {p ? (
                    <>
                      <BadgeSquadra nome={p.squadra} size={22} />
                      <span className="nome">{p.nome}</span>
                      <span className="prezzo">{p.prezzo}</span>
                    </>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      libero
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        <button className="bottone neutro nuova-asta" onClick={nuovaAsta}>
          Nuova asta
        </button>
      </aside>

      {/* -------------------------------------------- centro: ricerca e lotto */}
      <section className="centro">
        {!lotto ? (
          <div className="pannello">
            <input
              ref={campo}
              className="campo-cerca"
              value={cerca}
              onChange={(e) => setCerca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && risultati[0]) apri(risultati[0]);
              }}
              placeholder={`Cerca (${MIN_LETTERE} lettere) · 1-9 per scegliere · Invio per il primo`}
              autoFocus
            />
            {cerca.trim().length >= MIN_LETTERE && risultati.length === 0 && (
              <p className="muted" style={{ marginTop: 10 }}>
                Nessun giocatore disponibile con questo nome.
              </p>
            )}
            <ol className="risultati">
              {risultati.map((g, i) => (
                <li key={g.id} className={i === 0 ? 'evidenziato' : ''} onClick={() => apri(g)}>
                  <kbd>{i + 1}</kbd>
                  <BadgeGiocatore nome={g.nome} ruolo={g.ruolo} size={26} />
                  <strong style={{ flex: 1 }}>{g.nome}</strong>
                  <BadgeSquadra nome={g.squadra} size={20} />
                  <Fascia valore={g.fascia} ruolo={g.ruolo} />
                  <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    Qt {g.quotazione}
                  </span>
                  {g.target && <span style={{ color: 'var(--oro)' }}>★</span>}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="pannello lotto">
            <div className="lotto-testa">
              <div style={{ minWidth: 0 }}>
                <div className="lotto-nome">
                  {lotto.nome} {lotto.target && <span style={{ color: 'var(--oro)' }}>★</span>}
                </div>
                <div className="riga" style={{ margin: '8px 0 0', alignItems: 'center', gap: 8 }}>
                  <BadgeSquadra nome={lotto.squadra} size={26} />
                  <span className="muted">{lotto.squadra}</span>
                  <span className="chip" style={{ borderColor: RUOLI[lotto.ruolo].colore, color: RUOLI[lotto.ruolo].colore }}>
                    {RUOLI[lotto.ruolo].nome.slice(0, -1)}
                  </span>
                  <Fascia valore={lotto.fascia} ruolo={lotto.ruolo} />
                </div>
              </div>
              <div className={`massimo${proiezione?.oltre ? ' oltre' : ''}`}>
                <span className="eti">massimo sostenibile</span>
                <span className="n">{r.massimoSostenibile}</span>
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
                residuo <strong>{r.residuo}</strong>
              </span>
              <span>
                slot liberi <strong>{r.slotLiberi}</strong>
              </span>
            </div>

            {lotto.segnali.length > 0 && (
              <div className="card-chip">
                {lotto.segnali.map((s) => (
                  <ChipSegnale key={s.tipo} s={s} />
                ))}
              </div>
            )}

            <Carriera righe={lotto.carriera} ruolo={lotto.ruolo} />

            {lotto.note && (
              <div className="nota-corpo" style={{ marginTop: 10 }}>
                {lotto.note}
                <span className="nota-data">generata il {new Date(lotto.note_generated_at).toLocaleString('it-IT')}</span>
              </div>
            )}

            {/* Proiezione dal vivo: cambia a ogni tasto, prima di confermare. */}
            {proiezione && (
              <div className={`proiezione${proiezione.oltre ? ' oltre' : ''}`}>
                <span>
                  <strong>{proiezione.prezzo}</strong> crediti = <strong>{proiezione.quotaBudget}%</strong> del budget
                </span>
                <span className="sep">·</span>
                <span>
                  resterebbero <strong>{proiezione.residuoDopo}</strong> ({proiezione.residuoDopoPct}%)
                </span>
                <span className="sep">·</span>
                <span>
                  <strong>{proiezione.perSlotDopo}</strong> per ognuno dei {proiezione.slotDopo} slot rimasti
                </span>
                {proiezione.oltre && <span className="oltre-eti">oltre il massimo sostenibile ({r.massimoSostenibile})</span>}
              </div>
            )}

            <div className="azioni">
              <label style={{ flex: '0 0 auto' }}>
                Prezzo
                <input
                  ref={campoPrezzo}
                  inputMode="numeric"
                  value={prezzo}
                  onChange={(e) => setPrezzo(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') presoDaMe();
                  }}
                  placeholder="0"
                />
              </label>
              <button className="bottone" onClick={presoDaMe}>
                Preso da me <kbd>Invio</kbd>
              </button>
              <button className="bottone neutro" onClick={presoDaAltri}>
                Preso da altri <kbd>A</kbd>
              </button>
              <button className="bottone neutro" onClick={tornaAllaRicerca}>
                Chiudi <kbd>Esc</kbd>
              </button>
            </div>
          </div>
        )}
        <p className="scorciatoie">
          <kbd>Ctrl+Z</kbd> annulla l'ultima azione &middot; <kbd>Esc</kbd> chiude il lotto &middot; <kbd>1</kbd>-
          <kbd>9</kbd> scelgono dai risultati
        </p>
      </section>

      {/* ------------------------------------------- destra: quanti ne restano */}
      <aside className="zona">
        <h3>Ancora disponibili</h3>
        {ORDINE_RUOLI.map((ruolo) => {
          const n = totalePerRuolo(ruolo);
          return (
            <div className="barra-conta" key={ruolo}>
              <div className="riga1">
                <span>
                  <span className="punto" style={{ background: RUOLI[ruolo].colore, display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6 }} />
                  {RUOLI[ruolo].nome}
                </span>
                <strong>{n}</strong>
              </div>
              <div className="traccia">
                <div className="riempi" style={{ width: `${(100 * n) / massimoRuolo}%`, background: RUOLI[ruolo].colore }} />
              </div>
              <div className="fasce-riga">
                {[1, 2, 3, 4, 5].map((f) => (
                  <span key={f} title={`fascia ${f}`}>
                    f{f} {perFascia(ruolo, f)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </aside>

      {toast && <div className={`toast ${toast.tipo}`}>{toast.testo}</div>}
    </div>
  );
}
