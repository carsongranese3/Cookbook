# Spec: Pantry (Cookbook) — full app

Status: greenfield build with an imported design prototype and a Phase-1 scaffold to extend.
Sources of truth this spec derives from and must not contradict: `CLAUDE.md`, `docs/design.md`,
`design/Pantry.dc.html` (visual reference only, not runnable), `docs/decisions.md`. Where
`plan.md` differs from the design or decisions, the design and decisions win.

This spec feeds `data-agent` (writes `docs/data-shapes.md`), `backend-agent` (writes
`docs/api.md`), and `frontend-agent`, each of which starts from fresh context. Field names
here are authoritative — match them exactly, do not invent.

---

## 1. Overview

Pantry ("Cookbook") is a personal, single-user recipe app for one person's own devices
(desktop + phone), delivered as an installable React PWA behind a private Tailscale tunnel
(no in-app auth). It lets the owner save, search, filter, and favorite recipes; view a recipe
and cook it hands-free in a full-screen step-by-step Cooking Mode; plan meals across the week;
keep a running shopping list; and — the headline feature — turn an Instagram Reel or TikTok
cooking video into a structured, editable recipe draft using Google Gemini (free Flash model),
run entirely server-side. All measurements are imperial.

---

## 2. Current state vs. delta (the scaffold)

This is not a from-scratch build. A Phase-1 scaffold exists and must be **extended/refactored**,
not thrown away or re-specified wholesale.

Current behavior (as built):
- `server/db.js` — one `recipes` table. Schema is the **old `plan.md` shape**: `id, title,
  servings (TEXT), ingredients (JSON string[]), steps (JSON string[]), notes, source_url,
  source_caption, created_at, updated_at`.
- `server/index.js` — REST CRUD for recipes only: `GET /api/health`, `GET /api/recipes`,
  `GET /api/recipes/:id`, `POST /api/recipes`, `PUT /api/recipes/:id`, `DELETE /api/recipes/:id`.
  `normalizeBody` coerces `ingredients`/`steps` to **arrays of strings**.
- `client/` — React + Vite with `RecipeList`, `RecipeView`, `RecipeForm`, and `api.js` (relative
  `/api/*`, list/get/create/update/remove).

The delta this build introduces:
- **Recipe schema expands** to the design model (below): add `description, cuisine, category,
  minutes, servings (INTEGER), rating, favorite, image, source_caption`; change `ingredients`
  from `string[]` to **`{name, qty}[]`**; keep `steps` as ordered step text; drop `notes` (or
  fold into `description` — see open questions). `data-agent` owns the migration approach.
- **Two new stores**: meal plan and shopping list, each with their own tables + endpoints.
- **New endpoints**: AI extract, favorite toggle, meal-plan CRUD, shopping-list CRUD.
- **Frontend grows** from list/view/form to all 6 screens with sidebar (desktop) / bottom-tab
  (phone) navigation, plus overlays (Cooking Mode, plan-picker modal).
- **PWA**: web manifest + service worker (installable, offline recipe list). Not present in the
  scaffold.

What must stay the same: relative `/api/*` URLs, the Vite dev proxy to `:3001`, Express +
`better-sqlite3` single-file DB, plain hand-written CSS, the monorepo `server/` + `client/`
layout.

---

## 3. Design system reference

Do not re-derive the visual system here — it lives in `docs/design.md` (palette, Onest font,
terracotta `#c56a4a` accent / `#a8542f` hover, radii, eyebrow labels, headings, dark Cooking
Mode). The raw layout, spacing, and copy are in `design/Pantry.dc.html`. Key fixed values the
builders need inline:

- Accent terracotta `#c56a4a`; hover/darker `#a8542f`. Primary buttons near-black `#111` white text.
- Page bg `#e7e5df`; app surface `#fff`; sidebar `#fbfaf8`; subtle fill `#f4f3f0`; borders `#efede8`/`#f1efea`.
- Eyebrow: uppercase, 10px, letter-spacing 2px, `#b8b2a8` (terracotta on AI Import).
- Cards ~14px radius, inputs/buttons ~11–12px, pills 16–20px.
- **Navigation labels — desktop sidebar** (exact): wordmark "Pantry"; nav items **Library**,
  **Meal Plan**, **Shopping List**, **Add from Video**; footer chip "My Kitchen · N recipes".
