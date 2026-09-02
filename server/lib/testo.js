/** Normalizzazione dei nomi, in un posto solo. Prima ne esistevano tre copie
 *  leggermente diverse (notizie, wiki, fantacalcio) e la piu' povera scartava
 *  giocatori giusti: "Højlund" non combaciava con "Hojlund". */

/** Lettere che NFD non scompone: non hanno un segno diacritico staccabile, la
 *  variante e' la lettera stessa. Senza questa tabella restano com'erano e non
 *  combaciano mai con la forma ASCII che usa il listone. */
const LETTERE = {
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  ı: 'i',
  ħ: 'h',
  ŧ: 't',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
};

/** Minuscole, senza segni diacritici, con le lettere speciali traslitterate.
 *  L'apostrofo NON si tocca: in un testo italiano "l'Inter" diventerebbe
 *  "linter" e il controllo sulla squadra, che cerca "inter" a confine di
 *  parola, smetterebbe di trovarla. Chi ha bisogno di toglierlo lo fa dopo. */
export const normalizza = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[øđðłıħŧæœß]/g, (c) => LETTERE[c] ?? c);

/** Come normalizza, ma tenendo la corrispondenza con le posizioni originali,
 *  cosi' una finestra di contesto si puo' ritagliare dal testo vero, con
 *  accenti e maiuscole al loro posto. Una lettera puo' espandersi in due
 *  ("æ" -> "ae"): entrambe puntano al carattere di partenza. */
export function normalizzaConIndici(s) {
  let testo = '';
  const indici = [];
  const src = String(s ?? '');
  for (let i = 0; i < src.length; i++) {
    for (const c of normalizza(src[i])) {
      testo += c;
      indici.push(i);
    }
  }
  return { testo, indici };
}
