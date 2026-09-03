# Decisions log

Cross-cutting choices for Cookbook. Newest at the bottom.

## 2026-07-08 — Project setup (`/build-project`, greenfield)
- **Stack:** React + Vite PWA (plain CSS) frontend; Express + SQLite (`better-sqlite3`) backend;
  Google Gemini (free Flash model) for video→recipe; yt-dlp for Instagram/TikTok downloads.
- **Hosting:** home machine + private Tailscale tunnel; no in-app auth (only my devices reach it).
- **Styling:** plain hand-written CSS, not Tailwind — the Phase-1 scaffold already uses it and
  the design is achievable without a framework.
- **Testing:** manual QA for now; no automated test runner yet.

## 2026-07-08 — Design import ("Pantry") and scope reconciliation
- Imported the claude.ai/design prototype "Recipe tracking with AI video" → `design/Pantry.dc.html`,
  mapped in `docs/design.md`. **The design supersedes `plan.md` where they differ.**
- **Scope:** build the **full app** — all 6 screens: Library, Recipe Detail, AI Video Import,
  Meal Plan, Shopping List, Cooking Mode.
- **Video sources:** **Instagram + TikTok only.** The design copy also mentions YouTube; we are
  intentionally *not* building YouTube support. AI Import copy/sample links must be adjusted to
  drop YouTube.
- **Cooking Mode:** build the design's **text-only** full-screen step mode (no video pane). The
  earlier idea of a video-beside-steps cook mode is not part of this build.
- **Data model expanded** beyond `plan.md` to match the design: recipes gain `description`,
  `cuisine`, `category`, `minutes`, `servings`, `rating`, `favorite`, `image`; `ingredients`
  become `{name, qty}` objects (not plain strings). New stores: meal plan and shopping list.
- The Phase-1 scaffold (`server/` + `client/`, manual recipe CRUD) is the starting point and will
  be extended/refactored to fit the fuller schema and screens.

## 2026-07-08 — Measurements: imperial-only
- The AI import must **capture measurements and always normalize them to imperial**: weights in
  oz/lb, volumes in cups/tbsp/tsp/fl oz, oven temperatures in °F, lengths in inches. No metric
  units stored or shown. (Corrected from an earlier note that said metric — target is imperial,
  converting *from* metric.)
- The Gemini extraction prompt is responsible for the conversion (using caption + spoken amounts).
  Note: weight→volume conversions (e.g. "200 g flour") are ingredient-dependent — instruct the
  model to use standard culinary conversions and prefer volume (cups/tbsp) for dry goods where a
  recipe would, fluid oz/cups for liquids. Amounts remain user-editable in the draft form, so
  estimates can be corrected.
- Manual recipe entry should also expect imperial (no auto-conversion there — just an imperial convention).

## 2026-07-08 — Spec approval: resolved the 11 open questions in `specs/pantry.md`
- **Vegetarian** → a `tags: string[]` column; "Vegetarian" chip = tag match (no `veg` bool).
- **`notes`** → dropped; folded into `description`.
- **`category`** → free-text; Dinner/Breakfast/Dessert drive chips; others allowed.
- **Meal-plan day key** → ISO date `YYYY-MM-DD` (not 0–6 index).
- **Remove meal from day** → yes, small × control (hover desktop / visible phone).
- **Desktop Detail "Add to plan"** → opens a day chooser (this week, today preselected).
- **Phone add-to-plan** → not on phone Detail; done via the Meal Plan screen (matches design).
- **Phone AI draft** → all key fields editable (needed for imperial correction); condensed layout kept.
- **Manual entry UI** (design omits it): desktop "+ New recipe" in Library header; Edit/Delete on
  Recipe Detail (Delete confirmed); phone Add tab gets an "Enter manually" link. Reuse/evolve `RecipeForm`.
- **Extract endpoints** → two: `POST /api/extract` (URL) + `POST /api/extract/upload` (multipart).
- **Manual shopping duplicates** → allowed; only recipe-add de-dupes by name.

## 2026-07-08 — AI-picked recipe photo (hero frame)
- The extraction prompt now also returns `hero_seconds` — the timestamp of the best "hero"
  frame (finished/plated dish at its most appetizing). `server/extract/frame.js` uses **ffmpeg**
  to grab that frame (scaled to ≤720px wide JPEG) and returns it as a **base64 data URI** set on
  `draft.image`; the frontend previews it and persists it via `POST /api/recipes`.
