import { squadra, testoSu, iniziali, RUOLI } from './squadre.js';

/** Cerchio con la sigla della squadra sul suo colore sociale. Niente immagini:
 *  i loghi sono marchi registrati e un asset esterno che non arriva lascerebbe
 *  un buco. Il colore del testo lo decide la luminanza dello sfondo. */
export function BadgeSquadra({ nome, size = 30, titolo = true }) {
  const s = squadra(nome);
  return (
    <span
      className="badge-squadra"
      title={titolo ? nome : undefined}
      style={{
        background: s.colore,
        color: testoSu(s.colore),
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
      }}
    >
      {s.sigla}
    </span>
  );
}

/** Iniziali del giocatore sul colore del suo ruolo: stessa logica, e il ruolo
 *  si legge a colpo d'occhio anche senza etichetta. */
export function BadgeGiocatore({ nome, ruolo, size = 34 }) {
  const colore = RUOLI[ruolo]?.colore ?? '#4a5061';
  return (
    <span
      className="badge-giocatore"
      style={{ borderColor: colore, color: colore, width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {iniziali(nome)}
    </span>
  );
}

/** La fascia come pallini: cinque, pieni fino al valore. Fascia 1 = i piu'
 *  cari, quindi un pallino solo acceso e' il gradino piu' alto. */
export function Fascia({ valore, ruolo }) {
  const colore = RUOLI[ruolo]?.colore ?? '#8b90a0';
  return (
    <span className="fascia-pallini" title={valore ? `fascia ${valore}` : 'fascia non calcolata'}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={valore && i <= valore ? 'on' : ''} style={valore && i <= valore ? { background: colore } : undefined} />
      ))}
    </span>
  );
}
