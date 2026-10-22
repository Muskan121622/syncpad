# SyncPad ✦

> **Where you make stuff together, live.** A real-time collaborative study workspace —
> shared pad, tasks, spreadsheet, doodle board, sticky wall, group code, shared viewer,
> a full WebRTC **study call** with live screen-share **annotation**, time-travel rewind,
> and a downloadable **session recap** — all CRDT-synced between everyone in the room.

**🔴 Live demo →** [syncpad-rust.vercel.app](https://syncpad-rust.vercel.app)
**⚙️ Backend (ws + REST) →** [syncpad-99lv.onrender.com](https://syncpad-99lv.onrender.com/health)

---

## 💎 What makes it special

Most "collab editors" stop at a shared textarea. SyncPad is a whole **room** — one random
URL, zero accounts, and everything converges offline-first through CRDTs.

| Tool | What it does |
| ---- | ------------ |
| 📝 **Type pad** | TipTap + Yjs rich-text with **per-line authorship**, live cursors, double-click reactions |
| ✅ **Room tasks** | Shared checklist, synced in real time |
| 🎨 **Doodle board** | Freehand canvas everyone can draw on at once |
| 📌 **Sticky wall** | Post-it board for brainstorming |
| 🧮 **The sheet** | Google-Sheets-style collaborative spreadsheet |
| 💻 **Group code** | Multi-language editor (C++/Java/Python) + AI problem generator, judged server-side |
| 📽 **Shared viewer** | Present PDFs/media to the room — synced zoom, page, and pointer |
| 🎥 **Study call** | Peer-to-peer video/audio, **screen share**, 📌 **pin-to-spotlight**, and **draw-on-their-screen** annotation (pen, colors, ✂️ cut, collapse) |
| 📊 **Session recap** | A 1080×1920 "story card" PNG — words, grind time, who-built-what %, CRDT snapshots |

Plus the vibe layer: **14 one-click themes** (Midnight → Coquette → Vaporwave → Matcha →
Terminal …) that repaint the entire app via CSS variables, and a **time-rewind** scrubber
that replays the room's history from encoded CRDT state vectors.

---

## 🧠 Architecture

```
Browser ──ws──▶ Hocuspocus (Yjs) ──▶ .ydoc snapshots + NDJSON edit log on disk
   │
   ├── WebRTC (P2P media)  ◀── signaling over the SAME Yjs doc (a `call` map)
   │        └── TURN relay minted on demand by GET /turn (Xirsys), STUN fallback
   │
   └── REST (same port)    /history  /streak  /health  /turn  /code/*
                            └── /code/* proxies to the Codeprep judge so the
                                cpk_ API key never touches the browser bundle
```

**Two ideas do all the heavy lifting:**

1. **CRDT-first.** Every tool is a shared `Y.Doc` type. Edits merge without a central
   lock, work offline, and reconcile on reconnect (`y-indexeddb` keeps a local mirror).
2. **One connection, everything.** WebRTC signaling and screen-share annotation reuse the
   same Yjs map — no separate socket, no rooms server. The `call` map carries presence,
   SDP offers/answers, and the `d:*` annotation strokes.

---

## 🛠 Tech stack

**Frontend** — React 18 · Vite 6 · TipTap 2 (+ Collaboration & CollaborationCursor) ·
Yjs · `@hocuspocus/provider` · CodeMirror 6 · `pdfjs-dist` · `y-indexeddb` · WebRTC

**Backend** — Node · `@hocuspocus/server` · `@hocuspocus/extension-redis` (optional
horizontal scaling) · `ioredis` · Yjs · a hand-rolled single-port REST layer

**Infra** — Vercel (static frontend) · Render / Fly / Railway (stateful ws backend +
volume) · Xirsys (TURN) · Codeprep/Judge0 (code execution)

---

## 📦 Repo layout

```
apps/web      React + Vite frontend (editor, sheets, doodle, call, recap, …)
apps/server   Node CRDT server (Hocuspocus + Yjs) + rewind/streak/code REST API
scripts/      dev orchestrator + history verification
vercel.json   frontend build config (workspace-aware, SPA rewrites)
fly.toml      backend deploy config (Railway alt: railway.toml; Render uses the Dockerfile)
```

---

## 🚀 Local development

```bash
npm install
npm run dev        # web on :5173 · ws + REST on :1234
```

No env vars needed locally — the client defaults to `ws://<host>:1234`. The code-judge
and TURN features degrade gracefully (a friendly "not configured" note) until you add keys.

---

## ☁️ Deployment (two pieces)

A **static frontend** plus a **stateful websocket backend**. Deploy both, then point the
frontend at the backend.

### 1. Backend — Render (or Fly / Railway — anything with one port + a volume)

The server serves websocket **and** REST (`/history`, `/streak`, `/health`, `/turn`,
`/code/*`) on a **single port** (`SINGLE_PORT=1`), because PaaS platforms expose exactly one.

**Render:** New → Web Service → connect this repo → root `apps/server`, Docker runtime
([`apps/server/Dockerfile`](apps/server/Dockerfile)). Add a **Disk** mounted at `/data`.

**Fly:**
```bash
fly launch --copy-empty
fly volumes create syncpad_data --size 1 --app syncpad-ws   # persistence!
fly deploy && fly open        # verify /health → 200
```

> ⚠️ **The volume matters.** Without `/data` mounted, pad snapshots and edit logs are lost
> on every restart — live sync still works, so the bug only shows up later.

| Backend env var | Value / default | Notes |
| --------------- | --------------- | ----- |
| `PORT` | injected by the PaaS | never hardcode |
| `SINGLE_PORT` | `1` | REST shares the ws port (required on Render/Fly) |
| `DATA_DIR` | `/data` | point at the mounted volume |
| `REDIS_URL` | _unset_ | only needed to scale to multiple instances |
| `XIRSYS_PATH` / `_IDENT` / `_SECRET` / `_CHANNEL` | _unset_ | enables cross-network TURN; STUN-only if blank |
| `CODEPREP_API` / `CODEPREP_API_KEY` | _unset_ | enables 💻 group-code judging; 503 if blank |

Details in [`apps/server/.env.example`](apps/server/.env.example). **Secrets live only
here** — the browser never sees the `cpk_` key or the Xirsys secret.

### 2. Frontend — Vercel

From the **repo root**, import the repo (Vercel auto-detects `vercel.json`, which builds
`apps/web` and rewrites deep links like `/r/<key>/sheet`). One required env var:

| Env var | Value | When |
| ------- | ----- | ---- |
| `VITE_WS_URL` | `wss://<backend-host>` (e.g. `wss://syncpad-99lv.onrender.com`) | after step 1 |

```bash
vercel env add VITE_WS_URL production
vercel --prod        # rebuild picks it up
```

The REST URL is derived from `VITE_WS_URL` automatically (same host, `https:`). Set
`VITE_HISTORY_URL` only if you split the API onto a different host.
See [`apps/web/.env.example`](apps/web/.env.example).

---

## ✅ Verify a deployment

1. Open the frontend → you land on `/r/<fresh-random-key>`.
2. Same URL in a second browser/incognito → **both are in one room**; a third visit to the
   bare root must **not** join them.
3. Type in the pad → watch presence dots, the rewind slider, and the 📊 recap card link.
4. Start a 🎥 call → share a screen → 📌 pin it → draw on it from the other window.
5. Server log shows one connection per browser; the client console has **no** `failed to
   fetch` (that would mean a wrong `VITE_WS_URL`).

---

<p align="center">
  <sub>Built as a portfolio-grade deep dive into <b>CRDTs</b>, <b>WebRTC</b>, and <b>PaaS
  infra</b> — offline-first sync, single-port stateful deploys, and zero-trust secret
  handling included. 💜</sub>
</p>
