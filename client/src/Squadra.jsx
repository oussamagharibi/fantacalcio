import { useMemo, useState } from 'react';
import { BadgeGiocatore, BadgeSquadra } from './Badge.jsx';
import { ChipRigorista, ChipParaRigori } from './Chips.jsx';
import Foto from './Foto.jsx';
import Gestione from './Gestione.jsx';
import { RUOLI as RUOLI_NOMI } from './squadre.js';
import { postRosa } from './api.js';
import {
  RUOLI,
  allarmi,
  disponibile,
  formazioni,
  panchina,
  perReparto,
  prossimoTurno,
  rosa as costruisciRosa,
  spesaPerReparto,
  SOSTITUZIONI,
  TITOLARITA_BASSA,
} from './squadra.js';

/** La mia squadra, a stagione cominciata.
 *
 *  L'asta e' finita: da qui in poi la domanda non e' piu' "quanto lo pago" ma
 *  "chi schiero domenica". Percio' gli allarmi stanno in cima - servono a
 *  decidere, non a informare - e la formazione consigliata mostra i conti da
 *  cui esce, invece di limitarsi al verdetto. */

const pct = (x) => (x === null || x === undefined ? '—' : `${x}%`);
const num = (x) => (x === null || x === undefined ? '—' : x);

const SEGNI = { infortunio: '✕', squalifica: '✕', dubbio: '?', titolarita: '↓', ballottaggio: '⟷' };

function Allarmi({ lista, onApri }) {
  if (!lista.length)
    return (
      <p className="muted sq-nessun-allarme">
        Nessun allarme: nessuno dei tuoi e' indisponibile, sotto il {TITOLARITA_BASSA}% di titolarita' o in
        ballottaggio.
      </p>
    );
  return (
    <ul className="sq-allarmi">
      {lista.map((a, i) => (
        <li key={`${a.g.id}-${a.tipo}-${i}`} className={`sq-allarme g${a.gravita}`}>
          <span className="sq-segno">{SEGNI[a.tipo] ?? '!'}</span>
          <button className="link-nome" onClick={() => onApri?.(a.g.id)}>
            {a.g.nome}
          </button>
          <span className="muted">{a.g.squadra}</span>
          <span className="sq-allarme-testo">{a.testo}</span>
          {a.fonti.length > 0 && <span className="muted sq-fonti">{[...new Set(a.fonti)].join(' · ')}</span>}
        </li>
      ))}
    </ul>
  );
}

function Riga({ g, onApri, onModifica }) {
  return (
    <li className={`sq-riga${disponibile(g) ? '' : ' fuori'}`}>
      <BadgeGiocatore nome={g.nome} ruolo={g.ruolo} size={24} />
      <button className="link-nome sq-nome" onClick={() => onApri?.(g.id)}>
        {g.nome}
      </button>
      <span className="sq-squadra">
        <BadgeSquadra nome={g.squadra} size={15} titolo={false} /> {g.squadra}
      </span>
      <span className="sq-prezzo" title="prezzo pagato">
        {g.prezzo}
      </span>
      <span className={`sq-tit${g.titolarita !== null && g.titolarita < TITOLARITA_BASSA ? ' basso' : ''}`} title="titolarita' stimata">
        {pct(g.titolarita)}
      </span>
      <span className="sq-fm" title="fantamedia storica">
        {num(g.fm)}
      </span>
      <span className="sq-mv" title="media voto storica">
        {num(g.mv)}
      </span>
      <span className="sq-chip">
        <ChipRigorista g={g.g} />
        <ChipParaRigori g={g.g} />
        {(g.indisponibile ?? []).map((x) => (
          <span key={x.tipo} className="chip inf" title={x.righe[0]?.testo}>
            {x.etichetta.toLowerCase()}
          </span>
        ))}
      </span>
      <button className="sq-modifica" onClick={() => onModifica(g)} title="cambia prezzo o togli dalla rosa">
        ⋯
      </button>
    </li>
  );
}

