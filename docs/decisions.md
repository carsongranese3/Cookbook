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