- Best-effort: if ffmpeg is missing / the timestamp is out of range / anything fails, `image` is
  null and the recipe falls back to the deterministic gradient placeholder. A 1.0s fallback frame
  is tried before giving up.
- **Storage choice:** the image is a **data URI stored in the `image` TEXT column** (not a
  separate file/CDN). Simplest for the draft→save→discard flow (no orphan files, no static
  serving, no delete cleanup). Tradeoff: image bytes ride in `GET /api/recipes` payloads — fine
  for a personal single-user library; revisit with file storage if the collection grows large.
- Requires **ffmpeg** on PATH (already present as a yt-dlp merge dependency).

## 2026-07-09 — History feature (/feature)
- New "History" section: a log of what was cooked, per entry. Each entry LINKS to a Library
  recipe (`recipe_id`); **multiple entries per day** are allowed.
- Entry fields: `date`, `rating` (1–5, optional), `image` (the user's own uploaded photo,
  downscaled client-side to ≤800px JPEG and stored inline as a data URI), `description`.
- History entries **persist even if the linked recipe is deleted** (GET hydrates `recipe: null`);
  intentionally NOT cascaded on recipe delete (unlike meal_plan, which does cascade).
- Backend: `history` table + `GET/POST/PATCH/DELETE /api/history` (hydrated with the recipe).
- Frontend: History tab (desktop sidebar + phone tab bar, now 5 phone tabs), a self-contained
  HistoryScreen with an internal add/edit modal (recipe picker + date + star rating + photo + notes).
