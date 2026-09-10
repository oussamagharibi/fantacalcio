import { useEffect, useMemo, useRef, useState } from 'react';
import { getConsumo, getFoto, postConfermaFoto, postFoto } from './api.js';
import { dollari, token } from './consumo.js';
import { preparaFoto } from './ridimensiona.js';
import {
  ESTENSIONI,
  LATO_MASSIMO,
  MAX_FOTO,
  STATI,
  accetta,
  compaiono,
  gia,
  nonCompaiono,
  ordina,
  prezzoDi,
  stima,
} from './foto.js';

/** Analisi da foto: quello che i parser non arrivano a leggere.
 *
 *  Le probabili girano anche dove non si scaricano - una storia, uno
 *  screenshot in un gruppo, un sito che il robots.txt vieta. Quella roba e'
 *  un'immagine, e l'unico modo di leggerla e' guardarla.
 *
 *  Resta un'estrazione da foto, meno affidabile di un parser che legge il
 *  markup: niente va nei segnali da solo. Ogni voce ha la sua immagine
 *  accanto e il suo pulsante, e diventa un segnale quando lo si preme. */

const MODELLO = 'claude-sonnet-5';

const kb = (b) => `${Math.round(b / 1024)} KB`;

function Anteprima({ f, onTogli }) {
  return (
    <li className="foto-cella">
      <img src={f.anteprima} alt={f.nome} loading="lazy" />
      <button className="foto-x" onClick={() => onTogli(f)} title={`Togli ${f.nome}`} aria-label={`Togli ${f.nome}`}>
        ×
      </button>
      <span className="foto-didascalia" title={f.nome}>
        <strong>{f.nome}</strong>
        <span className="muted">
          {f.larghezza}×{f.altezza} · {kb(f.byte)}
        </span>
        {f.ridimensionata && (
          <span className="muted" title={`era ${f.larghezzaOriginale}×${f.altezzaOriginale}`}>
            ridotta da {Math.max(f.larghezzaOriginale, f.altezzaOriginale)}px
          </span>
        )}
      </span>
    </li>
  );
}

/** Una riga per giocatore. L'immagine da cui viene sta scritta accanto, non in
 *  fondo: e' la sola cosa che permette di controllare quello che si sta per
 *  confermare senza rileggere tutto. */
function Voce({ v, confermata, cartella, immagini, occupato, onApri, onConferma }) {
  const s = STATI[v.stato] ?? null;
  const img = v.immagine && immagini[v.immagine - 1];
  return (
    <li className={`foto-voce${confermata ? ' presa' : ''}`}>
      <button className="link-nome" onClick={() => onApri?.(v.player_id)}>
        {v.nome}
      </button>
      <span className="muted foto-dove">
        {v.ruolo} · {v.squadra}
      </span>
      {s && <span className={`chip foto-stato ${s.classe}`}>{s.etichetta}</span>}
      <span className="foto-nota">{v.nota ?? <span className="muted">—</span>}</span>
      {img ? (
        <a className="foto-fonte" href={`/api/foto/${cartella}/${img.file}`} target="_blank" rel="noreferrer">
          <img src={`/api/foto/${cartella}/${img.file}`} alt={`immagine ${v.immagine}`} loading="lazy" />
          <span className="muted">#{v.immagine}</span>
        </a>
      ) : (
        <span className="muted foto-fonte vuota">—</span>
      )}
      {v.segnale ? (
        <button
          className={`bottone piccolo${confermata ? ' fatto' : ''}`}
          disabled={occupato}
          onClick={() => onConferma(v, confermata)}
          title={
            confermata
              ? `Toglie il segnale "${v.segnale.tipo}" scritto da qui`
              : `Scrive nei segnali: ${v.segnale.tipo} — ${v.segnale.testo}`
          }
        >
          {confermata ? '✓ confermato' : `conferma ${v.segnale.tipo}`}
        </button>
      ) : (
        <span className="muted foto-niente">niente da confermare</span>
      )}
    </li>
  );
}

