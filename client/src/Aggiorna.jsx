import { useEffect, useRef, useState } from 'react';
import { postAggiorna, getStatoAggiornamento } from './api.js';

/** Il pulsante "Aggiorna tutto" e l'avanzamento della corsa.
 *
 *  L'operazione dura minuti: una richiesta ogni due secondi per fonte, e le
 *  fonti sono una decina. Percio' il server la lancia e torna subito, e questa
 *  pagina interroga /api/news/stato: una richiesta HTTP che restasse appesa
 *  per minuti verrebbe chiusa dal proxy molto prima della fine.
 *
 *  Quello che conta e' che gli errori si vedano. Una fonte che cade non ferma
 *  le altre - ma se nessuno lo dice, il risultato e' un aggiornamento che
 *  sembra riuscito con dentro un buco. Quindi ogni fonte ha la sua riga, con
 *  il motivo scritto per esteso, e il riepilogo finale conta quante hanno
 *  fallito. */

const SEGNI = {
  attesa: { segno: '·', classe: 'attesa', dice: 'in coda' },
  'in-corso': { segno: '◐', classe: 'corso', dice: 'in corso...' },
  ok: { segno: '✓', classe: 'ok', dice: 'fatto' },
  errore: { segno: '✕', classe: 'ko', dice: 'errore' },
  interrotta: { segno: '⦸', classe: 'interrotta', dice: 'interrotta' },
};

const GRUPPI = {
  segnali: 'Titolarita\' e rigoristi',
  infortuni: 'Infortuni e squalifiche',
  articoli: 'Articoli e feed',
};

/** Cosa sta succedendo adesso. Serve soprattutto all'inizio: prima che la
 *  prima fonte compaia bisogna scoprire gli indirizzi, e sono altre richieste
 *  a due secondi l'una - una decina di secondi in cui, senza questa riga, il
 *  pulsante sarebbe spento e sotto non ci sarebbe niente. */
const FASI = {
  fonti: 'cerco gli indirizzi delle fonti: i feed e l\'articolo di Sky cambiano ogni settimana',
  segnali: 'leggo titolarita\' e rigoristi',
  infortuni: 'leggo infortuni, dubbi, squalifiche e diffide',
  articoli: 'scarico gli articoli dai feed',
  associazione: 'associo gli articoli ai giocatori',
  note: 'genero le note AI',
  fine: 'chiudo e tiro le somme',
};

const ORA = (iso) => (iso ? new Date(iso).toLocaleTimeString('it-IT') : '');

function RigaFonte({ f }) {
  const s = SEGNI[f.stato] ?? SEGNI.attesa;
  return (
    <li className={`agg-fonte ${s.classe}`}>
      <span className="agg-segno">{s.segno}</span>
      <span className="agg-nome">{f.nome}</span>
      {/* Il motivo dell'errore sta sulla riga, non in un log da aprire: e' la
          cosa che si deve leggere senza cercarla. */}
      <span className="agg-dett">{f.errore ? f.errore : (f.dettaglio ?? s.dice)}</span>
    </li>
  );
}

function Note({ note }) {
  if (!note) return null;
  if (note.stato === 'in-corso')
    return (
      <p className="agg-note">
        <span className="agg-segno corso">◐</span> Note AI: {note.fatte} di {note.totali} generate
        {note.fallite > 0 && <> · {note.fallite} fallite</>}
      </p>
    );
  if (note.stato === 'fatta')
    return (
      <p className="agg-note">
        <span className="agg-segno ok">✓</span> Note AI: {note.fatte} generate
        {note.fallite > 0 && <> · {note.fallite} fallite</>}
        {typeof note.costo === 'number' && <> · ${note.costo.toFixed(4)}</>}
      </p>
    );
  if (note.stato === 'niente-da-fare')
    return (
      <p className="agg-note muted">
        <span className="agg-segno attesa">·</span> Note AI: nessun giocatore aveva abbastanza articoli.
      </p>
    );
  return null;
}

