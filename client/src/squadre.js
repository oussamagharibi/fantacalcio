/** Sigla e colore sociale di ogni squadra. NON si scaricano loghi ufficiali:
 *  sono marchi registrati, e un fetch esterno che fallisce romperebbe il
 *  layout. Il badge e' un cerchio con la sigla, disegnato dal CSS.
 *  Per aggiungere una squadra basta una riga qui, senza toccare i componenti. */
export const SQUADRE = {
  Atalanta: { sigla: 'ATA', colore: '#1e71b8' },
  Bologna: { sigla: 'BOL', colore: '#9c1b2e' },
  Cagliari: { sigla: 'CAG', colore: '#a3122c' },
  Como: { sigla: 'COM', colore: '#0b4ea2' },
  Cremonese: { sigla: 'CRE', colore: '#8d1b1b' },
  Empoli: { sigla: 'EMP', colore: '#1a6fc4' },
  Fiorentina: { sigla: 'FIO', colore: '#6a2e8f' },
  Frosinone: { sigla: 'FRO', colore: '#f2c300' },
  Genoa: { sigla: 'GEN', colore: '#a81c24' },
  Inter: { sigla: 'INT', colore: '#0068a8' },
  Juventus: { sigla: 'JUV', colore: '#2b2b2b' },
  Lazio: { sigla: 'LAZ', colore: '#8ec4ea' },
  Lecce: { sigla: 'LEC', colore: '#efc300' },
  Milan: { sigla: 'MIL', colore: '#c8102e' },
  Monza: { sigla: 'MON', colore: '#b4192b' },
  Napoli: { sigla: 'NAP', colore: '#12a0d7' },
  Parma: { sigla: 'PAR', colore: '#0b5cab' },
  Pisa: { sigla: 'PIS', colore: '#1b3f8b' },
  Roma: { sigla: 'ROM', colore: '#8e1f2f' },
  Salernitana: { sigla: 'SAL', colore: '#6b1f2b' },
  Sassuolo: { sigla: 'SAS', colore: '#00a752' },
  Torino: { sigla: 'TOR', colore: '#7a1f2b' },
  Udinese: { sigla: 'UDI', colore: '#2c2c2c' },
  Venezia: { sigla: 'VEN', colore: '#0e5b3e' },
  Verona: { sigla: 'VER', colore: '#f2c300' },
};

/** Colore per ruolo, l'accento che tiene insieme tutta l'interfaccia:
 *  lo stesso giallo del portiere sul badge, sul tab, sullo slot vuoto. */
/** Gli stessi valori dei token --P/--D/--C/--A in styles.css: qui servono
 *  come stringhe per gli stili inline dei pallini e dei badge. Il C e' viola e
 *  non blu, per non confondersi col blu aziendale. */
export const RUOLI = {
  P: { nome: 'Portieri', colore: '#f2b33d' },
  D: { nome: 'Difensori', colore: '#3fbf7f' },
  C: { nome: 'Centrocampisti', colore: '#bb7af0' },
  A: { nome: 'Attaccanti', colore: '#ff6b5e' },
};

export const ORDINE_RUOLI = ['P', 'D', 'C', 'A'];

/** Squadra sconosciuta: sigla dalle prime tre lettere e grigio neutro, cosi'
 *  una promossa non ancora mappata non lascia un buco nell'interfaccia. */
const RIPIEGO = (nome) => ({ sigla: String(nome ?? '??').slice(0, 3).toUpperCase(), colore: '#4a5061' });

export const squadra = (nome) => SQUADRE[nome] ?? RIPIEGO(nome);

/** Su giallo e azzurro chiaro il testo bianco non si legge: la luminanza
 *  decide il colore del testo, invece di una colonna "testoScuro" per squadra
 *  che prima o poi qualcuno dimentica di riempire. */
export function testoSu(sfondo) {
  const n = parseInt(String(sfondo).replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#12141a' : '#ffffff';
}

/** Iniziali per il cerchio del giocatore. I pezzi puntati sono iniziali del
 *  nome proprio ("Martinez L.") e non contano: si guarda il cognome. */
export function iniziali(nome) {
  const parti = String(nome ?? '')
    .split(/\s+/)
    .filter((p) => p && !p.endsWith('.'));
  if (parti.length >= 2) return (parti[0][0] + parti[1][0]).toUpperCase();
  return (parti[0] ?? '??').slice(0, 2).toUpperCase();
}
