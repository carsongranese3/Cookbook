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
