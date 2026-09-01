import { useState } from 'react';
import { postConfig } from './api.js';

const SLOT = [
  ['slotP', 'Portieri'],
  ['slotD', 'Difensori'],
  ['slotC', 'Centrocampisti'],
  ['slotA', 'Attaccanti'],
];

const nomiDefault = (n) => Array.from({ length: n }, (_, i) => `Squadra ${i + 1}`);

export default function Setup({ iniziale = {}, onSalvata, onAnnulla }) {
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

  const slotTotali = SLOT.reduce((s, [k]) => s + (Number(slot[k]) || 0), 0);

  function cambiaNumeroSquadre(v) {
    setNumeroSquadre(v);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 40) {
      setNomi((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? `Squadra ${i + 1}`));
    }
  }

  function cambiaNome(i, v) {
    setNomi((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  }

  async function salva(e) {
    e.preventDefault();
    setInvio(true);
    setErrore(null);
    setCampo(null);
    try {
      const risposta = await postConfig({ budget, numeroSquadre, ...slot, nomiSquadre: nomi, miaSquadra });
      onSalvata(risposta);
    } catch (err) {
      setErrore(err.message);
      setCampo(err.campo ?? null);
    } finally {
      setInvio(false);
    }
  }

  return (
    <main className="wrap">
      <h1>Configurazione lega</h1>
      <p className="muted">Modificabile finche non registri il primo acquisto.</p>

      <form onSubmit={salva}>
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
          <legend>Slot per ruolo - totale {slotTotali}</legend>
          <div className="riga">
            {SLOT.map(([k, etichetta]) => (
              <label key={k} className={campo === k ? 'ko' : ''}>
                {etichetta}
                <input type="number" value={slot[k]} onChange={(e) => setSlot({ ...slot, [k]: e.target.value })} />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={campo === 'nomiSquadre' ? 'ko' : ''}>
          <legend>Nomi delle squadre</legend>
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
          La mia squadra
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

        <div className="azioni">
          <button type="submit" disabled={invio}>
            {invio ? 'Salvo...' : 'Salva configurazione'}
          </button>
          {onAnnulla && (
            <button type="button" className="secondario" onClick={onAnnulla}>
              Annulla
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