- **Navigation — phone bottom tab bar** (exact labels): **Home**, **Plan**, **Add**, **List**
  (4 tabs, ~62px bar; blurred translucent background).
- The design mockup renders recipe images as CSS gradient placeholders. In the real app `image`
  is a URL/data string; when absent, fall back to a deterministic gradient/color placeholder
  (see Edge Cases — recipe with no image).

---

## 4. Screens

Every screen has a **desktop** layout and a **phone** layout. States called out per screen:
loading, empty, error, populated. Copy in quotes is exact from the design (with the YouTube
correction described in §6).

### 4.1 Library (home)

Purpose: browse, search, and filter the recipe collection; entry point to every recipe.

Desktop layout: eyebrow "My Kitchen", title "Recipes", a search box (top-right, ~280px) with
placeholder "Search recipes, ingredients…"; a row of filter chips; a 3-column recipe card grid.
Card = image with a favorite heart overlay (top-right), title, and a meta line
`{minutes} min · {cuisine} · ★ {rating}`.

Phone layout: eyebrow "My Kitchen", title "Recipes" with a recipe count to its right; full-width
search box (placeholder "Search recipes"); a horizontally scrollable chip row; a 2-column card
grid. Card meta line is `{minutes} min · {cuisine}` (no rating on phone cards).

Filter chips (exact set, from the design): **All, Dinners, Breakfast, Desserts, Quick,
Vegetarian**. One active at a time; active chip is filled `#111` white text, others `#f4f3f0`.
Chip semantics (from the mockup logic):
- All → everything
- Dinners → `category === 'Dinner'`
- Breakfast → `category === 'Breakfast'`
- Desserts → `category === 'Dessert'`
- Quick → `minutes <= 25`
- Vegetarian → recipe flagged vegetarian

Note: the design derives "Quick" and "Vegetarian" from `minutes` and a veg flag. `category`
values in data are singular ("Dinner", "Breakfast", "Dessert"); chips display plural. See open
questions on how "Vegetarian" is represented in the persisted schema (a `vegetarian` boolean vs.
a tags array).

