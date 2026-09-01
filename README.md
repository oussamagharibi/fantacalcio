# Asta Fantacalcio

Strumento personale per condurre l'asta del fantacalcio: listone ufficiale
Fantacalcio.it, configurazione lega, registrazione degli acquisti.

Server Fastify + client React (Vite). In produzione e' **un servizio solo**:
lo stesso processo serve le API sotto `/api/*` e il frontend buildato.

## Requisiti

- Node **>= 24** (il progetto usa `node:sqlite`, senza dipendenze native)

## Sviluppo in locale

```bash
npm install
npm --prefix client install

npm run dev      # server con --watch su http://127.0.0.1:3001
npm run client   # vite su http://127.0.0.1:5173, /api in proxy sul server
```

Con `npm run dev` il server non serve il frontend: si usa vite, che fa da
proxy sulle API. Per provare la modalita' produzione in locale:

```bash
npm start        # builda client/dist se manca, poi avvia tutto su una porta sola
```

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm start` | build del client se serve, poi server (API + frontend) |
| `npm run dev` | solo server, con `--watch` |
| `npm run server` | solo server, senza build e senza watch |
| `npm run client` | solo vite dev server |
| `npm run build` | installa le dipendenze del client e builda `client/dist` |
| `npm run import` | importa `data/listone.xlsx` nel db (non tocca la rete) |
| `npm run schema` | stampa lo schema del db |
| `npm run check` | `node --check` su tutti i sorgenti |

## Variabili d'ambiente

| Variabile | Default | Note |
|---|---|---|
| `PORT` | `3001` | su Railway la assegna la piattaforma |
| `HOST` | `0.0.0.0` | dentro un container deve restare `0.0.0.0` |
| `DATA_DIR` | `./data` | cartella di db, listone e backup |
| `RAILWAY_VOLUME_MOUNT_PATH` | — | impostata da Railway: se c'e', vince su `./data` |
| `DB_PATH` | `<DATA_DIR>/asta.db` | override esplicito del singolo file |
| `LISTONE_PATH` | `<DATA_DIR>/listone.xlsx` | idem |
| `LISTONE_URL` | API di Fantacalcio.it | override utile nei test |
| `LOG_LEVEL` | `info` | |

## Deploy su Railway

Il repo contiene gia' `railway.json`: build del client in fase di build,
`npm start` come start command, healthcheck su `/api/health`.

1. Nuovo progetto Railway, collegato a questo repo.
2. **Monta un volume sul path `/data`.** (Service → Settings → Volumes)
3. Deploy. Railway assegna `PORT` e genera il dominio pubblico.

### Il volume non e' opzionale

Il filesystem di un container Railway e' **effimero**: viene ricreato da zero
a ogni redeploy, riavvio o crash. Senza un volume montato su `/data`:

- `asta.db` sparisce → configurazione lega, listone importato e acquisti persi
- `data/listone.xlsx` sparisce → serve ricaricarlo dalla schermata di setup
- i backup in `data/backups/` spariscono

Con il volume montato, Railway espone il mount point in
`RAILWAY_VOLUME_MOUNT_PATH` e l'app ci mette dentro db, listone e backup senza
altra configurazione. Se preferisci un path diverso, imposta `DATA_DIR`.

**Perdere il db a meta' asta significa perdere gli acquisti gia' battuti.**
Monta il volume prima di iniziare, non dopo.

### Primo avvio con la cartella dati vuota

E' uno scenario previsto: all'avvio l'app crea il file del db e applica lo
schema, `/api/config` risponde `configurata: false` e il frontend mostra la
schermata di setup. Da li' si configurano budget, squadre e slot di rosa.

Il listone invece non c'e' e va caricato: nella stessa schermata di setup c'e'
il campo di upload. Scarica il listone Classic da fantacalcio.it (Quotazioni →
Excel) e caricalo li'; il server valida il file, ne tiene una copia di backup e
importa, mostrando righe lette e conteggio per ruolo.

### Perche' l'upload e non il download automatico

Esiste anche `POST /api/listone/aggiorna`, che scarica il file da solo, ma
dalle reti di datacenter fantacalcio.it risponde **401**: vuole una sessione di
browser. Da Railway quindi non funziona. L'endpoint resta perche' da una rete
domestica va, ma la via affidabile e' l'upload manuale.

In locale, in alternativa, si puo' copiare un `listone.xlsx` nella cartella
dati e lanciare `npm run import`.

## API

| Metodo | Rotta | |
|---|---|---|
| GET | `/api/health` | stato del servizio |
| GET | `/api/config` | configurazione, se e' bloccata, numero di acquisti |
| POST | `/api/config` | salva la configurazione; `409` se ci sono gia' acquisti |
| POST | `/api/listone/upload` | carica un `.xlsx` via multipart e importa; **via principale** |
| POST | `/api/listone/aggiorna` | riscarica il listone da fantacalcio.it e reimporta; da Railway da' 401 |
| POST | `/api/reset` | cancella tutti gli acquisti e sblocca la configurazione |

Qualunque altra rotta che non inizi per `/api/` restituisce `index.html`:
il routing e' lato client, quindi un refresh su una schermata interna non
deve dare 404.
