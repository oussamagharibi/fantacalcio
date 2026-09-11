import { useEffect, useMemo, useState } from 'react';
import { getGiornata, postGiornata } from './api.js';
import { BadgeGiocatore } from './Badge.jsx';
import { dollari, token } from './consumo.js';
import { ETICHETTE_RISCHIO, MODIFICATORE_MAX, MODIFICATORE_MIN_D, OPZIONI_MODULO, conModificatore, esclusi, moduloDiRiferimento, verifica } from './giornata.js';

/** "Analizza la giornata": il secondo parere su chi schierare.
 *
 *  La formazione consigliata qui sopra la calcola l'applicazione da sola, con
 *  criteri che si possono leggere. Questa la chiede a Claude, che vede anche
 *  quello che un punteggio non sa mettere in fila: quattro fonti che
 *  litigano su un infortunio, un ballottaggio, un avversario che non prende
 *  gol. Le due si guardano insieme, e quando non sono d'accordo si capisce
 *  perche'.
 *
 *  Parte solo quando si preme. */

const dataOra = (s) => new Date(s).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Rilievi({ v }) {
  if (!v.rilievi.length)
    return (
      <p className="muted gio-controlli ok">
        Controllato: undici giocatori, reparti giusti per il modulo, nessuno schierato che risulti fuori.
      </p>
    );
  return (
    <ul className="gio-controlli">
      {v.rilievi.map((r, i) => (
        <li key={i} className={r.gravita}>
          <span className="gio-segno">{r.gravita === 'errore' ? '✕' : '!'}</span>
          {r.testo}
        </li>
      ))}
    </ul>
  );
}

function Undici({ a, dati }) {
  const perReparto = useMemo(() => {
    const g = { P: [], D: [], C: [], A: [] };
    for (const x of a.undici) (g[x.ruolo] ??= []).push(x);
    return g;
  }, [a.undici]);
  return (
    <ul className="gio-undici">
      {['P', 'D', 'C', 'A'].map((ruolo) =>
        perReparto[ruolo]?.length ? (
          <li key={ruolo}>
            <span className="gio-reparto">{ruolo}</span>
            <ul>
              {perReparto[ruolo].map((g) => {
                const d = dati.find((x) => x.id === g.id);
                return (
                  <li key={g.id}>
                    <BadgeGiocatore nome={g.nome} ruolo={g.ruolo} size={20} />
                    <strong>{g.nome}</strong>
                    <span className="muted">{g.squadra}</span>
                    {d?.prossimo && (
                      <span className="muted gio-contro">
                        {d.prossimo.incasa ? 'vs' : '@'} {d.prossimo.avversario}
                      </span>
                    )}
                    {g.motivo && <span className="gio-motivo">{g.motivo}</span>}
                  </li>
                );
              })}
            </ul>
          </li>
        ) : null
      )}
    </ul>
  );
}