- **Finishing Cook Mode** (Done on the last step) opens a pre-filled History entry (that recipe +
  today's date); closing Cook Mode via the X does NOT log.

## 2026-07-09 — Meal Plan becomes a month calendar
- The Meal Plan screen shows a **month** (not the current Mon–Sun week) and can page to
  **previous / future months**. A "Today" control jumps back to the current month.
- **API contract:** `GET /api/meal-plan` takes optional `?start=YYYY-MM-DD&end=YYYY-MM-DD`.
  With no params it defaults to the **current month's calendar grid** range. Response shape
  changes from `{ week, plan }` to **`{ start, end, days, plan }`** — `days` is every ISO date in
  the range (inclusive), `plan` is keyed by ISO date with an entry array for every day in `days`.
  Range is capped at **62 days**; malformed or inverted ranges → `400`.
- The client asks for the **full calendar grid** (Mon-first weeks that cover the month, so the
  first and last rows may include adjacent-month days), not just the 1st–last of the month. Those
  adjacent-month cells render dimmed but are still plannable.
- **Phone layout:** a month grid can't hold meal thumbnails, so phone shows a compact grid with a
  per-day meal-count dot, and **tapping a day opens a day sheet** listing that day's meals with
  add/remove. Desktop keeps inline thumbnails in each cell.
- `getCurrentWeekDates` stays in `client/src/utils/week.js` — **Recipe Detail's "add to plan" day
  picker still offers the current week only**, which is unchanged and intentional. Month helpers
  live in a new `client/src/utils/month.js`.

## 2026-07-09 — Pantry feature (/feature)
- New "Pantry" section: an inventory of ingredients you have at home. Sidebar order:
  Library, Meal Plan, Shopping List, **Pantry**, History (phone bar → 6 tabs).
- Item fields: `name`, `qty`, `category`. Categories are a fixed set: Produce, Dairy & Eggs,
  Meat & Seafood, Bakery, Frozen, Pantry staples, Beverages, Condiments & Spices, Other.
  Grouped by category on screen.
- **Shopping → Pantry**: "Move checked → Pantry" takes the CHECKED shopping items, adds them to
  the Pantry (auto-categorized by a server-side keyword guesser, de-duped by case-insensitive
  name), and REMOVES them from the shopping list.
- **Pantry → Shopping** ("running low"): a per-item button adds that pantry item to the shopping
  list (de-duped by name); the item STAYS in the pantry.
- Backend: `pantry` table + `GET/POST/PATCH/DELETE /api/pantry`, plus
  `POST /api/shopping-list/move-to-pantry` and `POST /api/pantry/:id/to-shopping`.

## 2026-07-09 — Recipe cover photo: candidate picker + upload (not auto-only)
- Auto single-frame hero pick proved unreliable (some videos end on the creator, not the dish),
  so the user gets to CHOOSE the cover photo. No extra AI call (quota-sensitive; user declined billing).
- At import, the extractor grabs SEVERAL candidate frames (weighted toward the end + the AI's
  hero timestamp); the draft returns `imageCandidates: string[]` (data URIs) and defaults `image`
  to the first. The AI-draft UI lets the user tap the best frame, or upload their own photo.
- Existing recipes: a "Change photo" flow (upload your own, or re-pick a frame). New endpoint
  `POST /api/recipes/:id/frames` re-downloads the recipe's source_url and returns candidate frames.
- Frames are ≤720px JPEG data URIs; only the CHOSEN one is persisted on the recipe (candidates are transient).

## 2026-07-09 — Duplicate recipe saves: guard the client, dedupe the server
- **Bug:** one AI-extracted draft became 5 identical `recipes` rows (same payload, 9s apart).
  Not a service-worker replay — the Workbox `runtimeCaching` rule for `/api/recipes` has no
  `method`, so it defaults to GET and never touches the create POST. `workbox-background-sync`
  is only a transitive dep of `workbox-build`, never instantiated.
- **Root cause:** the "Save to library" button in `AddFromVideo.jsx` had no in-flight guard.
  Each click fired its own `POST /api/recipes`, and the server mints a fresh `randomUUID()` per
  request with no dedupe. Saves are slow (≈87KB base64 image up, then `loadRecipes()` pulls every
  recipe with its inline base64 image back down), so the screen stays clickable for seconds after
  the first save. The user clicked ~5 times, the tab locked up, Chrome was force-quit. The
  force-quit was a **symptom, not the cause**.
- **Fix, both layers:**
  - Client: `saving` state + `useRef` guard; button `disabled` and labelled "Saving…"; Discard
    disabled mid-save; reset on failure only (matches `RecipeFormScreen.jsx`). The ref matters —
    a `useState` check alone reads a stale closure value on a fast second click.
  - Server: `POST /api/recipes` short-circuits when a **non-null** `source_url` was already saved
    within **60 seconds**, returning the existing recipe as **200** (genuine creates stay **201**).
- **Rejected:** a `UNIQUE` index on `source_url`. It would permanently block deliberately
  re-importing the same video as a variant recipe. The time window preserves that flow.
- Manual entries (`source_url: null`) are never deduped.
- The 4 duplicate rows were deleted (kept the oldest); `server/cookbook.db.backup-20260709-dupes`
  holds the pre-cleanup DB and is gitignored via a new `*.db.backup-*` rule.

## 2026-07-10 — Cook Mode: video pane + per-step timestamps (supersedes the 2026-07-xx "text-only" call)
- **Supersedes** the earlier "Cooking Mode: build the design's text-only full-screen step mode (no
  video pane). The earlier idea of a video-beside-steps cook mode is not part of this build."
  We are now building exactly that: instructions left, source video right, seeking per step.
- **Timestamps ride the existing single Gemini call.** The model already receives the real video via
  the Files API and already returns one timestamp (`hero_seconds`, for cover-frame picking). The
  prompt's `"steps": ["string"]` becomes `[{"text","t"}]`; `coerceDraft` splits that into
  `steps: string[]` + `stepTimes: number[]`. **Still 1 call per import** — free tier, no billing.
- **`steps` stays `string[]` in the DB.** Timestamps live in a NEW parallel `step_times` column
  (JSON number[]). Rejected changing `steps` to `{text,t}` objects: that shape ripples through 7
  files including both step-editing UIs (`RecipeFormScreen`, `AddFromVideo`) and would drag
  timestamps into manual recipes that can never have a video. The parallel column touches ~3.
- **Video is persisted at import.** yt-dlp's temp file was always `rm -rf`'d in a `finally`; now it
  is stashed to `server/media/drafts/<token>.mp4`, the draft carries a `videoToken`, and saving the
  recipe moves it to `server/media/<recipe_id>.mp4`. Rejected re-downloading on every Cook Mode open
  (10–30s stall before you can cook, breaks offline, depends on yt-dlp + IG cookies working that day).
