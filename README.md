# Cookbook ("Pantry")

A personal recipe app for computer + phone, built as an installable PWA. Save, search, and
favorite recipes; plan meals for the week; keep a shopping list; cook hands-free in a full-screen
step-by-step Cooking Mode; and turn an **Instagram Reel / TikTok** cooking video into a structured,
editable recipe using a free AI (Google Gemini). All measurements are imperial.

See [`plan.md`](./plan.md) for background, [`specs/pantry.md`](./specs/pantry.md) for the full spec,
and [`docs/`](./docs) for the API contract, data shapes, design mapping, and decisions log.

## Structure
- `server/` — Node + Express API on SQLite (`better-sqlite3`). Holds the Gemini key, runs yt-dlp.
  - `server/extract/` — the video→recipe extraction layer (yt-dlp + Gemini Files API).
- `client/` — React (Vite) PWA frontend, plain CSS.

## Setup

**1. Backend env** — copy the example and add your key:
```bash
cd server
cp .env.example .env
# then edit .env and set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey)
```

**2. Install yt-dlp** (needed for Instagram/TikTok link import):
```bash
brew install yt-dlp        # macOS
# pip install yt-dlp       # Linux
```
Instagram Reels sometimes need a logged-in cookies file — if links fail, export one and set
`YTDLP_COOKIES=/absolute/path/cookies.txt` in `server/.env`. Uploading a video file always works
without yt-dlp.

**3. Install deps and run (two terminals):**
```bash
# terminal 1 — API on http://localhost:3001
cd server && npm install && npm run dev

# terminal 2 — app on http://localhost:5173
cd client && npm install && npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api/*` to the backend.

**Use it from your phone:** on the same network, `cd client && npm run dev -- --host` and open
`http://<your-computer-ip>:5173`. For access anywhere, put the app behind a private
[Tailscale](https://tailscale.com) tunnel (see `docs/decisions.md` for the hosting plan).

## Where to open it (this machine)

Two LaunchAgents in [`deploy/`](./deploy) keep port 3001 always on and always current, so these
URLs work without starting anything:

| Where | URL | Serves |
| --- | --- | --- |
| Mac — everyday use | http://localhost:3001 | built app + API (`com.cookbook.server`) |
| Mac — while developing | http://localhost:5173 | Vite dev server, hot reload (`npm run dev`) |
| Phone (Tailscale) | http://carsons-macbook-air.tailcbc03a.ts.net:3001 | same as :3001 |
| Phone (Tailscale, by IP) | http://100.119.245.13:3001 | same as :3001 |

The dev server on :5173 is localhost-only, so the phone must use :3001.

**Always-on services** — installed once with `cp deploy/*.plist ~/Library/LaunchAgents/` and
`launchctl load` on each:

- `com.cookbook.server` — the API + built app on :3001. Managed from `server/`:
  `npm run service:restart` / `service:stop` / `service:start` / `service:log`.
- `com.cookbook.build` — `vite build --watch`, which rebuilds `client/dist` on every client
  source change so :3001 (and therefore the phone) always serves the latest UI. Managed the same
  way from `client/`, logs to `client/build.log`.

Server-side edits are the one exception: `com.cookbook.server` runs plain `node index.js`, so
after changing anything in `server/` run `cd server && npm run service:restart`.

> Note: if `npm install` errors with `EPERM` on a root-owned cache, run once:
> `sudo chown -R $(id -u):$(id -g) ~/.npm`

## Features
Library (search + filters + favorites) · Recipe Detail · AI video import (upload or IG/TikTok link)
· Meal Plan (week) · Shopping List · full-screen Cooking Mode · installable + offline-capable PWA.