/** La correzione a mano: svincoli e scambi durante la stagione.
 *  Sta in un pannello che si apre e non in una riga sempre visibile: si usa di
 *  rado, e un campo prezzo modificabile accanto a ogni giocatore invita a
 *  toccare per sbaglio quello che si e' pagato davvero. */
function Modifica({ g, stato, onChiudi, onStato, onAvviso }) {
  const [prezzo, setPrezzo] = useState(String(g?.prezzo ?? ''));
  const [cerca, setCerca] = useState('');
  const [inCorso, setInCorso] = useState(false);

  const candidati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    if (q.length < 3) return [];
    const inRosa = new Set(stato.rosa.presi.map((p) => p.player_id));
    return stato.giocatori
      .filter((x) => !x.assente_dal && !inRosa.has(x.id) && x.nome.toLowerCase().includes(q))
      .slice(0, 8);
  }, [cerca, stato]);

  async function agisci(corpo, messaggio) {
    setInCorso(true);
    try {
      onStato(await postRosa(corpo));
      onAvviso(messaggio);
      onChiudi();
    } catch (e) {
      onAvviso(e.message, 'ko');
    } finally {
      setInCorso(false);
    }
  }

  return (
    <div className="sq-modifica-pannello">
      {g ? (
        <>
          <h4>{g.nome}</h4>
          <div className="riga">
            <label>
              Prezzo pagato
              <input inputMode="numeric" value={prezzo} onChange={(e) => setPrezzo(e.target.value.replace(/[^0-9]/g, ''))} />
            </label>
            <button
              className="bottone"
              disabled={inCorso || prezzo === ''}
              onClick={() => agisci({ playerId: g.id, prezzo: Number(prezzo) }, `${g.nome} ora vale ${prezzo}`)}
            >
              Salva prezzo
            </button>
            <button
              className="bottone neutro"
              disabled={inCorso}
              onClick={() => agisci({ playerId: g.id, rimuovi: true }, `${g.nome} svincolato`)}
            >
              Svincola
            </button>
            <button className="bottone neutro" onClick={onChiudi}>
              Annulla
            </button>
          </div>
        </>
      ) : (
        <>
          <h4>Aggiungi alla rosa</h4>
          <div className="riga">
            <input
              className="cerca-listone"
              value={cerca}
              onChange={(e) => setCerca(e.target.value)}
              placeholder="cerca per nome (3 lettere)"
              autoFocus
            />
            <label>
              Prezzo
              <input inputMode="numeric" value={prezzo} onChange={(e) => setPrezzo(e.target.value.replace(/[^0-9]/g, ''))} />
            </label>
            <button className="bottone neutro" onClick={onChiudi}>
              Chiudi
            </button>
          </div>
          <ul className="sq-candidati">
            {candidati.map((c) => (
              <li key={c.id}>
                <BadgeGiocatore nome={c.nome} ruolo={c.ruolo} size={22} />
                <strong>{c.nome}</strong>
                <span className="muted">
                  {c.squadra} · {c.ruolo} · Qt {c.quotazione}
                </span>
                <span className="spazio" />
                <button
                  className="bottone"
                  disabled={inCorso || prezzo === ''}
                  onClick={() => agisci({ playerId: c.id, prezzo: Number(prezzo) }, `${c.nome} aggiunto a ${prezzo}`)}
                >
                  Aggiungi
                </button>
              </li>
            ))}
            {cerca.trim().length >= 3 && candidati.length === 0 && (
              <li className="muted">Nessun giocatore libero con questo nome.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function Modificatore({ m }) {
  if (!m.attivo)
    return (
      <span className="sq-mod spento" title={m.motivo}>
        modificatore non attivo
      </span>
    );
  if (m.punti === null)
    return (
      <span className="sq-mod incerto" title={m.motivo}>
        modificatore non stimabile
      </span>
    );
  return (
    <span className={`sq-mod${m.punti >= 3 ? ' forte' : ''}`} title={`${m.gruppo.map((g) => `${g.nome} ${g.mv}`).join(' + ')} = ${m.media}`}>
      modificatore +{m.punti} <span className="muted">(MV {m.media})</span>
    </span>
  );
}

function Modulo({ f, consigliato, incerto, onApri }) {
  const [aperto, setAperto] = useState(false);
  return (
    <li className={`sq-modulo${consigliato ? ' consigliato' : ''}${f.completa ? '' : ' incompleta'}`}>
      <div className="sq-modulo-testa">
        <strong className="sq-modulo-nome">{f.modulo}</strong>
        {/* Quando il modificatore non si puo stimare, "consigliato" direbbe
            piu di quanto si sa: e il migliore sui dati che ci sono, e i dati
            che mancano sono proprio quelli che deciderebbero. */}
        {consigliato && (
          <span className={`chip ${incerto ? '' : 'on'}`}>
            {incerto ? 'il migliore sui dati che ho' : 'consigliato'}
          </span>
        )}
        <Modificatore m={f.modificatore} />
        <span className="spazio" />
        <span className="sq-punteggio" title="somma delle fantamedie dell'undici, piu' il modificatore">
          {f.sommaFm}
          {f.bonus > 0 && <span className="sq-bonus"> +{f.bonus}</span>}
          <strong> = {f.totale}</strong>
        </span>
        <button className="nota-toggle" onClick={() => setAperto((x) => !x)}>
          {aperto ? '▾' : '▸'}
        </button>
      </div>
      {!f.completa && (
        <p className="avviso">
          Non hai abbastanza giocatori disponibili:{' '}
          {f.mancanti.map((x) => `${RUOLI_NOMI[x.ruolo].nome} ${x.ho}/${x.servono}`).join(', ')}.
        </p>
      )}
      <div className="sq-undici">
        {f.undici.map((g) => (
          <button key={g.id} className="sq-slot" onClick={() => onApri?.(g.id)} data-ruolo={g.ruolo}>
            <span className="sq-slot-nome">{g.nome}</span>
            <span className="muted">{pct(g.titolarita)}</span>
          </button>
        ))}
      </div>
      {aperto && (
        <div className="sq-dettaglio">
          {f.modificatore.attivo && f.modificatore.media !== null && (
            <p className="muted">
              Difesa: {f.modificatore.gruppo.map((g) => `${g.nome} ${g.mv}`).join(' + ')} → media{' '}
              <strong>{f.modificatore.media}</strong> → {f.modificatore.fascia.etichetta} ={' '}
              <strong>+{f.modificatore.punti}</strong>
            </p>
          )}
          {f.modificatore.motivo && <p className="avviso">{f.modificatore.motivo}</p>}
          <p className="muted">
            Esclusi: {f.esclusi.map((g) => g.nome).join(', ') || 'nessuno'}
          </p>
        </div>
      )}
    </li>
  );
}

export default function Squadra({ stato, onStato, onApri, onAvviso }) {
  const [modifica, setModifica] = useState(null); // { g } oppure { g: null } per "aggiungi"

  const r = useMemo(() => costruisciRosa(stato), [stato]);
  const gruppi = useMemo(() => perReparto(r), [r]);
  const spesa = useMemo(() => spesaPerReparto(r), [r]);
  const avvisi = useMemo(() => allarmi(r), [r]);
  const f = useMemo(() => formazioni(r), [r]);
  const bench = useMemo(() => (f.consigliato ? panchina(r, f.consigliato.undici) : []), [r, f]);
  const turno = useMemo(() => prossimoTurno(r, stato.partite), [r, stato.partite]);

  if (!r.length)
    return (
      <main className="wrap">
        <h2>La mia squadra</h2>
        <p className="muted">
          Nessun giocatore in rosa. Caricala con <code>npm run carica-rosa</code> da <code>data/rosa.json</code>, oppure
          aggiungili uno per uno qui sotto.
        </p>
        <button className="bottone" onClick={() => setModifica({ g: null })}>
          Aggiungi un giocatore
        </button>
        {modifica && (
          <Modifica g={null} stato={stato} onChiudi={() => setModifica(null)} onStato={onStato} onAvviso={onAvviso} />
        )}
      </main>
    );

  const cd = f.confrontoDifesa;

  return (
    <main className="wrap largo sq">
      <header className="sq-testa">
        <h2>La mia squadra — {stato.rosa.squadra}</h2>
        <span className="muted">
          {r.length} giocatori · {spesa.totale} crediti su {stato.rosa.budget}
          {stato.rosa.budget - spesa.totale !== 0 && <> · {stato.rosa.budget - spesa.totale} non spesi</>}
        </span>
      </header>

      {/* Il prossimo turno in cima a tutto: e la prima domanda della
          settimana. La sezione non c e se il calendario non c e - lo si
          aggiorna dalle fonti, non lo si inventa. */}
      {turno && (
        <section className="pannello">
          <div className="sq-modulo-testa">
            <h3>Prossimo turno</h3>
            <span className="muted">
              giornata {turno.giornata} · {turno.disponibili} dei tuoi {turno.quanti} in campo
              {turno.quanti !== turno.disponibili && (
                <> ({turno.quanti - turno.disponibili} indisponibil{turno.quanti - turno.disponibili === 1 ? 'e' : 'i'})</>
              )}
            </span>
          </div>
          <ul className="sq-turno">
            {turno.perPartita.map(({ partita, miei }) => (
              <li key={partita.id}>
                <span className="sq-partita">
                  <strong>{partita.casa}</strong>
                  <span className="muted">-</span>
                  <strong>{partita.ospite}</strong>
                </span>
                <span className="sq-miei">
                  {miei.map((g) => (
                    <button
                      key={g.id}
                      className={`sq-in-campo${disponibile(g) ? '' : ' fuori'}`}
                      data-ruolo={g.ruolo}
                      onClick={() => onApri?.(g.id)}
                      title={`${g.casa ? 'in casa contro' : 'in trasferta contro'} ${g.avversario}`}
                    >
                      {g.nome}
                      <span className="muted">{g.casa ? ' (C)' : ' (T)'}</span>
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {turno.senzaPartita.length > 0 && (
            <p className="avviso">
              Non giocano in questa giornata: {turno.senzaPartita.map((g) => g.nome).join(', ')}.
            </p>
          )}
          <p className="muted sq-fonte-turno">
            (C) in casa, (T) in trasferta · dal calendario delle probabili formazioni
          </p>
        </section>
      )}

      {/* Gli allarmi in cima: sono la ragione per cui si apre questa pagina. */}
      <section className="pannello">
        <h3>Allarmi</h3>
        <Allarmi lista={avvisi} onApri={onApri} />
      </section>

      <section className="pannello">
        <div className="sq-modulo-testa">
          <h3>Formazione consigliata</h3>
          <span className="spazio" />
          <button className="bottone neutro" onClick={() => setModifica({ g: null })}>
            Aggiungi un giocatore
          </button>
        </div>

        {/* Il confronto che decide: tre difensori contro quattro. Sta fuori dal
            punteggio perche' sei punti di modificatore non si vedono, dentro
            una somma di fantamedie. */}
        {cd && (
          <p className={`sq-confronto${cd.incerto ? ' incerto' : ''}`}>
            <strong>{cd.tre.modulo}</strong> (tre difensori) rende{' '}
            <strong>
              {cd.differenzaFm > 0 ? '+' : ''}
              {cd.differenzaFm}
            </strong>{' '}
            di fantamedia rispetto a <strong>{cd.quattro.modulo}</strong>, ma rinuncia al modificatore di difesa.{' '}
            {cd.incerto ? (
              <>
                Quanto valga non si puo' dire: manca la media voto di {cd.nomiSenzaMv.join(', ')}. Il modificatore vale
                fino a +6, quindi il confronto qui sopra e' incompleto e non basta a scegliere.
              </>
            ) : (
              <>
                Con {cd.quattro.modulo} il modificatore vale <strong>+{cd.modificatoreInGioco}</strong>:{' '}
                {cd.modificatoreInGioco > cd.differenzaFm
                  ? 'conviene comunque schierare quattro difensori.'
                  : 'i tre difensori restano avanti anche contando il modificatore.'}
              </>
            )}
          </p>
        )}

        <ul className="sq-moduli">
          {f.ordinate.map((x) => (
            <Modulo
              key={x.modulo}
              f={x}
              consigliato={x === f.consigliato}
              incerto={!!cd?.incerto && !x.modificatore.attivo}
              onApri={onApri}
            />
          ))}
        </ul>

        {f.perche && (
          <p className="muted">
            {f.consigliato.modulo} sta davanti a {f.perche.contro} di {f.perche.differenza} punti:{' '}
            {f.perche.daFm} dai giocatori, {f.perche.daModificatore} dal modificatore.
          </p>
        )}
      </section>

      <section className="pannello">
        <h3>
          Panchina <span className="muted">— primi {SOSTITUZIONI} per probabilita' di entrare</span>
        </h3>
        <ul className="sq-panchina">
          {bench.map((g, i) => (
            <li key={g.id} className={g.entraProbabile ? 'probabile' : ''}>
              <span className="sq-ordine">{i + 1}</span>
              <BadgeGiocatore nome={g.nome} ruolo={g.ruolo} size={22} />
              <button className="link-nome" onClick={() => onApri?.(g.id)}>
                {g.nome}
              </button>
              <span className="muted">{pct(g.titolarita)}</span>
              <span className="muted">fm {num(g.fm)}</span>
              {!disponibile(g) && <span className="chip inf">indisponibile</span>}
            </li>
          ))}
        </ul>
      </section>

      {/* Analisi da foto: sta dopo la panchina perche risponde alla stessa
          domanda - chi gioca domenica - e prima della gestione, che guarda
          al mercato invece che al turno. */}
      <Foto rosa={r} onApri={onApri} onStato={onStato} onAvviso={onAvviso} />

      {/* Gestione rosa: sta dopo la formazione perche si legge dopo aver
          visto chi gioca, e prima della spesa perche la spesa e uno dei suoi
          ingredienti. */}
      <Gestione rosa={r} formazione={f.consigliato} onApri={onApri} />

      <section className="pannello">
        <h3>Spesa per reparto</h3>
        <ul className="sq-spesa">
          {spesa.perRuolo.map((x) => (
            <li key={x.ruolo}>
              <span className="punto" style={{ background: RUOLI_NOMI[x.ruolo].colore }} />
              <strong>{RUOLI_NOMI[x.ruolo].nome}</strong>
              <span className="muted">{x.quanti}</span>
              <span className="sq-barra">
                <i style={{ width: `${x.percentuale}%`, background: RUOLI_NOMI[x.ruolo].colore }} />
              </span>
              <strong className="sq-cr">{x.spesa}</strong>
              <span className="muted">{x.percentuale}%</span>
              {x.piuCaro && (
                <span className="muted sq-caro">
                  piu' caro: {x.piuCaro.nome} a {x.piuCaro.prezzo}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {modifica && (
        <Modifica
          g={modifica.g}
          stato={stato}
          onChiudi={() => setModifica(null)}
          onStato={onStato}
          onAvviso={onAvviso}
        />
      )}

      {RUOLI.map((ruolo) => (
        <section className="pannello" key={ruolo}>
          <h3>
            {RUOLI_NOMI[ruolo].nome} <span className="muted">— {gruppi[ruolo].length}</span>
          </h3>
          <ul className="sq-lista">
            <li className="sq-riga intestazione">
              <span />
              <span className="sq-nome">Nome</span>
              <span className="sq-squadra">Squadra</span>
              <span className="sq-prezzo">Cr</span>
              <span className="sq-tit">Tit.</span>
              <span className="sq-fm">FM</span>
              <span className="sq-mv">MV</span>
              <span className="sq-chip" />
              <span />
            </li>
            {gruppi[ruolo]
              .slice()
              .sort((a, b) => b.prezzo - a.prezzo)
              .map((g) => (
                <Riga key={g.id} g={g} onApri={onApri} onModifica={(x) => setModifica({ g: x })} />
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