- **`GET /api/recipes/:id/video` must support HTTP Range (206).** `<video>` cannot seek without it.
- Deleting a recipe deletes its video file; orphaned drafts are swept.
- **No timestamp editor** in the AI-draft UI for v1. The video pane has a scrubber, so a slightly
  wrong `t` costs a drag, not a broken feature. Revisit only if the model proves inaccurate.
- **Phone is functional-only, deliberately.** Video on top, step below, no design investment — the
  user is redesigning the entire phone app separately. Backend is fully capable regardless.
- Existing 14 recipes are backfilled once via a script (re-download + 1 Gemini call each for
  timestamps against their existing steps). Dead IG links / stale cookies will fail; report, don't fake.
- `server/media/` is gitignored (video bytes never enter git).

## 2026-07-10 — yt-dlp browser impersonation (curl_cffi) to reduce IG/TikTok bot-blocks
- **Problem:** Instagram/TikTok began 404-ing / IP-blocking the server's yt-dlp downloads
  (recipe imports fail with "Could not read that video"). Logs showed
  `attempting impersonation, but no impersonate target is available` — yt-dlp couldn't disguise
  its TLS/HTTP fingerprint as a browser because `curl_cffi` wasn't installed.
- **Fix (env):** installed `curl_cffi` into the yt-dlp Homebrew formula's own venv:
  `~/.homebrew/Cellar/yt-dlp/<ver>/libexec/bin/python -m pip install --no-cache-dir curl_cffi`.
  `yt-dlp --list-impersonate-targets` then lists 37 targets. The launchd service
  (`com.cookbook.server`) resolves to `~/.homebrew/bin/yt-dlp` (its plist PATH has no
  `/opt/homebrew/bin/yt-dlp` shadowing it), so the service sees the capability. No plist change.