export default function Aggiorna({ onFinito }) {
  const [stato, setStato] = useState(null);
  const [errore, setErrore] = useState(null);
  const [logAperto, setLogAperto] = useState(false);
  const timer = useRef(null);
  const eraInCorso = useRef(false);

  const leggi = async () => {
    try {
      const s = await getStatoAggiornamento();
      setStato(s);
      // Appena finita: i segnali e le note sono cambiati sotto i piedi alle
      // altre pagine, quindi lo stato dell'applicazione va riletto.
      if (eraInCorso.current && !s.inCorso) onFinito?.();
      eraInCorso.current = s.inCorso;
      return s;
    } catch (e) {
      setErrore(e.message);
      return null;
    }
  };

  // Alla prima apertura si guarda com'e' messa: puo' esserci una corsa gia'
  // partita, o l'esito di una interrotta da un riavvio.
  useEffect(() => {
    leggi();
    return () => clearInterval(timer.current);
  }, []);

  useEffect(() => {
    clearInterval(timer.current);
    if (!stato?.inCorso) return undefined;
    timer.current = setInterval(leggi, 1000);
    return () => clearInterval(timer.current);
  }, [stato?.inCorso]);

  async function avvia() {
    setErrore(null);
    try {
      await postAggiorna();
      eraInCorso.current = true;
      await leggi();
    } catch (e) {
      // 409: ne sta gia' girando una. Non e' un guasto, e la corsa in corso
      // e' proprio quella che si voleva: basta mostrarla.
      if (e.status === 409) await leggi();
      else setErrore(e.message);
    }
  }

  const inCorso = !!stato?.inCorso;
  const r = stato?.riepilogo;

  return (
    <div className="blocco-dati agg">
      <h3>Aggiorna tutto</h3>
      <p className="muted">
        Rilegge tutte le fonti attive - infortuni, titolarita', rigoristi - e rigenera le note AI se la chiave e'
        impostata sul server. Dura qualche minuto: una richiesta ogni due secondi per non pesare sui siti. Listone,
        statistiche ed xG non si toccano: quelli sono file e si caricano qui sotto.
      </p>

      <button className="bottone grande" onClick={avvia} disabled={inCorso}>
        {inCorso ? 'Aggiornamento in corso…' : 'Aggiorna tutto'}
      </button>

      {errore && <p className="err">{errore}</p>}

      {inCorso && (
        <p className="agg-fase">
          <span className="agg-segno corso">◐</span> {FASI[stato.fase] ?? 'in corso'}
        </p>
      )}

      {/* L'avviso della corsa interrotta lo scrive il server e sta gia' fra gli
          avvisi qui sotto: ripeterlo qui voleva dire leggerlo due volte. */}
      {(stato?.avvisi ?? []).map((a) => (
        <p className="avviso banner" key={a}>
          {a}
        </p>
      ))}

      {stato?.fonti?.length > 0 && (
        <div className="agg-avanzamento">
          {['segnali', 'infortuni', 'articoli'].map((g) => {
            const righe = stato.fonti.filter((f) => f.gruppo === g);
            if (!righe.length) return null;
            return (
              <div key={g}>
                <h4>{GRUPPI[g]}</h4>
                <ul className="agg-lista">
                  {righe.map((f) => (
                    <RigaFonte key={f.nome} f={f} />
                  ))}
                </ul>
              </div>
            );
          })}
          <Note note={stato.note} />
        </div>
      )}

      {r && !inCorso && (
        <div className={`agg-riepilogo${r.fontiKo ? ' con-errori' : ''}`}>
          <strong>
            {r.fontiOk} fonti su {r.fontiTotali} aggiornate
          </strong>
          {r.fontiKo > 0 ? (
            <>
              {' · '}
              <strong className="ko">
                {r.fontiKo} {r.fontiKo === 1 ? 'ha fallito' : 'hanno fallito'}
              </strong>
            </>
          ) : (
            ' · nessun errore'
          )}
          {' · '}
          {r.righeScritte} righe scritte
          {' · '}
          {r.articoliInArchivio} articoli in archivio
          {stato.finitoIl && <span className="muted"> · finito alle {ORA(stato.finitoIl)}</span>}
        </div>
      )}

      {stato?.righe?.length > 0 && (
        <>
          <button className="nota-toggle" onClick={() => setLogAperto((x) => !x)}>
            {logAperto ? '▾ nascondi dettaglio' : `▸ dettaglio completo (${stato.righe.length} righe)`}
          </button>
          {logAperto && <pre className="avanzamento">{stato.righe.slice(-200).join('\n')}</pre>}
        </>
      )}
    </div>
  );
}
