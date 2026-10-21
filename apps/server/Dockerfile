# SyncPad collaboration server — Hocuspocus + Yjs, one port, persistent /data.
# Built from the REPO ROOT context (it needs the workspace manifests).
FROM node:22-alpine

# tini = a real init as PID 1. Plain `node` swallows nothing: SIGTERM would kill
# it before our graceful "flush pending pads to disk" handler ran, so every
# deploy/restart would lose up to 1.5s of edits. tini forwards signals properly.
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production

# 1) manifests first → the dependency layer only rebuilds when they change
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

# 2) install the server workspace ONLY — react/tiptap/pdf.js (≈100MB) never
#    enter this image, they belong to the web deploy on Vercel
RUN npm ci --omit=dev -w @syncpad/server

# 3) source last → editing code reuses the deps layer
COPY apps/server ./apps/server

# PaaS volumes inherit the ownership of the mountpoint DIRECTORY in the image.
# Create + chown before dropping privileges, otherwise /data is root-only and
# pad snapshots silently fail to persist (the worst kind of bug: it works in dev).
RUN mkdir -p /data && chown -R node:node /data
USER node

# SINGLE_PORT=1 → the rewind/streak REST API shares this one port with ws.
ENV PORT=8080 \
    SINGLE_PORT=1 \
    DATA_DIR=/data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/server/src/index.js"]