- **Fix (code):** `server/extract/ytdlp.js` passes `--impersonate chrome` (generic alias — auto-picks
  best available Chrome target, won't go stale) on its yt-dlp calls, with a **graceful fallback**:
  if a call fails because impersonation is unavailable, retry WITHOUT the flag so imports degrade to
  prior behavior instead of breaking entirely.
- **CAVEAT (must remember):** a future `brew upgrade yt-dlp` / `brew reinstall yt-dlp` recreates the
  Cellar venv and **wipes curl_cffi** → impersonation silently regresses until the pip install above
  is re-run. The code fallback keeps imports working (un-impersonated) if that happens.
- **Limit:** impersonation stops the server from *looking* like a bot; it does NOT punch through an
  IP that is *already* actively blocked. Recovery from an active block still needs a cooled-down IP
  or "upload the file instead" (which bypasses yt-dlp entirely).
- Incident note: the active block that surfaced this was triggered by an agent's burst of yt-dlp
  probe requests against IG during feature testing — pace/avoid live IG/TikTok requests in tooling.

## 2026-08-23 — Pantry receipt import (photo → AI → bulk add)
- **Destination is the Pantry, not the shopping list.** A receipt is proof of what you *already
  bought*, so the items belong in the inventory. This mirrors the existing
  `POST /api/shopping-list/move-to-pantry` (checked → pantry) rather than competing with it.
- **Two endpoints, never one.** `POST /api/pantry/receipt` returns a **draft** and persists nothing;
  `POST /api/pantry/bulk` saves the reviewed items. Receipt OCR is genuinely messy — abbreviated
  names, weighed lines, non-grocery clutter — so the review step is load-bearing, not a nicety.
  Every row in the review list is editable and de-selectable before anything is written.
- **Inline image data, not the Gemini Files API.** Receipt photos are a few MB, so a single inline
  request avoids the upload → poll → generate round-trip that video extraction needs. ~4–5 s
  end-to-end. Capped at 12 MB (inline requests are base64'd and Gemini caps near 20 MB).
- **Reuses the video path's model-fallback chain.** `resolveModelChain`/`withTimeout`/
  `classifyGeminiError`/`parseModelJson` are now exported from `extract/gemini.js` and shared, so a
  429 on one free-tier model falls through to the next exactly as video extraction does.
- **Non-food is excluded on purpose.** The prompt drops cleaning supplies, paper goods, toiletries,
  pet and pharmacy items along with the subtotal/tax/payment lines. The Pantry's fixed category list
  has no "Household" bucket, so those would all land in "Other" and just add noise. If a household
  inventory is ever wanted, that's a category-list change first.
- **De-dupe skips, it does not update.** A name already in the pantry is reported in `skipped` and
  left untouched — re-scanning the same receipt is safe and will not clobber a quantity the user
  has since edited by hand. Same case-insensitive name rule as `move-to-pantry`.
- Verified end to end against a synthetic receipt: abbreviations expanded (`BNLS SKNLS CHKN BRST` →
  "Boneless skinless chicken breast"), metric converted (`500ML` → `17 fl oz`), weighed line read as
  `1.87 lb`, and paper towels / wipes / tax / card lines all correctly dropped.

## 2026-08-24 — Pantry drops quantities (UI only)
- The Pantry is now **just what you have**, not how much: no quantity on the item rows, the
  add/edit form, or the receipt-import review list (which is name + category).
- **The API and DB are unchanged** — `pantry.qty` still exists, `POST/PATCH /api/pantry` still
  accept it, and `POST /api/shopping-list/move-to-pantry` still copies a qty across. It is simply
  never displayed. Deliberately non-destructive: no migration, and re-surfacing quantities later is
  a UI change only. Nothing reads the column today, so stale values are inert.
- `POST /api/pantry/receipt` still returns `qty` per the §7 docs; the review modal discards it.
  Left in place so the endpoint stays a general receipt reader rather than being narrowed to the
  Pantry's current UI.

## 2026-09-02 — Port 3001 is the always-on address; dist rebuilds itself
- **:3001 is the real address for both Mac and phone.** `com.cookbook.server` already served the
  API plus `client/dist` there; the phone reaches it over Tailscale at
  `carsons-macbook-air.tailcbc03a.ts.net:3001` (or `100.119.245.13:3001`). The Vite dev server on
  :5173 stays localhost-only and is for development only — it is deliberately **not** exposed with
  `--host`, so there is exactly one URL to remember per device.
- **New LaunchAgent `com.cookbook.build`** (`deploy/com.cookbook.build.plist`) runs
  `vite build --watch` against `client/`. The failure mode it removes: `client/dist` was a snapshot
  from whenever `npm run build` last ran, so the phone could silently be weeks behind the source.
  Now every saved client change rebuilds dist in <1s and :3001 serves it immediately.
- **Why `vite build --watch` and not a dev server on :3001.** The phone install is a PWA — it needs
  the real production build (hashed assets, generated `sw.js`, precache manifest), which the dev
  server does not produce. Watch-mode build keeps the artifact production-shaped and current.
- **Known tradeoff:** a page load that lands mid-rebuild can miss a hashed asset for a moment.
  Builds take well under a second and the service worker is `autoUpdate`, so a reload fixes it.
  Not worth an atomic-swap build directory for a single-user app.
- **Server code is still not hot.** `com.cookbook.server` runs plain `node index.js`; edits under
  `server/` need `cd server && npm run service:restart`. Left as-is on purpose — `node --watch`
  would bounce the API (and any in-flight yt-dlp/Gemini extraction) on every keystroke-save.

## 2026-09-02 — Shopping List price estimation (scope decisions)
Feature: pick a grocery store, press a button, get an estimated price for the whole list.
The explorer confirmed there is **no** existing price/cost code, no external price API, and no
settings store anywhere in the repo — so these are fresh calls, not inferences from existing code.

- **Price source: Gemini, not a real store API.** Reuses `GEMINI_API_KEY` and the shared helpers
  already exported from `extract/gemini.js` (`resolveModelChain`, `withTimeout`,
  `classifyGeminiError`, `parseModelJson`), exactly as `extract/receipt.js` does. Rejected the
  Kroger developer API: it returns genuinely accurate per-store prices but requires an OAuth
  client registration and only covers Kroger-family banners. The user asked for an *estimate*, and
  Gemini works for any store named. **This is an estimate and the UI must say so** — never present
  it as a real price.
- **Prices are cached in a price book, not re-asked every press.** New `price_book` table keyed by
  (store, zip, normalized item name) holding a unit price, the qty string it was priced for, and
  `updated_at`. A press prices only the items missing or stale from the book, so the second press
  on an unchanged list costs zero Gemini calls. **Staleness: 30 days**, after which an entry is
  re-estimated. This is what keeps a free-tier key viable.
- **Prices do NOT go on `shopping_list` rows.** The explorer documented how the hidden
  `req_base`/`req_dim` columns silently desync when `PATCH /api/shopping-list/:id` edits a qty.
  Adding price columns to the same table would reproduce that failure mode. The book is keyed by
  item name and joined at estimate time; the estimate response carries per-item prices transiently.
- **Store choice is server-persisted, in a new `settings(key, value)` table.** Client `localStorage`
  (the `cookbook.filterLayout` pattern in `utils/filters.js`) was the alternative, but the store is
  a *shared* preference: the Mac and the phone must agree, and the estimate endpoint itself needs
  the store to build its prompt. Follows the existing `CREATE TABLE IF NOT EXISTS` + boot-time
  `PRAGMA table_info` migrations-array pattern in `server/db.js`.
- **Store picker = curated chain list + optional ZIP.** Grocery prices are strongly regional, so the
  ZIP materially changes the answer; it stays optional so the feature works without it.
- **Display: per-item price + a list total.** Rejected total-only — a per-item breakdown is what
  lets an obviously-wrong estimate be spotted, which matters precisely because the number is
  AI-generated.
- **Out of scope, deliberately:** no currency other than USD, no price history/tracking over time,
  no per-store comparison, and no attempt to fix the pre-existing `req_base`/`req_dim` desync.

### Follow-up calls (same day, after reviewing the spec)
- **Checked items: a toggle, not a fixed rule.** The user asked for "an option where I can discount
  checked stuff." So the server prices **every** item regardless of checked state, and a control on
  the Shopping List decides whether checked items count toward the **total**. Because every row is
  already priced, the toggle is pure client-side arithmetic — flipping it costs zero Gemini calls
  and never triggers a re-estimate. The control only appears when at least one item is checked;
  default is **exclude checked** (the total answers "what will this shop cost").
- **Store list: the generic 21-chain set plus a free-text "Other…"**, confirmed by the user rather
  than narrowed to their actual stores. Trimming it later is a one-line edit to the server list.
- **`ShoppingFormModal` is fixed first, as a separate change.** `ShoppingList.jsx:348` renders a
  component that is never imported and does not exist anywhere in the repo; pressing "+ Add item"
  throws `ReferenceError` and, with no error boundary, unmounts the whole screen. Confirmed live in
  the running app, not just by grep. It predates this feature and is in the uncommitted working
  tree. It lands before the price work because it shares `ShoppingList.jsx` (so parallel edits would
  collide) and because QA cannot build a list by hand to test estimation against while it is broken.

### QA gate findings — resolutions (2026-09-02)
`qa-agent` returned NO-GO. Two of its findings needed a call from me rather than a mechanical fix:

- **Same name, different qty now keys the price book separately.** QA found that two rows named
  "Milk" with qty `1 gal` and `2 gal` oscillate forever: grouping is by name only, so each press
  re-prices whichever variant lost the last round — a permanent one-Gemini-call-per-press drip that
  silently defeats the whole point of the cache, plus a row that briefly displayed `2 gal` while
  carrying the price of `1 gal`. **Fix:** group by `name_key + qty`, and widen the unique index to
  `(store, zip, name_key, qty_priced)`. Identical duplicates still collapse to one prompt entry, so
  AC-24 is preserved. The tradeoff, accepted: a qty edit now leaves the old row behind instead of
  overwriting it in place, so the book grows slightly until the 30-day expiry sweeps it. Rows are
  tiny and single-user; an unbounded quota drip is the worse failure.
- **AC-15 was ambiguous and is corrected in the spec.** It said the total equals the sum of the
  *visible* prices, which contradicts §6.3 state 4 ("sum rows still on the list"). With a search term
  or a category chip off, hidden priced rows still count. §6.3 is the governing rule — **the total is
  a list total, not a view total** — and AC-15 now says so, so a future reader doesn't "fix" the
  client into matching the looser wording.

## 2026-09-02 — Correcting the always-on build watcher (it was serving 500s)
The `com.cookbook.build` watcher added earlier today had a real defect, found when the backend
agent noticed `ENOENT: client/dist/index.html` in `server/cookbook.log`.

- **What was wrong:** `vite build --watch` defaults to `emptyOutDir: true`, so every rebuild
  **deleted `client/dist` before rewriting it**. During that window the always-on server on :3001 —
  which is the *phone's* URL over Tailscale — had no `index.html` and its SPA fallback route threw.
  Measured: **46 consecutive 500s** while polling `http://localhost:3001/` through one rebuild.
- **The earlier entry understated this.** It said a page load landing mid-rebuild "can miss a hashed
  asset for a moment" and judged an atomic-swap build directory not worth it. That was wrong: the
  app shell itself disappeared, not just an asset, and during active editing the window is hit
  constantly. Corrected here rather than edited above, so the mistake stays visible.
- **Fix:** `build.emptyOutDir: !process.env.COOKBOOK_WATCH_BUILD` in `client/vite.config.js`, with
  `COOKBOOK_WATCH_BUILD=1` set in the LaunchAgent. Watch-mode rebuilds now overwrite in place and
  never leave the directory without an `index.html`; a plain `npm run build` still does a clean
  build. Re-measured: **0 non-200s across 80 polls** spanning a full rebuild. The cost is that
  superseded hashed assets accumulate in `dist/` until the next clean build — harmless, gitignored,
  and far cheaper than serving errors to the phone.
- **Gotcha worth remembering:** `launchctl kickstart -k` restarts a job using the **already-loaded**
  plist, so it does NOT pick up plist edits (new env vars included). The first fix attempt appeared
  to fail for exactly this reason — the env var never reached the process. Plist changes need
  `launchctl unload` + `load`; `kickstart -k` is only enough for code changes.

### Post-GO follow-ups (2026-09-02)
`qa-agent` returned GO with three non-blocking items. Resolutions:

- **A blank-qty item must still cache — the cache key is the *requested* qty, not the priced one.**
  QA found a row with an empty `qty` costs a Gemini call on *every* press, forever: the book stores
  `qty_priced` = the model's *assumed* qty ("1 each"), but the lookup compares that column against
  the row's own qty (`""`), so it can never match. Pre-existing, not caused by the index widening.
  It is really a spec conflict: §5.2's hit rule and §7 mandate the miss, while AC-17 — "second press
  costs zero Gemini calls", the feature's headline promise — forbids it. **The code wins**: split the
  two concepts. `qty_key` (the row's requested qty, verbatim, `''` allowed) becomes part of the
  unique key; `qty_priced` stays as display-only provenance ("Priced as 1 loaf"). Conflating them
  was the actual mistake. Amending AC-17 instead was rejected — "pressing it twice is free" is the
  reason the cache exists, and "+ Add item" leaves qty optional, so blank-qty rows are easy to hit.
- **The `emptyOutDir` fix traded one bug for a smaller one; both get fixed, not one or the other.**
  With `emptyOutDir: false`, Workbox globs the output dir and precaches every superseded bundle, so
  the PWA manifest grows ~330 KB per content-changing rebuild without bound — and the phone
  re-downloads that dead weight over Tailscale on each service-worker update. Keep
  `emptyOutDir: false` (the app shell must never vanish from :3001) **and** prune orphaned files in
  `dist/assets` after each bundle write. Rejected "just revert to `emptyOutDir: true`": that brings
  back 46 consecutive 500s on the phone's URL, which is far worse than a bloated precache.
- **AC-19 and §3.2/§5.2 of the spec are now false and get amended.** They still describe the price
  book as upserting onto one key and "replacing rather than duplicating" on a qty edit. The shipped
  behavior is the opposite by design — it is *why* the oscillation fix works. Docs (`docs/api.md`,
  `docs/data-shapes.md`) were already updated; the spec was not, and the spec is what the next
  fresh-context agent reads.

## 2026-09-02 — Settings, reached from "My Kitchen"
- **"My Kitchen" in the sidebar footer becomes a button that opens a Settings modal.** It was a
  plain non-interactive `<div>` (`AppShell.jsx:118-124`). Chosen over a popover menu (an extra click
  for one destination) and over a `/settings` route (a whole page for two fields today).
- **Contents: grocery store + ZIP only**, deliberately. It is the one real app-level setting that
  exists; the modal is built so more can be added without rework.
- **The store form gets extracted into ONE shared component.** `StorePickerModal` currently lives
  inline in `ShoppingList.jsx`, and Settings needs the same fields. Copying it would create a second
  source of truth for the chain list, the ZIP validation, and the "Other…" free-text path — the same
  drift hazard `PANTRY_CATEGORIES` already has in two places. The Shopping List keeps its own store
  shortcut (it is contextual there, right next to Estimate cost); both entry points render the same
  component and hit the same `GET`/`PUT /api/shopping-list/store`.
- **Phone reaches Settings via a gear in the header**, not a sixth bottom tab (`docs/decisions.md`
  already flags the tab count as a pressure point) and not desktop-only (the phone is the device
  actually used for shopping, so the store must be editable there). **Known collision to solve:**
  there is no global phone header — each screen renders its own `library-header`, and several
  already put a button at the top-right on phone (Shopping List's "+ Add", Library's "+ New recipe").
  The gear must not sit on top of those.

## 2026-09-02 — Prices persist per item, not per estimate
User: "If I hit estimate cost I want the value to stay next to that ingredient forever (at least
while it remains in shopping list)." This is a **model change**, not a display tweak.

- **Before:** an estimate was a *snapshot of the whole list*, held in React state and gone on
  reload (spec §8.5 made that an explicit assumption). **Now:** a price is a *property of an item*,
  keyed as it already is by `(store, zip, name_key, qty_key)` in `price_book`, and rendered whenever
  the book has one. Nothing new is persisted — the prices were already server-side for 30 days;
  the client simply never asked for them again.
- **New `GET /api/shopping-list/prices`** hydrates from the cache and **never calls Gemini**. A
  separate read endpoint rather than a `cachedOnly` flag on `POST /estimate`, so the read path
  cannot spend quota even by accident.
- **Hydration deliberately ignores the 30-day age; the estimate path still honors it.** Reading is
  "show me everything you have" (a price must never silently vanish — that was the whole request);
  pressing Estimate is "fill the gaps and refresh anything stale". The two paths want different
  answers from the same table, so the age check belongs in the estimate path only.
- **The "List changed —" staleness model largely dissolves.** Adding an item no longer dims
  everyone else's price — the user explicitly chose "keep existing prices solid", and it was always
  a bit false: adding bread does not make the milk price less true. Unpriced items simply show no
  price, and `N of M items priced` carries that information. Renaming or re-quantifying an item
  changes its cache key, so *that* item loses its price on its own, with no bookkeeping.
- **A store or ZIP change needs no special handling** for the same reason: the key includes store
  and zip, so prices for the old store are simply not found and the rows come back unpriced. The
  self-consistency here is why the cache key was worth getting right earlier.
- **AC-25/26 are NOT violated.** They forbid *auto-estimating*; the mount-time hydration is a read
  that cannot reach Gemini. The property that matters — no Gemini call without a deliberate press —
  is unchanged, and QA should verify it as "zero POST /estimate on load", not "zero requests".

## 2026-09-03 — Manual prices, and why "estimate overwrites manual" is literal
User: "I would also like the ability to change the price manually (before and after estimate).
Estimate should overwrite manual."

- **A manual price is a `price_book` row, not a new column on `shopping_list`.** Same
  `(store, zip, name_key, qty_key)` key as an AI price, plus a new `source` column (`'ai'|'manual'`,
  default `'ai'`). This means manual prices hydrate, total, persist across reloads, and clear on a
  qty/store change through the code paths that already exist — no parallel storage, no join, and no
  repeat of the `req_base`/`req_dim` desync that came from hanging derived values off the list row.
- **Overwrite is literal: a `source: 'manual'` row is always a MISS on `POST /estimate`**, so a
  press re-prices it and flips it back to `'ai'`. The user chose this over "manual wins until stale"
  with the cost stated plainly: **every press spends a Gemini call per manually-priced item**. That
  is the accepted trade, not an oversight. Loading the list still costs nothing.
- **Manual prices are visually marked**, because the total block says "AI estimate — not a real
  price" and that sentence is simply false for a number the user typed. The disclaimer has to stay
  truthful once the list is mixed.
- **A manual price requires a store to be set**, since prices are keyed per store+ZIP. With no store
  there is nowhere to put it, so the API returns `NO_STORE` and the UI opens the store picker —
  exactly what pressing Estimate already does in that state.
- **Editing is tap-the-price inline**, not a per-row edit button (the 375px row already carries
  name, qty, price and ×) and not an item sheet (slower for a quick fix). Tapping the `—` on an
  unpriced item is how you price something *before* estimating.
