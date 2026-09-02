import { useState } from 'react';
import { postConfig } from './api.js';
import { RUOLI, ORDINE_RUOLI } from './squadre.js';

/** Schermata che prende il posto del layout a tre zone finche' l'asta non e'
 *  configurata. Non e' una pagina a se': la configurazione serve solo all'asta,
 *  e la pagina Analisi funziona benissimo senza.
 *  Si chiedono tre cose sole. Gli altri partecipanti non si chiedono piu':
 *  l'applicazione segue solo la mia rosa, e di un avversario sa unicamente che
 *  un giocatore e' uscito - non a chi e' andato ne' a quanto. Compilare otto
 *  nomi per poi non usarli era lavoro chiesto per niente. */

export default function Preparazione({ iniziale = {}, onIniziata }) {
  const [miaSquadra, setMia] = useState(iniziale.miaSquadra ?? '');
  const [budget, setBudget] = useState(iniziale.budget ?? 500);
  const [slot, setSlot] = useState({
    slotP: iniziale.slotP ?? 3,
    slotD: iniziale.slotD ?? 8,
    slotC: iniziale.slotC ?? 8,
    slotA: iniziale.slotA ?? 6,
  });
  const [errore, setErrore] = useState(null);
  const [campo, setCampo] = useState(null);
  const [invio, setInvio] = useState(false);

  const slotTotali = ORDINE_RUOLI.reduce((s, r) => s + (Number(slot[`slot${r}`]) || 0), 0);

  async function inizia(e) {
    e.preventDefault();
    setInvio(true);
    setErrore(null);
    setCampo(null);
    try {
      onIniziata(await postConfig({ miaSquadra, budget, ...slot }));
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
          <fieldset className={campo === 'miaSquadra' ? 'ko' : ''}>
            <legend>La mia squadra</legend>
            <input value={miaSquadra} onChange={(e) => setMia(e.target.value)} placeholder="Nome della squadra" />
          </fieldset>

          <fieldset className={campo === 'budget' ? 'ko' : ''}>
            <legend>Budget</legend>
            <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </fieldset>

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

          {errore && <p className="err">{errore}</p>}

          <div className="azioni-form">
            <button type="submit" className="bottone" disabled={invio}>
              {invio ? 'Salvo…' : 'Inizia asta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
