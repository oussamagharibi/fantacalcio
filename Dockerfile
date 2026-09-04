# Immagine di produzione: un solo servizio che serve le API e il frontend.
#
# PERCHE' UN DOCKERFILE E NON NIXPACKS. Nixpacks passa nell'ambiente di build
# tutte le variabili del servizio, perche' non puo' sapere quali servano al
# build: finiscono come ARG/ENV nel piano generato, e quindi nei metadati dei
# layer. ANTHROPIC_API_KEY al build non serve a niente - la legge solo
# server/lib/analisi.js quando parte "npm run news", a runtime - ma finiva
# dentro lo stesso.
#
# Qui non c'e' NESSUN ARG, e in particolare nessun "ARG ANTHROPIC_API_KEY".
# Non e' una dimenticanza: un build arg che il Dockerfile non dichiara viene
# ignorato da Docker, quindi la chiave non puo' entrare in un layer nemmeno se
# il builder prova a passarla. A runtime arriva normalmente dall'ambiente del
# container, che e' l'unico posto dove serve.
#
# Node 24 e non meno: il progetto usa node:sqlite (DatabaseSync),
# --env-file-if-exists e import.meta.dirname.
# slim e non alpine: esbuild e rollup scaricano un binario per la piattaforma,
# e su glibc e' la strada senza sorprese.

FROM node:24-slim AS build
WORKDIR /app

# I manifest prima del resto: finche' non cambiano, il layer delle dipendenze
# si riusa e il build non riscarica niente.
COPY package.json package-lock.json ./
RUN npm ci
COPY client/package.json client/package-lock.json ./client/
RUN npm --prefix client ci

COPY server ./server
COPY scripts ./scripts
COPY client ./client
RUN npm --prefix client run build

# --------------------------------------------------------- immagine finale
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Solo le dipendenze di produzione: vite e la toolchain del client restano
# nello stage di build e non arrivano qui.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/client/dist ./client/dist

# data/ non si copia: contiene il db locale e i file scaricati a mano. In
# produzione ci va il volume, che db.js trova da RAILWAY_VOLUME_MOUNT_PATH
# (o da DATA_DIR); senza volume ripiega su /app/data e lo crea da solo.
ENV PORT=3001
EXPOSE 3001

# Railway usa lo startCommand di railway.json; questo serve a chi lancia
# l'immagine a mano.
CMD ["npm", "start"]