function Analisi({ a, occupato, confermati, onApri, onConferma }) {
  const voci = useMemo(() => ordina(compaiono(a.voci)), [a.voci]);
  const assenti = useMemo(() => nonCompaiono(a.voci), [a.voci]);
  return (
    <div className="foto-analisi">
      <div className="sq-modulo-testa">
        <h4>{new Date(a.created_at).toLocaleString('it-IT')}</h4>
        <span className="muted">
          {a.quante} immagini · {token(a.input_tokens)} token in, {token(a.output_tokens)} out ·{' '}
          {a.costo === null ? 'costo non calcolabile' : dollari(a.costo)}
        </span>
      </div>

      {/* Un'immagine illeggibile va detta: e' la differenza fra "non c'e'
          niente su di lui" e "non si e' potuto guardare". */}
      {a.illeggibili.length > 0 && (
        <p className="avviso">
          {a.illeggibili.length === 1 ? 'Un\'immagine non si e\' potuta leggere' : `${a.illeggibili.length} immagini non si sono potute leggere`}:{' '}
          {a.illeggibili.map((x) => `#${x.immagine ?? '?'} (${x.motivo})`).join(', ')}. Quello che c'era dentro non
          risulta da nessuna parte qui sotto.
        </p>
      )}

      {a.riassunto && <p className="foto-riassunto">{a.riassunto}</p>}

      <ul className="foto-voci">
        {voci.map((v) => (
          <Voce
            key={v.player_id}
            v={v}
            confermata={gia(confermati, v)}
            cartella={a.cartella}
            immagini={a.immagini}
            occupato={occupato}
            onApri={onApri}
            onConferma={onConferma}
          />
        ))}
      </ul>

      {assenti.length > 0 && (
        <p className="muted foto-assenti">
          Non compaiono in nessuna immagine ({assenti.length}): {assenti.map((v) => v.nome).join(', ')}.
        </p>
      )}

      {a.scartate.length > 0 && (
        <p className="muted foto-assenti">
          Scartate {a.scartate.length}: {a.scartate.map((s) => s.motivo).join('; ')}.
        </p>
      )}
    </div>
  );
}