function Analisi({ a, dati }) {
  const v = useMemo(() => verifica(a, dati), [a, dati]);
  const fuori = useMemo(() => esclusi(a, dati), [a, dati]);
  const rif = moduloDiRiferimento(a);
  const conMod = v.modificatoreInCampo;

  return (
    <div className="gio-analisi">
      <div className="sq-modulo-testa">
        <h4>
          {moduloDiRiferimento(a) ?? a.moduloDichiarato ?? '—'}
          <span className="muted"> · {a.moduloScelto ? 'modulo scelto da te' : 'modulo scelto da Claude'}</span>
          {a.giornata && <span className="muted"> · giornata {a.giornata}</span>}
        </h4>
        <span className="muted">
          {dataOra(a.created_at)} · {token(a.input_tokens)} token in, {token(a.output_tokens)} out ·{' '}
          {a.costo === null ? 'costo non calcolabile' : dollari(a.costo)}
        </span>
      </div>

      <p className={`gio-mod ${conMod ? 'si' : 'no'}`}>
        {conMod
          ? `Modificatore attivo: ${v.conta.D} difensori in campo, quindi portiere piu' i 3 migliori valgono fino a +${MODIFICATORE_MAX}.`
          : `Niente modificatore: ${v.conta.D} difensori in campo, sotto i ${MODIFICATORE_MIN_D} che servono. Rinunci a un bonus che arriva a +${MODIFICATORE_MAX}.`}
        {rif && v.scelto && <span className="muted"> Modulo {rif}, scelto da te.</span>}
      </p>
      {a.perche_modulo && <p className="gio-perche">{a.perche_modulo}</p>}

      <Rilievi v={v} />

      <h5>1 · L'undici consigliato</h5>
      <Undici a={a} dati={dati} />

      <h5>2 · La panchina, in ordine di probabilita' di entrare</h5>
      <ol className="gio-panchina">
        {a.panchina.map((g) => (
          <li key={g.id}>
            <BadgeGiocatore nome={g.nome} ruolo={g.ruolo} size={18} />
            <strong>{g.nome}</strong>
            <span className="muted">{g.squadra}</span>
            {g.perche && <span className="gio-motivo">{g.perche}</span>}
          </li>
        ))}
        {!a.panchina.length && <li className="muted">nessuna indicazione</li>}
      </ol>

      <h5>3 · I ballottaggi aperti</h5>
      {a.ballottaggi.length ? (
        <ul className="gio-ballo">
          {a.ballottaggi.map((b, i) => (
            <li key={i}>
              <strong>{b.nome}</strong>
              {b.con && <span className="muted"> contro {b.con}</span>}
              <span className="gio-ramo ok">se gioca: {b.seGioca ?? '—'}</span>
              <span className="gio-ramo no">se non gioca: {b.seNonGioca ?? '—'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nessun ballottaggio aperto fra i miei.</p>
      )}

      <h5>4 · I rischi</h5>
      {a.rischi.length ? (
        <ul className="gio-rischi">
          {a.rischi.map((r, i) => (
            <li key={i}>
              <span className={`chip gio-tipo ${r.tipo ?? ''}`}>{ETICHETTE_RISCHIO[r.tipo] ?? r.tipo ?? 'rischio'}</span>
              <strong>{r.nome}</strong>
              <span>{r.perche}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nessun rischio segnalato.</p>
      )}

      {/* Chi non compare da nessuna parte. Un infortunato escluso e' giusto,
          un titolare dimenticato no, e la differenza si vede solo guardando. */}
      {fuori.length > 0 && (
        <p className="muted gio-esclusi">
          Fuori da undici e panchina ({fuori.length}):{' '}
          {fuori.map((g) => `${g.nome}${g.perche === 'fuori' ? ' (risulta fuori)' : g.perche === 'incerto' ? ' (in dubbio)' : ''}`).join(', ')}.
        </p>
      )}

      {a.datiMancanti.length > 0 && (
        <p className="avviso">
          Dati che sarebbero serviti e non c'erano: {a.datiMancanti.join('; ')}.
        </p>
      )}
      {a.scartate.length > 0 && (
        <p className="avviso">
          Scartate {a.scartate.length} voci con nomi non in rosa: {a.scartate.map((s) => s.motivo).join('; ')}.
        </p>
      )}
      {a.classificaMotivo && (
        <p className="muted gio-esclusi">
          Classifica di Serie A non usata: {a.classificaMotivo}. Gli avversari non sono stati pesati.
        </p>
      )}
      {a.classifica && (
        <p className="muted gio-esclusi">
          Avversari pesati sulla classifica SportCodex del{' '}
          {new Date(a.classifica.aggiornataIl).toLocaleString('it-IT')} ({a.classifica.righe.length} squadre).
        </p>
      )}
    </div>
  );
}

export default function Giornata({ onAvviso }) {
  const [d, setD] = useState(null);
  const [aperta, setAperta] = useState(null);
  const [modulo, setModulo] = useState('');
  const [fase, setFase] = useState(null);
  const [errore, setErrore] = useState(null);

  useEffect(() => {
    let vivo = true;
    getGiornata()
      .then((x) => {
        if (!vivo) return;
        setD(x);
        setAperta(x.analisi[0]?.id ?? null);
      })
      .catch((e) => vivo && setErrore(e.message));
    return () => {
      vivo = false;
    };
  }, []);

  async function analizza() {
    setErrore(null);
    setFase('raccolgo i dati e chiedo a Claude…');
    try {
      const r = await postGiornata(modulo ? { modulo } : {});
      const x = await getGiornata();
      setD(x);
      setAperta(r.id);
      onAvviso?.(
        `Analisi della giornata fatta: ${r.analisi?.modulo ?? 'modulo n/d'}, ${
          r.consumo.costo === null ? 'costo non calcolabile' : dollari(r.consumo.costo)
        }.` + (r.classifica.ok ? '' : ` Classifica non disponibile: ${r.classifica.motivo}`)
      );
    } catch (e) {
      setErrore(e.message);
    } finally {
      setFase(null);
    }
  }

  if (!d && !errore) return null;

  const corrente = d?.analisi.find((a) => a.id === aperta) ?? null;
  const scelta = OPZIONI_MODULO.find((o) => o.valore === modulo) ?? OPZIONI_MODULO[0];

  return (
    <section className="pannello">
      <div className="sq-modulo-testa">
        <h3>Analizza la giornata</h3>
        <span className="muted">il secondo parere, con i dati dell'archivio e la forza degli avversari</span>
      </div>

      {/* Il modulo si sceglie PRIMA, e accanto a ognuno c'e' scritto se
          attiva il modificatore: il costo della scelta si vede mentre la si
          fa, non dopo averla fatta. */}
      <div className="gio-scelta">
        <label htmlFor="gio-modulo">Modulo</label>
        <select id="gio-modulo" value={modulo} onChange={(e) => setModulo(e.target.value)} disabled={!!fase}>
          {OPZIONI_MODULO.map((o) => (
            <option key={o.valore} value={o.valore}>
              {o.etichetta} — {o.nota}
            </option>
          ))}
        </select>
        <span className={`gio-costo ${scelta.modificatore === null ? '' : scelta.modificatore ? 'si' : 'no'}`}>
          {scelta.modificatore === null
            ? 'Claude sceglie il modulo migliore e spiega perche'
            : scelta.modificatore
              ? `${scelta.difensori} difensori: modificatore attivo, fino a +${MODIFICATORE_MAX}`
              : `${scelta.difensori} difensori: rinunci al modificatore, fino a +${MODIFICATORE_MAX} che non prendi`}
        </span>
      </div>

      <div className="foto-comandi">
        <button className="bottone primario" onClick={analizza} disabled={!!fase}>
          {modulo ? `Analizza la giornata nel ${modulo}` : 'Analizza la giornata'}
        </button>
        {fase && <span className="muted">{fase}</span>}
        {!fase && d?.stima && (
          <span className="muted">
            stima: {token(d.stima.tokenInput)} token in, ~{token(d.stima.tokenOutput)} out ·{' '}
            {d.stima.dollari === null ? 'costo non stimabile' : `~${dollari(d.stima.dollari)}`}
          </span>
        )}
      </div>

      {/* Quello che manca si dice PRIMA di premere: e' la differenza fra un
          consiglio dato su dati parziali e un consiglio che sembra completo. */}
      {d?.buchi?.length > 0 && (
        <p className="avviso">
          Prima di premere, sappi cosa manca in archivio: {d.buchi.join('; ')}.
        </p>
      )}
      {d?.classifica && (
        <p className="muted gio-esclusi">
          {d.classifica.ok
            ? `Classifica Serie A in archivio: ${d.classifica.squadre} squadre, aggiornata al ${new Date(d.classifica.aggiornataIl).toLocaleString('it-IT')}.`
            : `Classifica Serie A: ${d.classifica.motivo}`}
        </p>
      )}
      {errore && <p className="errore">{errore}</p>}

      {d?.analisi?.length > 0 && (
        <div className="foto-archivio">
          <div className="foto-date">
            <span className="muted">Giornate analizzate:</span>
            {d.analisi.map((a) => (
              <button
                key={a.id}
                className={`bottone piccolo${a.id === aperta ? ' primario' : ''}`}
                onClick={() => setAperta(a.id)}
              >
                {a.giornata ? `g${a.giornata}` : dataOra(a.created_at)}
                <span className="muted">
                  {' '}
                  · {moduloDiRiferimento(a) ?? '?'}
                  {a.moduloScelto ? ' (tuo)' : ''}
                </span>
              </button>
            ))}
          </div>
          {/* I dati sono quelli salvati con l analisi, non quelli di oggi:
              un consiglio si ricontrolla su cio che si sapeva allora. */}
          {corrente && <Analisi a={corrente} dati={corrente.dati} />}
        </div>
      )}
    </section>
  );
}
