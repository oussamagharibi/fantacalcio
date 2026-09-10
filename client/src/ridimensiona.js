import { LATO_MASSIMO, nuoveDimensioni } from './foto.js';

/** Il ridimensionamento, l'unica parte che ha bisogno di un browser.
 *
 *  Il decoder di immagini ce l'ha gia' il browser: createImageBitmap apre
 *  jpg, png e webp, e canvas li riscrive. Sul server sarebbe servita una
 *  libreria - cioe' una dipendenza nuova - per fare la stessa cosa su byte
 *  che il browser aveva gia' decodificato una volta per mostrarli in anteprima.
 *
 *  Sta in un file suo perche' foto.js deve restare provabile senza un DOM. */

/** I png restano png. Sono le schermate: testo su fondo pieno, dove il jpeg
 *  sporca proprio i bordi delle lettere che poi bisogna leggere. Il resto
 *  diventa jpeg, che su una fotografia costa molto meno a parita' di resa. */
const FORMATO_USCITA = (mime) => (mime === 'image/png' ? { mime: 'image/png', qualita: undefined } : { mime: 'image/jpeg', qualita: 0.92 });

/** Da File a quello che serve alla pagina: anteprima, dimensioni vere, e il
 *  file da mandare - ridotto se serviva, l'originale se era gia' abbastanza
 *  piccolo. Riscrivere un'immagine gia' sotto soglia vorrebbe dire ricomprimerla
 *  per niente, perdendo qualita' senza risparmiare un token. */
export async function preparaFoto(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const larghezzaOriginale = bitmap.width;
  const altezzaOriginale = bitmap.height;
  const d = nuoveDimensioni(larghezzaOriginale, altezzaOriginale);

  let daMandare = file;
  if (d.ridimensionata) {
    const tela = document.createElement('canvas');
    tela.width = d.larghezza;
    tela.height = d.altezza;
    const ctx = tela.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, d.larghezza, d.altezza);
    const f = FORMATO_USCITA(file.type);
    const blob = await new Promise((ok) => tela.toBlob(ok, f.mime, f.qualita));
    // toBlob puo' tornare null se il formato non e' supportato: allora si
    // manda l'originale, che l'API ridurra' da sola. Meglio pagare qualche
    // byte in piu' che non mandare l'immagine.
    if (blob) daMandare = new File([blob], rinomina(file.name, f.mime), { type: f.mime });
  }
  bitmap.close?.();

  return {
    nome: file.name,
    file: daMandare,
    anteprima: URL.createObjectURL(daMandare),
    larghezzaOriginale,
    altezzaOriginale,
    larghezza: d.larghezza,
    altezza: d.altezza,
    ridimensionata: d.ridimensionata,
    byteOriginali: file.size,
    byte: daMandare.size,
  };
}

/** L'estensione deve seguire il contenuto: un .png che dentro e' un jpeg
 *  verrebbe rifiutato dal controllo sui magic number, che guarda i byte. */
const rinomina = (nome, mime) => {
  const base = String(nome ?? 'foto').replace(/\.[^.]+$/, '');
  return `${base}.${mime === 'image/png' ? 'png' : 'jpg'}`;
};

export { LATO_MASSIMO };
