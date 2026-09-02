import { useState } from 'react';
import { postConfig } from './api.js';
import { RUOLI, ORDINE_RUOLI } from './squadre.js';

/** Schermata che prende il posto del layout a tre zone finche' l'asta non e'
 *  configurata. Non e' una pagina a se': la configurazione serve solo all'asta,
 *  e la pagina Analisi funziona benissimo senza. */

const nomiDefault = (n) => Array.from({ length: n }, (_, i) => `Squadra ${i + 1}`);

export default function Preparazione({ iniziale = {}, onIniziata }) {
  const [budget, setBudget] = useState(iniziale.budget ?? 500);
  const [numeroSquadre, setNumeroSquadre] = useState(iniziale.numeroSquadre ?? 8);
  const [slot, setSlot] = useState({
    slotP: iniziale.slotP ?? 3,
    slotD: iniziale.slotD ?? 8,
    slotC: iniziale.slotC ?? 8,
    slotA: iniziale.slotA ?? 6,
  });
  const [nomi, setNomi] = useState(iniziale.nomiSquadre ?? nomiDefault(iniziale.numeroSquadre ?? 8));
  const [miaSquadra, setMia] = useState(iniziale.miaSquadra ?? '');
  const [errore, setErrore] = useState(null);
  const [campo, setCampo] = useState(null);
  const [invio, setInvio] = useState(false);

  const slotTotali = ORDINE_RUOLI.reduce((s, r) => s + (Number(slot[`slot${r}`]) || 0), 0);

  function cambiaNumeroSquadre(v) {
    setNumeroSquadre(v);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 40)
      setNomi((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? `Squadra ${i + 1}`));
  }

  const cambiaNome = (i, v) =>
    setNomi((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });

  async function inizia(e) {
    e.preventDefault();
    setInvio(true);
    setErrore(null);
    setCampo(null);
    try {
      onIniziata(await postConfig({ budget, numeroSquadre, ...slot, nomiSquadre: nomi, miaSquadra }));
    } catch (err) {
      setErrore(err.message);
      setCampo(err.campo ?? null);
    } finally {
      setInvio(false);
    }
  }

  return (
    <div className="preparazione">
      <div className="pannello prep-riquadro">
        <h2>Prepara l'asta</h2>
        <p className="muted">
          Serve solo per la pagina Asta. La pagina Analisi funziona gia' con il listone caricato.
        </p>

        <form onSubmit={inizia}>
          <div className="riga">
            <label className={campo === 'budget' ? 'ko' : ''}>
              Budget per squadra
              <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </label>
            <label className={campo === 'numeroSquadre' ? 'ko' : ''}>
              Numero squadre
              <input type="number" value={numeroSquadre} onChange={(e) => cambiaNumeroSquadre(e.target.value)} />
            </label>
          </div>

          <fieldset>
            <legend>Slot per ruolo &mdash; totale {slotTotali}</legend>
            <div className="riga">
              {ORDINE_RUOLI.map((r) => (
                <label key={r} className={campo === `slot${r}` ? 'ko' : ''}>
                  <span className="etichetta-ruolo">
                    <i style={{ background: RUOLI[r].colore }} />
                    {RUOLI[r].nome}
                  </span>
                  <input
                    type="number"
                    value={slot[`slot${r}`]}
                    onChange={(e) => setSlot({ ...slot, [`slot${r}`]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={campo === 'nomiSquadre' ? 'ko' : ''}>
            <legend>Partecipanti</legend>
            <div className="griglia">
              {nomi.map((n, i) => (
                <input
                  key={i}
                  value={n}
                  onChange={(e) => cambiaNome(i, e.target.value)}
                  placeholder={`Squadra ${i + 1}`}
                />
              ))}
            </div>
          </fieldset>

          <label className={campo === 'miaSquadra' ? 'ko' : ''}>
            Quale sono io
            <select value={miaSquadra} onChange={(e) => setMia(e.target.value)}>
              <option value="">-- scegli --</option>
              {nomi.filter(Boolean).map((n, i) => (
                <option key={i} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          {errore && <p className="err">{errore}</p>}

          <div className="azioni-form">
            <button type="submit" className="bottone" disabled={invio}>
              {invio ? 'Salvo…' : "Inizia asta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
