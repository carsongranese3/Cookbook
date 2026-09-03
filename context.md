# The Cookbook — working context / handoff

Personal recipe **PWA** ("The Cookbook", formerly "Pantry"): save recipes, import from
Instagram/TikTok cooking videos via **Google Gemini** (free tier), meal plan, shopping list,
pantry inventory, cook mode, and a cooking history log. Single-user, runs on the owner's Mac,
reachable from phone via Tailscale. Built with `/build-project` then extended with `/feature`.

See also: `CLAUDE.md` (team brief + orchestration), `docs/decisions.md` (all decisions, newest
at bottom), `docs/api.md` (full endpoint contract), `specs/pantry.md` (original spec),
`design/Pantry.dc.html` + `docs/design.md` (visual reference).

## Stack
- **server/** — Node 20 + Express + SQLite (`better-sqlite3`, single file `server/cookbook.db`).
  Serves the API **and** the built client on port **3001** (single process, `client/dist`).
  `server/extract/` = the AI video→recipe layer (yt-dlp + Gemini Files API + ffmpeg frames).
- **client/** — React + Vite **PWA**, plain hand-written CSS (no framework), Onest font,
  terracotta `#c56a4a` accent. State is a view-state machine in `App.jsx` (no router). Screens in
  `client/src/screens/`, nav in `components/AppShell.jsx`.
- Images (recipe covers, history/pantry photos) are stored **inline as base64 data URIs** in TEXT columns.

## Deployment / ops (IMPORTANT)
- **Always-on server** = a launchd LaunchAgent `com.cookbook.server`
  (`~/Library/LaunchAgents/com.cookbook.server.plist`, source in `deploy/`). It runs
  `node index.js` on :3001, auto-starts at login, restarts on crash. **The app is always running** —
  you do NOT run `npm run dev` for normal use (that causes `EADDRINUSE`; the running service owns 3001).
- After a **backend** edit: `cd server && npm run service:restart` (= `launchctl kickstart -k gui/$(id -u)/com.cookbook.server`).
- After a **frontend** edit: `cd client && npm run build` (the live server serves the fresh `dist`; no restart needed).
- Dev mode (rarely needed): `npm run service:stop` → `npm run dev` → `npm run service:start` when done.
  Also `npm run service:log` to tail `server/cookbook.log`.
- **Phone access**: Tailscale HTTPS at **https://carsons-macbook-air.tailcbc03a.ts.net** (`tailscale serve` → :3001).
  The Mac must be awake/online. `tailscale` CLI is a wrapper in `~/.homebrew/bin` (App Store build).
- **PWA caching gotcha**: installed PWAs cache aggressively. To see updates, **fully close & reopen**
  the app (iPhone: swipe-close, maybe twice) or hard-refresh (Cmd-Shift-R). Manifest is `autoUpdate`.

## Agent/tooling environment gotchas
- Bash runs sandboxed: **binding a port or `curl localhost` needs `dangerouslyDisableSandbox: true`**.
- `npm install` hits a root-owned `~/.npm` cache → use
  `--cache /private/tmp/claude-501/-Users-carsongranese-dev-GitHub-Cookbook/18e8bc11-9fd6-4da7-9b6a-9ff62bac63c3/scratchpad/.npmcache`.
- Node (nvm): `/Users/carsongranese/.nvm/versions/node/v20.20.0/bin/node`. yt-dlp: `~/.homebrew/bin`.
  ffmpeg/ffprobe: `/opt/homebrew/bin`.
- The frontend work has been done by one persistent agent (resume via SendMessage). **Watch for it
  reverting the sidebar wordmark to "Pantry"** — it did once; keep it "The Cookbook".
- User drops review screenshots in the **repo root** (`Screenshot*.png`, gitignored) — look there.

## Secrets (all gitignored — never commit)
`server/.env` (GEMINI_API_KEY, GEMINI_MODEL, GEMINI_MODELS, YTDLP_COOKIES, PORT), `cookies.txt`
(repo root, IG login cookies for yt-dlp), `server/cookbook.db`, `*.log`, `/Screenshot*.png`, `*cookies*.txt`.

## Gemini config (free tier — NO billing, user declined)
- `server/.env` has `GEMINI_MODELS` = ordered fallback chain; extraction cycles through it on 429/503
  and model-capability errors (see `resolveModelChain` + `callModel` in `server/extract/gemini.js`):
  **gemini-3.1-flash-lite (500/day, primary) → gemini-3.5-flash → gemini-3-flash-preview →
  gemini-2.5-flash → gemini-2.5-flash-lite** (last four are ~20/day each). ~580 free req/day total.
- Each import = **1 Gemini call** (extraction + user-filter assignment folded together). Re-runs
  (`assign-filters`, `assign-all`) and manual filter assignment use their own call. Frame grabbing
  is ffmpeg-only (no AI). Quota resets ~midnight Pacific.
- Quota errors surface as `RATE_LIMITED` → friendly "AI over its limit/busy" message (not "could not read video").

## Features (all built + committed)
- **Library** — user-defined **filter list** (server `filters` table; Manage Filters modal: add/rename/
  delete, alphabetical, searchable, no drag). Filter **bar** = pinned chips (drag to reorder/pin, live
  shift) + chevron reveals the rest. **Multi-select = AND**. The AI **assigns filters from the user's
  list** on import; "Assign filters (AI)" per recipe + "Re-run on all".
- **Recipe detail** — hero, stats, ingredients/method, cook button, add-to-list/plan, favorite, source
  "Open original" link, **Change photo** (upload own, or re-pick from video frames), assign-filters.
- **AI import** (`AddFromVideo`) — paste IG/TikTok link or upload file → editable draft with a
  **candidate-frame cover-photo picker** (tap a frame or upload) + filter checklist. IG needs cookies.
- **Meal Plan** — **user rewrote it to a monthly calendar** (`utils/month.js`; backend
  `GET /api/meal-plan?start=&end=`, still back-compatible with no-param current week). Phone day-sheet.
- **Shopping List** — add/check/clear, add-from-recipe (de-duped), **"Move checked → Pantry"**.
- **Pantry** — inventory grouped by fixed categories (Produce, Dairy & Eggs, Meat & Seafood, Bakery,
  Frozen, Pantry staples, Beverages, Condiments & Spices, Other); keyword auto-categorizer on
  shopping→pantry; per-item **"Running low"** → adds to shopping.
- **History** — log a cook (pick recipe, date, ★ rating, upload photo, notes). **Finishing Cook Mode
  (Done) opens a pre-filled entry**; entries survive recipe deletion.
- **Cook Mode** — full-screen text steps, progress, back/next→Done. **PWA** installable + offline read.
- Nav: desktop sidebar = Library, Meal Plan, Shopping List, Pantry, History (Add is desktop's
  "+ New recipe" toggle). Phone bar = 6 tabs: Home, Plan, Add, List, Pantry, Log.

## Data model (SQLite tables)
`recipes` (title, description, cuisine, category, protein[], carb[], minutes, servings, rating,
favorite, image, ingredients[{name,qty}], steps[], tags[], **filters[]**, source_url, source_caption),
`filters` (user's filter list), `meal_plan` (day ISO date → recipe_id), `shopping_list`
(name, qty, checked), `pantry` (name, qty, category), `history` (recipe_id, date, rating, image, description).
Measurements are **imperial** (AI converts from metric).

## Git state
Branch `main`, **no remote yet**. 6 commits, working tree clean. Newest:
`4f1a5b2` Pantry + choosable cover photo + model fallback + rename to The Cookbook.
Commit only when the user asks; end messages with the Co-Authored-By trailer.

## Known issues / next options
- The "Hot Honey Chicken Tenders" recipe has a bad auto-picked cover (creator in an apron) — user
  will fix it via **Change photo** now that the picker exists.
- Phone has **6 bottom tabs** (tight); could pair Shopping+Pantry under one tab if it feels cramped.
- Not pushed to GitHub yet — offer `gh repo create` + push when wanted.
- Existing pre-feature recipes may lack protein/carb/filters until re-imported or edited.
