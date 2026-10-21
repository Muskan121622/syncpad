# SyncPad

**Where you make stuff together, live.** A collaborative study workspace: shared pad,
tasks, spreadsheet, doodle board, sticky wall, focus timer — real-time synced between
everyone in the room, with rewind history and session recap export.

## How sharing works

Every visit to the app mints a **random 12-char room key** (`/r/k7m2xq9p4tgb`). There is
no shared default room — you and your study buddies are alone in yours. The URL carries
the current tool too:

```
https://<your-frontend>/r/<roomKey>            → pad
https://<your-frontend>/r/<roomKey>/sheet      → spreadsheet
https://<your-frontend>/r/<roomKey>/tasks …    → any other tool
```

Old `?p=<key>&t=<tool>` links still work and get rewritten to the pretty form.
Copy the link from the **Share** popover; the recap card prints it as a plain label.

## Repo layout

```
apps/web      React + Vite frontend (Tiptap/Yjs editor, sheets, doodle, …)
apps/server   Node CRDT server (Hocuspocus + Yjs) + rewind/streak REST API
scripts/      dev orchestrator + history verification
vercel.json   frontend build config (root-level, workspace-aware)
fly.toml      backend deploy config (Railway alternative: railway.toml)
```

## Local development

```bash
npm install
npm run dev        # web on :5173, ws server on :1234, history API on same port
```

No env vars needed locally: the client defaults to `ws://<host>:1234`.

## Deployment (two pieces)

The app is a **static frontend** plus a **stateful websocket backend**. Deploy both,
then point the frontend at the backend.

### 1. Backend — Fly.io (or Railway/Render — anything with one port + a volume)

The server intentionally runs websocket **and** REST (`/history`, `/streak`, `/health`)
on a single port (`SINGLE_PORT=1`), because PaaS platforms expose exactly one.

```bash
# from the repo root
fly launch --copy-empty          # or: fly apps create syncpad-ws
fly volumes create syncpad_data --size 1 --app syncpad-ws   # persistence!
fly deploy
fly open                         # verify https://syncpad-ws.fly.dev/health → 200
```

- Config lives in [`fly.toml`](fly.toml); the image is [`apps/server/Dockerfile`](apps/server/Dockerfile).
- **The volume matters.** Without `/data` mounted, pad snapshots and edit logs are lost
  on every deploy/restart (live sync still works — the bug only shows up later).
- Railway works too (`railway.toml`, same Dockerfile); attach a volume at `/data` there
  as well.

### 2. Frontend — Vercel

From the **repo root**:

```bash
vercel --prod
```

`vercel.json` handles everything (workspace build `apps/web/dist`, SPA rewrites so deep
links like `/r/<key>/sheet` resolve, immutable asset caching). One required setting:

| Env var             | Value                                   | When                       |
| ------------------- | --------------------------------------- | -------------------------- |
| `VITE_WS_URL`       | `wss://<backend-host>` (e.g. `wss://syncpad-ws.fly.dev`) | after step 1 |

```bash
vercel env add VITE_WS_URL production   # then: vercel --prod (rebuild picks it up)
```

The REST URL is derived from `VITE_WS_URL` automatically (same host, `https:`). Set
`VITE_HISTORY_URL` only if you split the API onto a different host.
See [`apps/web/.env.example`](apps/web/.env.example).

### 3. Verify the deployed app

1. Open the frontend URL → you land on `/r/<fresh-random-key>`.
2. Load the same URL in a second browser/incognito window → **both windows must be in
   the same room**, and a third visit to the bare root must *not* join them.
3. Type in the pad, check presence dots, rewind slider, and recap card link.
4. Server log should show one `stateless`-style connection pair per browser, no
   `failed to fetch` from the client console (that would mean a wrong `VITE_WS_URL`).

## Backend env vars (cheat sheet)

| Var           | Default        | Notes                                            |
| ------------- | -------------- | ------------------------------------------------ |
| `PORT`        | injected by PaaS | never hardcode                                   |
| `SINGLE_PORT` | `0`            | `1` on Fly/Railway — REST shares the ws port     |
| `DATA_DIR`    | `./data`       | point at a volume in production                  |
| `REDIS_URL`   | unset          | only needed to scale to multiple server instances |

Details in [`apps/server/.env.example`](apps/server/.env.example).
