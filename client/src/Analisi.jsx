import { useEffect, useMemo, useRef, useState } from 'react';
import { postTarget, postGeneraAnalisi, getStatoAnalisi, getStato } from './api.js';
import UploadListone from './UploadListone.jsx';

const REPARTI = [
  ['P', 'Portieri'],
  ['D', 'Difensori'],
  ['C', 'Centrocampisti'],
  ['A', 'Attaccanti'],
];

const COLONNE = [
  { chiave: 'nome', etichetta: 'Nome', testo: true },
  { chiave: 'squadra', etichetta: 'Squadra', testo: true },
  { chiave: 'quotazione', etichetta: 'Qt.A' },
  { chiave: 'fvm', etichetta: 'FVM' },
  { chiave: 'fascia', etichetta: 'Fascia' },
];

/** Etichetta breve per un segnale. Il testo lungo resta nel title, cosi' la
 *  riga non si allarga ma l'informazione completa e' a un passaggio di mouse. */
function Segnale({ s }) {
  if (s.tipo === 'infortunio') return <span className="segnale ko" title={s.testo}>infortunio</span>;
  if (s.tipo === 'rigorista') return <span className="segnale rig" title={s.testo}>{s.testo.replace('rigorista ', 'rig ')}</span>;
  const perc = /(\d+)%/.exec(s.testo)?.[1];
  const titolare = s.testo.startsWith('titolare');
  return (
    <span className={titolare ? 'segnale ok' : 'segnale'} title={s.testo}>
      {perc ? `${perc}%` : titolare ? 'titolare' : 'panchina'}
    </span>
  );
}

export default function Analisi({ stato, onStato, onRicarica }) {
  const [ordine, setOrdine] = useState({ chiave: 'quotazione', crescente: false });
  const [fascia, setFascia] = useState('');
  const [soloSegnali, setSoloSegnali] = useState(false);
  const [soloTarget, setSoloTarget] = useState(false);
  const [batch, setBatch] = useState({ inCorso: false, righe: [] });
  const timer = useRef(null);

  // Avanzamento del batch: si interroga il server solo mentre gira.
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

  async function stella(id) {
    await postTarget(id);
    onStato(await getStato());
  }

  const ordina = (chiave) =>
    setOrdine((o) => ({ chiave, crescente: o.chiave === chiave ? !o.crescente : chiave === 'nome' || chiave === 'squadra' }));

  const filtrati = useMemo(() => {
    const col = COLONNE.find((c) => c.chiave === ordine.chiave);
    return stato.giocatori
      .filter((g) => !fascia || String(g.fascia) === fascia)
      .filter((g) => !soloSegnali || g.segnali.length > 0)
      .filter((g) => !soloTarget || g.target)
      .slice()
      .sort((a, b) => {
        const x = a[ordine.chiave] ?? (col?.testo ? '' : -1);
        const y = b[ordine.chiave] ?? (col?.testo ? '' : -1);
        const c = col?.testo ? String(x).localeCompare(String(y), 'it') : x - y;
        return ordine.crescente ? c : -c;
      });
  }, [stato.giocatori, ordine, fascia, soloSegnali, soloTarget]);

  return (
    <main className="wrap largo">
      <div className="riga filtri">
        <label>
          Fascia
          <select value={fascia} onChange={(e) => setFascia(e.target.value)}>
            <option value="">tutte</option>
            {[1, 2, 3, 4, 5].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={soloSegnali} onChange={(e) => setSoloSegnali(e.target.checked)} /> solo con
          segnali
        </label>
        <label className="inline">
          <input type="checkbox" checked={soloTarget} onChange={(e) => setSoloTarget(e.target.checked)} /> solo target
        </label>
        <span className="spazio" />
        <button onClick={genera} disabled={batch.inCorso}>
          {batch.inCorso ? 'Analisi in corso...' : 'Genera analisi AI'}
        </button>
      </div>

      {(batch.inCorso || batch.righe.length > 0) && (
        <pre className="avanzamento">{batch.righe.slice(-12).join('\n')}</pre>
      )}

      {REPARTI.map(([ruolo, titolo]) => {
        const righe = filtrati.filter((g) => g.ruolo === ruolo);
        return (
          <section key={ruolo} className="reparto">
            <h2>
              {titolo} <span className="muted">({righe.length})</span>
            </h2>
            {righe.length === 0 ? (
              <p className="muted">Nessun giocatore con questi filtri.</p>
            ) : (
              <table className="tabella">
                <thead>
                  <tr>
                    <th className="stretta"></th>
                    {COLONNE.map((c) => (
                      <th key={c.chiave} onClick={() => ordina(c.chiave)} className="ordinabile">
                        {c.etichetta}
                        {ordine.chiave === c.chiave ? (ordine.crescente ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                    <th>Segnali</th>
                    <th>Nota AI</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((g) => (
                    <tr key={g.id} className={g.uscito || g.prezzoPagato !== null ? 'fuori' : ''}>
                      <td>
                        <button
                          className={g.target ? 'stella attiva' : 'stella'}
                          onClick={() => stella(g.id)}
                          title={g.target ? 'togli dagli obiettivi' : 'segna come obiettivo'}
                        >
                          {g.target ? '★' : '☆'}
                        </button>
                      </td>
                      <td>{g.nome}</td>
                      <td>{g.squadra}</td>
                      <td className="num">{g.quotazione}</td>
                      <td className="num">{g.fvm ?? '-'}</td>
                      <td className="num">{g.fascia ?? '-'}</td>
                      <td className="segnali">
                        {g.segnali.map((s) => (
                          <Segnale key={s.tipo} s={s} />
                        ))}
                      </td>
                      <td className="nota">
                        {g.note ? (
                          <details>
                            <summary>
                              {g.note.split('\n')[0].slice(0, 60)}
                              {g.note.split('\n')[0].length > 60 ? '…' : ''}
                            </summary>
                            <pre>{g.note}</pre>
                            <span className="muted">generata il {new Date(g.note_generated_at).toLocaleString('it-IT')}</span>
                          </details>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      <UploadListone />
    </main>
  );
}