export default function Foto({ rosa, onApri, onStato, onAvviso }) {
  const [foto, setFoto] = useState([]);
  const [rifiutate, setRifiutate] = useState([]);
  const [archivio, setArchivio] = useState([]);
  const [confermati, setConfermati] = useState([]);
  const [tariffe, setTariffe] = useState(null);
  const [fase, setFase] = useState(null);
  const [errore, setErrore] = useState(null);
  const [aperta, setAperta] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    let vivo = true;
    getFoto()
      .then((d) => {
        if (!vivo) return;
        setArchivio(d.analisi);
        setConfermati(d.confermati);
        setAperta(d.analisi[0]?.id ?? null);
      })
      .catch(() => {});
    getConsumo()
      .then((d) => vivo && setTariffe(d.tariffe))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  // Le anteprime sono URL di oggetto: senza revoca restano allocate finche'
  // la scheda non si chiude.
  useEffect(() => () => foto.forEach((f) => URL.revokeObjectURL(f.anteprima)), [foto]);

  const preventivo = useMemo(
    () => stima(foto, rosa.length, prezzoDi(tariffe, MODELLO)),
    [foto, rosa.length, tariffe]
  );

  async function scegli(e) {
    const scelti = [...e.target.files];
    e.target.value = ''; // cosi' si puo' riselezionare lo stesso file
    const { accettate, rifiutate: no } = accetta(foto, scelti);
    setRifiutate(no);
    setErrore(null);
    if (!accettate.length) return;
    setFase(`preparo ${accettate.length} immagini…`);
    try {
      const pronte = [];
      for (const f of accettate) pronte.push(await preparaFoto(f));
      setFoto((x) => [...x, ...pronte]);
    } catch (err) {
      setErrore(`non ho potuto leggere un'immagine: ${err.message}`);
    } finally {
      setFase(null);
    }
  }

  function togli(f) {
    URL.revokeObjectURL(f.anteprima);
    setFoto((x) => x.filter((y) => y !== f));
  }

  async function analizza() {
    setErrore(null);
    setFase(`mando ${foto.length} immagini a Claude…`);
    try {
      const r = await postFoto(foto.map((f) => f.file));
      const d = await getFoto();
      setArchivio(d.analisi);
      setConfermati(d.confermati);
      setAperta(r.id);
      foto.forEach((f) => URL.revokeObjectURL(f.anteprima));
      setFoto([]);
      setRifiutate(r.rifiutate ?? []);
      onAvviso?.(
        `Analisi fatta: ${r.voci.length} voci su ${r.immagini.length} immagini, ${
          r.consumo.costo === null ? 'costo non calcolabile' : dollari(r.consumo.costo)
        }.`
      );
    } catch (err) {
      setErrore(err.message);
    } finally {
      setFase(null);
    }
  }

  async function conferma(v, gia) {
    setFase(gia ? `tolgo ${v.nome}…` : `confermo ${v.nome}…`);
    try {
      const r = await postConfermaFoto({
        playerId: v.player_id,
        tipo: v.segnale.tipo,
        testo: v.segnale.testo,
        ...(gia ? { annulla: true } : {}),
      });
      setConfermati(r.confermati);
      onStato?.(r);
    } catch (err) {
      setErrore(err.message);
    } finally {
      setFase(null);
    }
  }

  const corrente = archivio.find((a) => a.id === aperta) ?? null;

  return (
    <section className="pannello">
      <div className="sq-modulo-testa">
        <h3>Analisi da foto</h3>
        <span className="muted">
          schermate di probabili e notizie, lette da Claude · massimo {MAX_FOTO} per volta
        </span>
      </div>

      <p className="muted">
        Un'estrazione da immagini e' meno affidabile di un parser che legge il markup: niente finisce nei segnali da
        solo. Ogni voce arriva con l'immagine da cui viene, e diventa un segnale quando lo confermi tu.
      </p>

      <div className="foto-comandi">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={scegli}
          hidden
        />
        <button className="bottone" onClick={() => input.current?.click()} disabled={!!fase}>
          Scegli le immagini
        </button>
        {foto.length > 0 && (
          <>
            <button className="bottone primario" onClick={analizza} disabled={!!fase}>
              Analizza {foto.length} {foto.length === 1 ? 'immagine' : 'immagini'}
            </button>
            <button
              className="bottone"
              disabled={!!fase}
              onClick={() => {
                foto.forEach((f) => URL.revokeObjectURL(f.anteprima));
                setFoto([]);
                setRifiutate([]);
              }}
            >
              Svuota
            </button>
          </>
        )}
        {fase && <span className="muted">{fase}</span>}
      </div>

      {/* La stima PRIMA di spendere: e' l'unico momento in cui serve. */}
      {foto.length > 0 && (
        <p className="foto-stima">
          Stima: <strong>{token(preventivo.tokenInput)}</strong> token in (
          {token(preventivo.tokenFoto)} dalle immagini, {token(preventivo.tokenTesto)} dalla rosa di {rosa.length}) e
          circa {token(preventivo.tokenOutput)} out ·{' '}
          <strong>{preventivo.dollari === null ? 'costo non stimabile' : `~${dollari(preventivo.dollari)}`}</strong>
          <span className="muted">
            {' '}
            — e' una stima: il conto vero lo dice l'API a risposta arrivata, e finisce nella tabella dei consumi.
          </span>
        </p>
      )}

      {rifiutate.length > 0 && (
        <p className="avviso">
          Non caricate ({rifiutate.length}): {rifiutate.map((r) => `${r.nome ?? r.nomeFile} — ${r.motivo}`).join('; ')}.
        </p>
      )}
      {errore && <p className="errore">{errore}</p>}

      {foto.length > 0 && (
        <ul className="foto-griglia">
          {foto.map((f) => (
            <Anteprima key={f.anteprima} f={f} onTogli={togli} />
          ))}
        </ul>
      )}

      {foto.length === 0 && archivio.length === 0 && (
        <p className="muted">
          Nessuna analisi ancora. Carica le schermate ({ESTENSIONI}): quelle sopra i {LATO_MASSIMO}px sul lato lungo
          vengono ridotte prima di partire, perche' oltre quella soglia l'API le riduce comunque e i token in piu' si
          pagherebbero per niente.
        </p>
      )}

      {archivio.length > 0 && (
        <div className="foto-archivio">
          <div className="foto-date">
            <span className="muted">Analisi salvate:</span>
            {archivio.map((a) => (
              <button
                key={a.id}
                className={`bottone piccolo${a.id === aperta ? ' primario' : ''}`}
                onClick={() => setAperta(a.id)}
              >
                {new Date(a.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                <span className="muted"> · {a.quante}</span>
              </button>
            ))}
          </div>
          {corrente && (
            <Analisi
              a={corrente}
              confermati={confermati}
              occupato={!!fase}
              onApri={onApri}
              onConferma={conferma}
            />
          )}
        </div>
      )}
    </section>
  );
}
