import { useEffect, useState } from 'react';
import { getConfig, getStato } from './api.js';
import Analisi from './Analisi.jsx';
import Listone from './Listone.jsx';
import Situazione from './Situazione.jsx';
import Asta from './Asta.jsx';
import Giocatore from './Giocatore.jsx';
import { FILTRI_VUOTI as FILTRI_ANALISI } from './analisiFiltri.js';

/** Routing sull'hash invece di una libreria: cinque schermate non giustificano
 *  una dipendenza, e l'hash sopravvive al refresh senza toccare il server.
 *  #/giocatore/123 e' l'unica rotta con un parametro. */
const PAGINE = ['analisi', 'listone', 'situazione', 'asta'];
const rottaDaHash = () => {
  const h = window.location.hash.replace('#/', '');
  const m = /^giocatore\/(\d+)$/.exec(h);
  if (m) return { pagina: 'giocatore', id: Number(m[1]) };
  return { pagina: PAGINE.includes(h) ? h : 'analisi', id: null };
};

/** I filtri di ogni pagina stanno qui e non dentro le pagine. Aprire la scheda
 *  di un giocatore smonta la lista da cui si e' partiti: con i filtri in uno
 *  stato locale, il pulsante indietro avrebbe riportato a una vista azzerata. */
const FILTRI_INIZIALI = {
  // Il reparto attivo e i filtri stanno insieme: cambiare tab non li azzera,
  // e ognuno filtra il proprio reparto.
  analisi: { reparto: 'P', ...FILTRI_ANALISI },
  listone: {
    ordine: { chiave: 'quotazione', crescente: false },
    ruolo: null,
    squadra: '',
    fascia: null,
    cerca: '',
    soloAttivi: true,
  },
  situazione: { stato: null, ruolo: null, squadra: '', fascia: null, cerca: '' },
};

const NOMI = { analisi: 'Analisi', listone: 'Listone', situazione: 'Situazione', asta: 'Asta' };

export default function App() {
  const [config, setConfig] = useState(null);
  const [stato, setStato] = useState(null);
  const [errore, setErrore] = useState(null);
  const [rotta, setRotta] = useState(rottaDaHash);
  const [filtri, setFiltri] = useState(FILTRI_INIZIALI);
  /** Da dove si e' arrivati alla scheda: il pulsante indietro ci riporta, e la
   *  pagina ritrova i suoi filtri perche' vivono qui sopra. */
  const [provenienza, setProvenienza] = useState('analisi');
  /** Il messaggio dopo un'azione sta qui perche' le azioni ora partono da
   *  quattro pagine diverse: un toast per pagina avrebbe voluto dire quattro
   *  copie della stessa cosa, e due visibili insieme quando si cambia vista. */
  const [toast, setToast] = useState(null);
  const avvisa = (testo, tipo = 'ok') => {
    setToast({ testo, tipo });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const cambio = () => setRotta(rottaDaHash());
    window.addEventListener('hashchange', cambio);
    return () => window.removeEventListener('hashchange', cambio);
  }, []);

  const ricarica = () =>
    Promise.all([getConfig(), getStato()])
      .then(([c, s]) => {
        setConfig(c);
        setStato(s);
      })
      .catch((e) => setErrore(e.message));

  useEffect(() => {
    ricarica();
  }, []);

  if (errore)
    return (
      <main className="wrap">
        <p className="err">Server non raggiungibile: {errore}</p>
      </main>
    );
  if (!config || !stato)
    return (
      <main className="wrap">
        <p className="muted">Carico…</p>
      </main>
    );

  const vaiA = (hash, r) => {
    window.location.hash = `#/${hash}`;
    setRotta(r);
  };
  const vai = (p) => vaiA(p, { pagina: p, id: null });
  const apri = (id) => {
    setProvenienza(rotta.pagina === 'giocatore' ? provenienza : rotta.pagina);
    vaiA(`giocatore/${id}`, { pagina: 'giocatore', id });
  };
  const indietro = () => vai(provenienza);

  const perPagina = (chiave) => ({
    filtri: filtri[chiave],
    onFiltri: (f) => setFiltri((s) => ({ ...s, [chiave]: f })),
    onApri: apri,
    onStato: setStato,
    onAvviso: avvisa,
  });

  const slotTotali = Object.values(stato.rosa.slot).reduce((a, b) => a + b, 0);
  const { pagina, id } = rotta;

  return (
    <>
      <nav className="barra">
        {/* Senza configurazione non c'e' una "mia squadra" da mostrare: la
            pagina Analisi si usa lo stesso, quindi la barra non deve dipenderne. */}
        <span className="marchio">{config.configurata ? config.config.miaSquadra : 'Asta Fantacalcio'}</span>
        {PAGINE.map((p) => (
          <button key={p} className={pagina === p ? 'tab attiva' : 'tab'} onClick={() => vai(p)}>
            {NOMI[p]}
          </button>
        ))}
        <span className="spazio" />
        {config.configurata ? (
          <span className="stato-barra">
            <span>
              rosa <strong>{stato.rosa.presi.length}</strong>/{slotTotali}
            </span>
            <span>
              crediti <strong>{stato.rosa.residuo}</strong>
            </span>
            <span>
              max <strong>{stato.rosa.massimoSostenibile}</strong>
            </span>
          </span>
        ) : (
          <span className="stato-barra muted">asta non ancora configurata</span>
        )}
      </nav>
      {pagina === 'giocatore' && (
        <Giocatore
          g={stato.giocatori.find((x) => x.id === id) ?? null}
          stato={stato}
          onStato={setStato}
          onAvviso={avvisa}
          onIndietro={indietro}
          provenienza={NOMI[provenienza]}
        />
      )}
      {pagina === 'asta' && (
        <Asta stato={stato} onStato={setStato} config={config} onRicarica={ricarica} onApri={apri} />
      )}
      {pagina === 'listone' && <Listone stato={stato} {...perPagina('listone')} />}
      {pagina === 'situazione' && <Situazione stato={stato} {...perPagina('situazione')} />}
      {pagina === 'analisi' && <Analisi stato={stato} onRicarica={ricarica} {...perPagina('analisi')} />}
      {toast && <div className={`toast${toast.tipo === 'ko' ? ' ko' : ''}`}>{toast.testo}</div>}
    </>
  );
}