Search: case-insensitive substring match across recipe title, cuisine, ingredient names, and
tags (matches the mockup's `filtered()`), applied together with the active chip filter.

States:
- Populated — card grid.
- Empty (search yields nothing) — centered muted text: `No recipes match "{search}".`
- Empty (no recipes at all, e.g. fresh install) — friendly prompt to add a recipe or import a
  video (design shows the search-empty copy; provide a first-run variant — see open questions).
- Loading — while the recipe list is fetching, show a lightweight placeholder (skeleton or
  spinner); the design does not draw one, so keep it minimal and on-brand.
- Error — if the list fetch fails, show a retryable inline error rather than a blank grid.

### 4.2 Recipe Detail

Purpose: read a recipe and launch actions (cook, add to list, add to plan, favorite).

Desktop layout: a "‹ All recipes" back link; a hero image; eyebrow `{cuisine} · {category}`;
title; description; a stats row — **Total time** (`{minutes} min`), **Servings**, **Rating**
(`★ {rating}`). An action column (right) with: **Start cooking** (black primary), **Add to
list**, **Add to plan**, and a **Favorite** toggle whose label is "Save" / "Saved" and whose
style turns terracotta when saved. Below: two columns — **Ingredients** (each row: name left,
qty right) and **Method** (numbered steps, circular step numbers).

Phone layout: hero image with a back button (top-left) and favorite heart (top-right) overlaid;
eyebrow `{cuisine} · {category}`; title; a stats strip (time / serves / rating); **Ingredients**
list; **Method** list; a bottom action row with a wide **Cook** button and a square **Add to
list** icon button. (Phone detail has no "Add to plan" button in the design — plan-add on phone
happens from the Meal Plan screen's picker. See open questions.)

States:
- Populated — as above.
- Loading — while a single recipe fetches (deep link / refresh), show a placeholder.
- Error / not found — if the recipe id doesn't exist (404), show a "Recipe not found" message
  with a link back to Library.
- Rating display: numeric (e.g. `4.8`); a freshly imported recipe with no rating shows "New"
  (the mockup renders `rating: 'new'` as "New").

### 4.3 AI Import — "Add from a video"

Purpose: turn an Instagram/TikTok cooking video into an editable recipe draft.

Desktop layout: eyebrow "AI Import" (terracotta); title "Add from a video"; an intro paragraph;
a URL input (with link icon) + an **Extract** button; a row of sample-link chips. Below, the
result region cycles through loading → error → draft states.

Phone layout: same eyebrow/title; shorter intro; URL input; full-width Extract button; same
loading/error/draft states stacked.

Copy (CORRECTED — YouTube removed, see §6):
- Intro (desktop): "Paste a link to a cooking video from TikTok or Instagram. The AI will draft
  a full recipe — title, ingredients, and steps — that you can tweak and save."
- Intro (phone): "Paste a TikTok or Reels link — the AI drafts the recipe."
- Input placeholder: "https://tiktok.com/@chef/video/…" (desktop), "Paste link…" (phone).
- Extract button label: "Extract recipe" (idle) / "Working…" (in progress).
- Sample-link chips (exactly two — the YouTube sample is removed): a TikTok example and an
  Instagram Reel example, e.g. `tiktok.com/@spicychef` and `instagram.com/reel/pasta`.
  Clicking a chip fills the URL input.

**Two import paths** (both land in the same draft state — this is a firm constraint):
- **Path A — upload a video file.** A file-picker / drop affordance the design's URL-only mockup
  doesn't draw; add it alongside the link input (e.g. an "or upload a file" control). Always
  available; it is the reliable fallback when a link fails.
- **Path B — paste an IG/TikTok link.** The URL input + Extract button in the design.

States:
- Idle — input + Extract + sample chips.
- Loading — bordered card with a terracotta spinner: title "Watching the video…" and a status
  sub-line `{aiStatus}` that steps through progress messages (e.g. "Transcribing narration &
  captions", "Identifying ingredients on screen", "Reconstructing the method"). Extract button
  shows "Working…" and is disabled.
- Error — terracotta banner (`#fdf3ef` bg, `#f3d9cd` border, `#a8542f` text) with a plain
  message. Examples: "Paste a video link first." (empty input); "Could not read that video.
  Check the link, or upload the file instead." (fetch/extract failure — note the upload
  fallback, per constraints).
- Draft (populated) — a card with a hero image bearing an "AI draft" badge (terracotta), an
  **editable** title, description, a meta line (`⏱ {minutes} min · {servings} servings ·
  {cuisine}`), editable **Ingredients** (name + qty rows) and **Method** (numbered steps), and
  actions **Save to library** (black) + **Discard**. On phone the draft card shows title,
  description, meta, ingredients, and a single **Save to library** button (method list may be
  condensed — match the mockup, but all fields must be editable before save; see open questions
  on which fields are editable on phone).

Draft editing: at minimum title, description, ingredient names+qtys, step text, minutes,
servings, and cuisine are user-editable in the draft before saving (per the imperial-units
decision, amounts must remain correctable). Saving creates a real recipe (`source_url` set to
the pasted link when Path B; `source_caption` set from the fetched caption when available) and
navigates to its Recipe Detail. Discard clears the draft and returns to the idle state.

### 4.4 Meal Plan

Purpose: assign recipes to days of the current week.

Desktop layout: eyebrow "This week"; title "Meal Plan"; a 7-column grid (Mon–Sun), each column
showing the day name, the date, any assigned meal thumbnails (image + title, clickable → Recipe
Detail), and a dashed **"+"** add-meal button. The current day's column is subtly highlighted
(warmer background/border).

Phone layout: same eyebrow/title; a vertical list of days, each with its name+date, its meals as
rows (thumbnail + title), and a dashed **"+ Add meal"** button.

Plan-picker modal (both platforms): tapping add opens a modal titled `Add to {DayName}`
(e.g. "Add to Wed") listing all recipes (thumbnail, title, `{minutes} min · {cuisine}`); picking
one assigns it to that day and closes the modal. Desktop renders it as a centered modal; phone as
a bottom sheet. Clicking the scrim closes without assigning.

Week scope: "this week" — Mon–Sun of the current week, with real dates and today highlighted.
A day can hold multiple recipes. Removing a recipe from a day is implied by the store but not
drawn in the design (see open questions).

States:
- Populated — days with meals.
- Empty — a week with no assignments still shows all 7 day columns/rows with add buttons (there
  is no separate empty screen; the add affordance is the empty state).
- Loading — placeholder while the plan + referenced recipes load.
- Error — inline error if the plan fetch fails.

### 4.5 Shopping List

Purpose: keep a running list of things to buy; check them off; clear checked.

Desktop layout: eyebrow "{N} to buy" (N = unchecked count); title "Shopping List"; a **"Clear
checked"** action (top-right); an add-item input (placeholder "Add an item…") with an **Add**
button (terracotta); a list of item rows. Row = checkbox, name (strikethrough + muted when
checked), qty (right).

Phone layout: same eyebrow/title/add-input/rows, single column.

Behaviors:
- Add item: typing + pressing Enter or clicking "Add" appends an item (`{name, qty:'', checked:false}`).
- Toggle: tapping the checkbox flips `checked`; checked rows show strikethrough and the eyebrow
  count decrements.
- Clear checked: removes all checked items.
- Add-from-recipe: the Recipe Detail "Add to list" action appends that recipe's ingredients as
  items, **de-duplicated by name** (case-insensitive) against what's already on the list, each
  carrying its `qty` (matches the mockup's `addRecipeToCart`).

States:
- Populated — item rows.
- Empty — centered muted text. Desktop: "Your list is empty. Add recipes or type an item above."
  Phone: "List is empty."
- Loading / Error — placeholder / inline error on fetch failure.

### 4.6 Cooking Mode

Purpose: hands-free, full-screen, step-by-step cooking. **Text-only — no video pane** (firm).

Desktop layout: a full-screen dark (`#111`) overlay over the app. Header: eyebrow "Cooking" +
recipe title (left), a circular close button (right). A thin progress bar. Centered: eyebrow
`Step {n} of {total}` (terracotta) and large step text. Footer: **Back** (left, disabled/dimmed
on step 1), a row of step **dots** (active dot elongated, terracotta), and a **Next** button
(right) that becomes **Done** / finish on the last step.

Phone layout: full-screen dark overlay. Recipe title + close (top), progress bar, `Step {n} of
{total}` eyebrow, large step text, and a bottom row: a square **Back** button + a wide **Next**
button (label "Next step" → "Done" on the last step). (Phone footer omits the dots row; the bar
conveys progress.)

Behaviors:
- Enter from Recipe Detail's "Start cooking" (desktop) / "Cook" (phone), starting at step 1.
- Next advances; on the last step Next reads "Done"/"Finish" and exits back to Recipe Detail.
- Back goes to the previous step; disabled on step 1.
- Close exits to Recipe Detail at any point.
- Progress bar width = `(n / total) * 100%`.

States:
- Populated — a step is shown.
- Edge: a recipe with 0 steps should not offer Cooking Mode (or should show a "no steps yet"
  message) — see Edge Cases.
- No loading/error state of its own (steps are already loaded with the recipe).

---

## 5. User flows

1. **Browse → filter/search → open → cook.** Library → type in search and/or pick a chip → grid
   filters live → tap a card → Recipe Detail → "Start cooking"/"Cook" → step through Cooking
   Mode → "Done" returns to Recipe Detail.

2. **AI import — Path A (upload).** Add from Video → choose "upload a file" → pick a video file →
   Loading ("Watching the video…") → Gemini returns draft → Draft state → edit fields → "Save to
   library" → lands on the new recipe's Detail. (On upload, `source_url` is null; `source_caption`
   null unless provided.)

3. **AI import — Path B (paste link).** Add from Video → paste an IG/TikTok link (or click a
   sample chip) → Extract → backend runs yt-dlp to fetch the video + caption → Gemini → Loading →
   Draft → edit → Save → Detail. On yt-dlp failure, Error banner tells the user to upload the file
   instead (falls back to Path A).

4. **Add recipe to shopping list.** Recipe Detail → "Add to list" → recipe's ingredients append to
   the shopping list, de-duplicated by name → Shopping List screen shows them unchecked.

5. **Add recipe to a day in the meal plan (with picker).** Meal Plan → tap "+"/"+ Add meal" on a
   day → plan-picker modal `Add to {Day}` → pick a recipe → it's assigned to that day, modal
   closes. Also on desktop Recipe Detail: "Add to plan" opens the same picker (see open questions
   on which day it targets).

6. **Manage / check off shopping items.** Shopping List → type item + Enter/Add → item appears →
   tap checkbox to check/uncheck (strikethrough, count updates) → "Clear checked" removes checked.

7. **Favorite a recipe.** From a Library card's heart overlay, or Recipe Detail's Save/Saved
   toggle → `favorite` flips and persists; the heart/label reflects state everywhere.

8. **Manual create / edit / delete.** Create a recipe by hand (all fields, imperial units, no
   auto-conversion) → save → appears in Library. Edit an existing recipe's fields → save. Delete a
   recipe → it's removed from Library (and any meal-plan references resolve gracefully — see Edge
   Cases). (The design draws no explicit "New recipe"/edit/delete UI; this carries over from the
   scaffold's `RecipeForm`. Where the manual-entry entry point lives is an open question.)

---

## 6. YouTube exclusion (explicit)

The design copy names "TikTok, Instagram, and YouTube" and includes a YouTube sample link. Per
`docs/decisions.md`, **YouTube is intentionally NOT built.** The spec overrides the design here:
- Intro copy names **TikTok and Instagram only** (see §4.3 corrected copy).
- Sample links are **two** (TikTok + Instagram Reel); the YouTube shorts sample is removed.
- The backend accepts and processes **Instagram and TikTok** links only. A pasted YouTube (or any
  other) link is rejected with a clear error suggesting upload instead (see Edge Cases).

---

## 7. Data model

All measurements **imperial** (weights oz/lb; volumes cups/tbsp/tsp/fl oz; oven temps °F; lengths
inches). `data-agent` formalizes exact types/JSON encoding in `docs/data-shapes.md`; this is the
authoritative field list.

### Recipe
| field | type | notes |
|---|---|---|
| `id` | string (uuid) | primary key |
| `title` | string | required |
| `description` | string | one-sentence blurb; may be empty |
| `cuisine` | string | e.g. "Italian"; free text |
| `category` | string | one of "Dinner", "Breakfast", "Dessert" (drives Library chips); free text otherwise |
| `minutes` | integer | total time in minutes |
| `servings` | integer | number of servings (scaffold stored TEXT — this build makes it an integer) |
| `rating` | number \| null | e.g. `4.8`; null/absent renders as "New" |
| `favorite` | boolean | default false |
| `image` | string \| null | URL or data reference; null → placeholder gradient |
| `ingredients` | `{name: string, qty: string}[]` | **objects, not strings.** `qty` is a display string ("2 tbsp", "225g→convert to imperial", "2"). Order preserved. |
| `steps` | `string[]` | ordered step text; step numbers are positional (1-based) |
| `source_url` | string \| null | the IG/TikTok link when imported via Path B |
| `source_caption` | string \| null | fetched caption text used for extraction |
| `created_at` | string (ISO) | |
| `updated_at` | string (ISO) | |

Notes:
- **`ingredients` are `{name, qty}` objects** — this changes the scaffold's `string[]` and the
  extraction prompt. Backend JSON-encodes them in the DB (like the scaffold does for arrays).
- A **vegetarian** signal is needed for the "Vegetarian" chip. The mockup uses a per-recipe `veg`
  boolean and a `tags` array. Whether the persisted schema carries a `vegetarian` boolean, a
  `tags: string[]` column, or both is an open question for `data-agent` (see §11).
- `qty` stays a **string** (not a parsed number+unit) because quantities are free-form and
  imperial-normalized ("1 cup", "2 tbsp", "a pinch").

### Meal plan store
Maps a day of the current week → an ordered list of recipe references.
| field | type | notes |
|---|---|---|
| `day` | integer 0–6 or ISO date | 0=Mon … 6=Sun for "this week" (mockup uses index 0–6). `data-agent` decides index vs. date; date is more robust across weeks. |
| `recipe_id` | string (uuid) | FK → recipe; a day can have several |
| (position) | integer | optional ordering within a day |

Represented as rows of `{day, recipe_id}` (a join table) so a recipe can appear on multiple days
and a day can hold multiple recipes.

### Shopping list store
A flat list of items.
| field | type | notes |
|---|---|---|
| `id` | string/uuid | primary key |
| `name` | string | required |
| `qty` | string | display string; empty for manually added items |
| `checked` | boolean | default false |
| (position) | integer | optional ordering |

---

## 8. API surface (intended)

`backend-agent` formalizes request/response shapes in `docs/api.md`. Keep relative `/api/*`.
Existing endpoints (recipes CRUD) already exist and get extended for the new fields.

Recipes:
- `GET /api/health` — liveness (exists).
- `GET /api/recipes` — list (newest first); supports the new fields. (exists, extend)
- `GET /api/recipes/:id` — one recipe. (exists, extend)
- `POST /api/recipes` — create; accepts the full schema incl. `{name,qty}` ingredients. (exists, extend)
- `PUT /api/recipes/:id` — update. (exists, extend)
- `DELETE /api/recipes/:id` — delete. (exists)
- `PATCH /api/recipes/:id/favorite` (or reuse PUT) — toggle/set `favorite`. (new — or fold into PUT)

AI extract (server-side Gemini; key never leaves the server):
- `POST /api/extract` — Path B: body `{ url }` (IG/TikTok only) → backend runs yt-dlp (video +
  caption) → Gemini → returns a **draft recipe JSON** (not persisted). Errors are structured so
  the client can show the terracotta banner and suggest upload.
- `POST /api/extract/upload` (multipart) — Path A: an uploaded video file → Gemini → same draft
  JSON. Always available as the link fallback.
  (backend-agent may unify these into one `/api/extract` endpoint handling both body and multipart.)

Meal plan:
- `GET /api/meal-plan` — the current week's assignments (day → recipe refs), ideally hydrated with
  the minimal recipe fields the UI needs (title, image, minutes, cuisine).
- `POST /api/meal-plan` — assign a recipe to a day `{ day, recipe_id }`.
- `DELETE /api/meal-plan/:id` (or `{day, recipe_id}`) — remove an assignment.

Shopping list:
- `GET /api/shopping-list` — all items.
- `POST /api/shopping-list` — add an item `{ name, qty? }`.
- `POST /api/shopping-list/from-recipe/:recipeId` — append a recipe's ingredients, de-duped by
  name (or the client can add items individually; backend-agent picks the cleaner contract).
- `PATCH /api/shopping-list/:id` — toggle `checked` / edit.
- `DELETE /api/shopping-list/:id` — remove one item.
- `DELETE /api/shopping-list?checked=true` (or `POST /api/shopping-list/clear-checked`) — clear
  all checked items.

---

## 9. AI extraction contract

Server-side only. `GEMINI_API_KEY` in `server/.env`, never in the client. Free Flash model.

Expected JSON shape Gemini must return (aligns with the recipe model; `{name,qty}` ingredients):

```json
{
  "title": "string",
  "description": "string (one enticing sentence)",
  "minutes": 0,
  "servings": 0,
  "cuisine": "string",
  "category": "string (e.g. Dinner/Breakfast/Dessert)",
  "ingredients": [{ "name": "string", "qty": "string (imperial)" }],
  "steps": ["string"]
}
```

Prompt requirements (the extraction prompt must instruct the model to):
- Return **ONLY valid JSON** — no prose, no markdown code fences, no commentary.
- Use the caption text (when provided) for **exact quantities** the video doesn't state.
- **Do not invent ingredients** — only what's shown/said/captioned. Unknown → empty string / empty array.
- **CONVERT ALL MEASUREMENTS TO IMPERIAL**: weights → oz/lb, volumes → cups/tbsp/tsp/fl oz, oven
  temps → °F, lengths → inches. For weight→volume of dry goods, use standard culinary conversions
  and prefer the volume a recipe would use (cups/tbsp for dry, fl oz/cups for liquids). Amounts are
  estimates the user can correct in the draft.
- Give a realistic complete recipe: roughly 5–9 ingredients and 4–7 concise imperative steps.

Defensive parsing (backend):
- **Strip code fences** (` ```json ` / ` ``` `) and any leading/trailing prose before `JSON.parse`;
  slice from the first `{` to the last `}` as a fallback.
- On parse failure, **retry once**, re-asking the model for valid JSON only.
- If it still fails, return a structured error → client shows the error banner and the upload
  fallback.
- Coerce/validate the parsed object into the recipe draft shape (default missing fields, ensure
  `ingredients` items are `{name, qty}` strings, `minutes`/`servings` are integers).

---

## 10. Acceptance criteria

Library:
- [ ] Desktop shows a 3-col grid, phone a 2-col grid, of recipe cards with image, favorite heart,
      title, and meta (`min · cuisine · ★rating` desktop; `min · cuisine` phone).
- [ ] The chip set is exactly All / Dinners / Breakfast / Desserts / Quick / Vegetarian, one active
      at a time, filtering per §4.1 semantics; "Quick" = ≤25 min.
- [ ] Search is case-insensitive across title, cuisine, ingredient names, and tags, combined with
      the active chip.
- [ ] No-match search shows `No recipes match "{query}".`; a fresh/empty library shows a first-run prompt.
- [ ] List-fetch failure shows a retryable error, not a blank grid.

Recipe Detail:
- [ ] Shows hero, `cuisine · category` eyebrow, title, description, and Total time / Servings /
      Rating stats; a recipe with no rating shows "New".
- [ ] Desktop actions: Start cooking, Add to list, Add to plan, Favorite (Save/Saved). Phone
      actions: Cook + Add-to-list icon; favorite heart on the hero.
- [ ] Ingredients render name+qty rows; Method renders numbered steps.
- [ ] Unknown recipe id shows "Recipe not found" with a way back to Library.

AI Import:
- [ ] Intro/sample copy names **only TikTok and Instagram**; no YouTube anywhere; exactly two
      sample chips.
- [ ] Both Path A (upload) and Path B (paste link) reach the same editable Draft state.
- [ ] Loading shows "Watching the video…" + a changing status line; Extract button reads
      "Working…" and is disabled during extraction.
- [ ] Errors render in the terracotta banner; a failed link error suggests uploading the file instead.
- [ ] Draft fields (title, description, ingredients name+qty, steps, minutes, servings, cuisine)
      are editable before save; Save creates the recipe (imperial units) and navigates to its
      Detail; Discard clears the draft.
- [ ] The Gemini key is never present in any client bundle or network call from the browser.

Meal Plan:
- [ ] Desktop 7-col week grid / phone vertical day list, with today highlighted and real dates for
      the current week.
- [ ] "+"/"+ Add meal" opens the plan-picker (`Add to {Day}`); picking a recipe assigns it and
      closes; scrim-click cancels.
- [ ] A day can hold multiple recipes; meal thumbnails link to Recipe Detail.

Shopping List:
- [ ] Eyebrow shows the unchecked count "{N} to buy".
- [ ] Add via input (Enter or Add button); toggle checkbox (strikethrough + count updates); Clear
      checked removes checked items.
- [ ] "Add to list" from a recipe appends its ingredients de-duped by name (case-insensitive).
- [ ] Empty list shows the empty copy per platform.

Cooking Mode:
- [ ] Full-screen dark overlay, text-only, no video pane.
- [ ] Header title + close; progress bar reflects `n/total`; eyebrow "Step {n} of {total}".
- [ ] Next advances; last step reads Done/Finish and exits to Detail; Back is disabled on step 1;
      Close exits at any point.

Cross-cutting:
- [ ] Desktop sidebar nav (Library / Meal Plan / Shopping List / Add from Video) and phone bottom
      tabs (Home / Plan / Add / List) navigate correctly.
- [ ] Favoriting persists and is reflected on both card and detail.
- [ ] Manual create/edit/delete works with the expanded schema and imperial-unit convention.
- [ ] App is an installable PWA (manifest + service worker); the recipe list is available offline
      (read-only) after first load.
- [ ] All frontend API calls use relative `/api/*`.

---

## 11. Edge cases & failure states

- **yt-dlp fails / private / unavailable video (Path B):** return a structured error; client shows
  the terracotta banner "Could not read that video. Check the link, or upload the file instead."
  and the upload control stays available.
- **IG Reel needs cookies:** yt-dlp may require a cookies file for Instagram; when unavailable/
  expired, treat as a fetch failure with the upload fallback (don't crash).
- **Non-cooking video:** Gemini may return a thin/empty or nonsensical recipe. Validate the draft;
  if it has no ingredients and no steps, surface a gentle error ("Couldn't find a recipe in that
  video") rather than saving an empty recipe.
- **Very long video:** may exceed model/upload limits or time out. Enforce a sane size/duration
  guard on upload and a request timeout on extract; on timeout, error with the retry/upload hint.
- **Gemini returns malformed JSON / code fences / extra prose:** strip fences, slice `{…}`, retry
  once; if still unparseable, structured error → banner. Never `JSON.parse` crash the request.
- **Non-IG/TikTok link (incl. YouTube):** reject before calling yt-dlp with a clear message that
  only Instagram and TikTok links are supported, and to upload the file instead.
- **Empty input on Extract:** inline error "Paste a video link first." (no request made).
- **Empty library (fresh install):** first-run prompt on Library instead of a bare grid; Meal Plan
  and Shopping List show their own empty affordances.
- **Duplicate shopping items:** "Add to list" from a recipe de-dupes by case-insensitive name;
  manual adds are not force-deduped (the user may intentionally add "Milk" twice) — but consider a
  soft guard (open question).
- **Deleting a recipe referenced by the meal plan:** meal-plan entries pointing at a deleted recipe
  must resolve gracefully — either cascade-remove the assignment or render a "removed" placeholder,
  never crash the plan screen.
- **Recipe with 0 steps:** "Start cooking"/"Cook" should be disabled or Cooking Mode should show a
  "No steps yet" message rather than a blank dark screen.
- **Recipe with no image:** render a deterministic placeholder (brand gradient/initial), matching
  the design's gradient-tile aesthetic; never a broken image.
- **Rating absent:** render "New" (not `null`/`★`).
- **Offline PWA use:** with the service worker, the previously loaded recipe list/detail are
  viewable offline (read-only). Mutations (save, extract, add item, plan changes) require the
  server; when offline, fail gracefully with a "you're offline" style message rather than a silent
  failure. Extraction is inherently online-only.
- **Concurrent edits across devices:** single-user, but two devices hit one server; last-write-wins
  is acceptable (no conflict UI needed).

---

## 12. Out of scope for this build

- **YouTube** as a video source (copy/samples/backend all exclude it).
- **Video-beside-steps Cooking Mode** — Cooking Mode is text-only.
- **Cloud sync / multi-user / accounts / in-app auth** — single user behind Tailscale.
- **Automated test suite** — verification is manual QA against this spec.
- **Web Share Target** (share a Reel into the app) — noted in plan.md as a nice-to-have; not part
  of this build.

---

## 13. Open questions — RESOLVED

Resolved by the orchestrator at spec approval; also logged in `docs/decisions.md`. Builders follow
these.

1. **Vegetarian representation** → add a **`tags: string[]`** column (no separate `veg` boolean).
   The "Vegetarian" chip matches recipes whose tags include "Vegetarian" (case-insensitive); search
   already includes tags. Extensible to other tags later. — `data-agent`.
2. **`notes` field** → **drop `notes`**; migrate any existing value into `description`.
3. **`category` vocabulary** → **free-text string**. Dinner/Breakfast/Dessert are the chip-mapped
   values; other categories (e.g. "Snack") are allowed and simply don't match a category chip. Not an enum.
4. **Meal-plan day key** → **ISO date (`YYYY-MM-DD`)**, so assignments survive week rollover. — `data-agent`.
5. **Removing a meal from a day** → **yes, add a small remove control** (× on a planned meal — appears
   on hover on desktop, always-visible on phone). Backed by `DELETE` on the meal-plan store.
6. **"Add to plan" from desktop Recipe Detail** → it opens a **day chooser** (the 7 days of this
   week, today preselected); picking a day assigns this recipe to it. (Inverse of the Meal Plan
   screen's picker, which chooses a recipe for a known day.)
7. **Phone add-to-plan** → **follow the design**: phone Recipe Detail keeps only Cook + Add-to-list;
   plan assignment on phone happens from the Meal Plan screen's picker. (Can add later.)
8. **Phone draft editability** → **all key draft fields are editable on phone** (title, ingredient
   names+qtys, step text, minutes/servings/cuisine) — required so imperial-conversion estimates can
   be corrected. Keep the design's condensed layout + single "Save to library" button.
9. **Manual recipe entry point** (net-new UI the design omits) →
   - **Desktop:** a **"+ New recipe"** button in the Library header (next to search) → the manual
     recipe form (evolve the scaffold's `RecipeForm`, styled to the design).
   - **Recipe Detail:** **Edit** and **Delete** actions (Delete with a confirm).
   - **Phone:** the **Add** tab shows AI import with a secondary **"Enter manually"** link → the
     manual form.
   The manual form uses the full expanded schema, imperial-unit convention, `{name, qty}` ingredient rows.
10. **Extract endpoint shape** → **two endpoints** for clarity: `POST /api/extract` (URL body, Path B)
    and `POST /api/extract/upload` (multipart, Path A). `backend-agent` may still unify if cleaner. — `backend-agent`.
11. **Manual shopping-item duplicates** → **allow freely** (the user may intentionally add "Milk"
    twice). Only recipe-driven "Add to list" de-dupes by name.
