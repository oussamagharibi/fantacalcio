/** Cosa si puo' sapere di un'immagine senza decodificarla.
 *
 *  Nessuna libreria: le dimensioni stanno nell'intestazione del file, e per
 *  leggerle bastano poche decine di byte. Non serve un decoder - che sarebbe
 *  una dipendenza nuova - perche' non si deve disegnare niente, solo sapere
 *  quanto e' grande.
 *
 *  Il ridimensionamento vero avviene nel browser, dove un decoder c'e' gia'
 *  (createImageBitmap e canvas). Qui si controlla che sia stato fatto: il
 *  client dichiara, il server misura. */

/** Oltre questo lato l'API ridimensiona comunque, quindi mandare piu' grande
 *  vuol dire pagare la banda e non guadagnare un pixel di leggibilita'. */
export const LATO_MASSIMO = 1568;

/** Venti per volta. Non e' un limite tecnico: e' quanto ha senso guardare in
 *  una sola risposta, e venti schermate sono gia' ~30.000 token di input. */
export const MAX_FOTO = 20;

export const TIPI_AMMESSI = ['image/jpeg', 'image/png', 'image/webp'];

const ESTENSIONE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Il tipo si legge dai primi byte, non dal nome del file ne' dal content-type
 *  che dichiara il client: quelli li scrive chi carica, i magic number no.
 *  Stessa difesa gia' usata per gli xlsx del listone. */
export function riconosci(buf) {
  if (!buf || buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP')
    return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** Larghezza e altezza dall'intestazione. null quando il file e' troncato o
 *  malformato: meglio dire "non lo so" che restituire un numero inventato, su
 *  cui poi si calcolerebbe una stima di costo altrettanto inventata. */
export function dimensioni(buf) {
  const t = riconosci(buf);
  if (!t) return null;
  try {
    if (t.mime === 'image/png') return png(buf);
    if (t.mime === 'image/jpeg') return jpeg(buf);
    return webp(buf);
  } catch {
    return null;
  }
}

/** PNG: la prima chunk e' sempre IHDR, e larghezza e altezza stanno nei suoi
 *  primi otto byte. Posizione fissa, niente da cercare. */
function png(buf) {
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { larghezza: buf.readUInt32BE(16), altezza: buf.readUInt32BE(20) };
}

/** JPEG: si cammina di marcatore in marcatore fino al primo SOF, che porta le
 *  dimensioni. I marcatori che NON sono SOF hanno la stessa forma ma un altro
 *  significato (tabelle di Huffman, EXIF, commenti) e vanno saltati per
 *  lunghezza, non ignorati: la lunghezza e' l'unico modo per sapere dove
 *  comincia il prossimo. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpeg(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marcatore = buf[i + 1];
    // Riempimento fra un marcatore e l'altro, e i marcatori senza corpo.
    if (marcatore === 0xff || (marcatore >= 0xd0 && marcatore <= 0xd9)) {
      i += 2;
      continue;
    }
    const lunghezza = buf.readUInt16BE(i + 2);
    if (SOF.has(marcatore)) return { larghezza: buf.readUInt16BE(i + 7), altezza: buf.readUInt16BE(i + 5) };
    // SOS: da qui in poi ci sono i dati compressi, non piu' marcatori.
    if (marcatore === 0xda) return null;
    i += 2 + lunghezza;
  }
  return null;
}

/** WebP ha tre forme, e ognuna scrive le dimensioni a modo suo. Quella estesa
 *  (VP8X) e' la sola che le dichiari in chiaro; le altre due le impacchettano
 *  in 14 bit ciascuna. */
function webp(buf) {
  const chunk = buf.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8X') return { larghezza: leggi24(buf, 24) + 1, altezza: leggi24(buf, 27) + 1 };
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { larghezza: (b & 0x3fff) + 1, altezza: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    // Start code del keyframe: se non c'e', non e' un frame che sappiamo leggere.
    if (!(buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a)) return null;
    return { larghezza: buf.readUInt16LE(26) & 0x3fff, altezza: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

const leggi24 = (buf, i) => buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16);

/** Il conto dei token di un'immagine e' larghezza per altezza diviso 750.
 *  Oltre LATO_MASSIMO l'API rimpicciolisce prima di contare, quindi il conto
 *  si fa sulle dimensioni ridotte: e' quello che si paga davvero. */
export function tokenImmagine(larghezza, altezza) {
  if (!larghezza || !altezza) return null;
  const { larghezza: l, altezza: a } = ridotte(larghezza, altezza);
  return Math.ceil((l * a) / 750);
}

/** Le dimensioni dopo il rimpicciolimento, proporzioni intatte. Sotto la
 *  soglia non si tocca niente: ingrandire un'immagine piccola aggiungerebbe
 *  token senza aggiungere un solo pixel di informazione. */
export function ridotte(larghezza, altezza, lato = LATO_MASSIMO) {
  const lungo = Math.max(larghezza, altezza);
  if (!lungo || lungo <= lato) return { larghezza, altezza, ridimensionata: false };
  const scala = lato / lungo;
  return {
    larghezza: Math.max(1, Math.round(larghezza * scala)),
    altezza: Math.max(1, Math.round(altezza * scala)),
    ridimensionata: true,
  };
}

export const estensioneDi = (mime) => ESTENSIONE[mime] ?? 'bin';

/** Il verso opposto: dall'estensione di un file gia' salvato al suo
 *  content-type. Serve a riservire le immagini dell'archivio. */
export const mimeDaEstensione = (ext) =>
  Object.entries(ESTENSIONE).find(([, e]) => e === String(ext ?? '').toLowerCase())?.[0] ?? null;
