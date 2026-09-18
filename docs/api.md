# Cookbook (Pantry) — API Reference

All endpoints are served at `http://localhost:3001` in development.
The React frontend calls them via **relative `/api/*` paths** proxied by Vite.

Base URL: `/api`
Content-Type: `application/json` (except multipart upload)
CORS: open (single-user private deployment)

---

## Table of contents

1. [Health](#1-health)
2. [Recipes](#2-recipes)
3. [Filters](#3-filters)
4. [Meal Plan](#4-meal-plan)
5. [Shopping List](#5-shopping-list)
6. [History](#6-history)
7. [Pantry](#7-pantry)
8. [AI Extract](#8-ai-extract)
9. [Common error shape](#9-common-error-shape)

---

## 1. Health

### `GET /api/health`

Liveness check.

**Response 200**
```json
{ "ok": true }
```

---

## 2. Recipes

All recipe responses share the same full recipe object shape (see below).

### Recipe object

```json
{
  "id":             "uuid string",
  "title":          "string (required)",
  "description":    "string (one-sentence blurb; may be empty)",
  "cuisine":        "string (e.g. 'Italian'; free text)",
  "category":       "string ('Dinner' | 'Breakfast' | 'Dessert' | free text)",
  "minutes":        25,
  "servings":       4,
  "rating":         4.8,
  "favorite":       false,
  "image":          "URL string or null",
  "ingredients":    [{ "name": "spaghetti", "qty": "8 oz" }],
  "steps":          ["Boil water.", "Cook pasta."],
  "step_times":     [0, 45.5],
  "tags":           ["Italian", "Vegetarian"],
  "filters":        ["Chicken", "Quick"],
  "source_url":     "https://www.tiktok.com/... or null",
  "source_caption": "string or null",
  "has_video":      true,
  "created_at":     "2026-07-08T12:00:00.000Z",
  "updated_at":     "2026-07-08T12:00:00.000Z"
}
```

Field notes:
- `minutes` and `servings` are integers or `null`.
- `rating` is a float or `null`; `null` renders as "New" in the UI.
- `favorite` is a boolean.
- `ingredients` is an array of `{ name: string, qty: string }` objects; `qty` is a display string in **imperial** units ("2 tbsp", "1 cup", "8 oz").
- `steps` is an ordered array of strings.
- `step_times` — array of numbers (seconds), **positionally parallel to `steps`** (`step_times[i]` is the video timestamp for `steps[i]`). May be `[]` (no timestamps known — e.g. manually-entered recipes) or shorter than `steps`. `0` means "not visible in the video", not necessarily "the start". Used by Cook Mode to seek the video pane to the current step.
- `tags` is an array of strings. The "Vegetarian" Library chip matches recipes whose tags contain `"Vegetarian"` (case-insensitive).
- `filters` is an array of user-defined filter label strings. Each entry must be a label that exists in the `GET /api/filters` list. AI extraction and the `/assign-filters` endpoints populate this automatically; it can also be set manually in `POST`/`PUT` recipe requests.
- `image` is a URL or `null`; the frontend falls back to a deterministic gradient placeholder.
- `has_video` — boolean, `true` if the recipe has a source video stored on the server and `GET /api/recipes/:id/video` will return it. Derived from an internal `video_file` column that is **never exposed** in the API response.

---

### `GET /api/recipes`

List all recipes, newest first (by `created_at`).

**Response 200** — array of recipe objects.

```json
[{ ...recipe }, ...]
```

---

### `GET /api/recipes/:id`

Fetch a single recipe.

**Path param:** `id` — recipe UUID.

**Response 200** — single recipe object.

**Response 404**
```json
{ "error": "Recipe not found" }
```

---

### `POST /api/recipes`

Create a new recipe.

**Request body** (all fields except `title` are optional):
```json
{
  "title":          "string (required)",
  "description":    "string",
  "cuisine":        "string",
  "category":       "string",
  "minutes":        25,
  "servings":       4,
  "rating":         4.8,
  "favorite":       false,
  "image":          "URL or null",
  "ingredients":    [{ "name": "string", "qty": "string" }],
  "steps":          ["string"],
  "step_times":     [0, 45.5],
  "tags":           ["string"],
  "filters":        ["string"],
  "source_url":     "string or null",
  "source_caption": "string or null",
  "video_token":    "string (optional, write-only — see below)"
}
```

- `step_times` — array of finite non-negative numbers. Garbage entries (non-numeric, negative, `Infinity`/`NaN`) are dropped, not coerced; omit or send `[]` if there are no timestamps. Not required to match `steps.length`.
- `video_token` — **write-only**, never appears in a response. Comes from a draft's `videoToken` field (see §8). If it references an existing file at `server/media/drafts/<video_token>.mp4`, that file is **moved** to become this recipe's video (`has_video` becomes `true`); if the token is missing, malformed, or the draft file no longer exists (e.g. swept after 24h), the recipe is still saved normally with `has_video: false` — a bad/missing token never fails the save.

**Response 201** — a new recipe was inserted (the normal case). Returns the created recipe object (same shape as GET).

**Response 200** — a recipe with the same non-null `source_url` was already created within the last 60 seconds, so **no new row is inserted**; the existing recipe is returned unchanged instead. This is an idempotency guard against repeated save clicks / retries (e.g. double-clicking "Save to library" on a slow request). The response body shape is **identical** in both the 200 and 201 case (the full recipe object), so a client can use `.id` either way without checking the status code. If a `video_token` was supplied on a request that hit this guard, its draft file is **discarded** (not attached to the pre-existing recipe) rather than left orphaned.

- Manual entries (`source_url` `null` or an empty string) are **never** deduped — they always insert a new row.
- A deliberate re-import of the same `source_url` **more than 60 seconds later** still creates a new recipe; the window is intentional so a user can save a second variant of the same video later.

**Response 400**
```json
{ "error": "title is required" }
```

---

### `PUT /api/recipes/:id`

Replace all fields of an existing recipe.

**Path param:** `id` — recipe UUID.

**Request body** — same shape as POST (include `filters` to set assignments explicitly, `step_times` to update timestamps). `video_token` is accepted by the body parser but **PUT does not attach/replace a video** — the existing `video_file` is left untouched regardless of what's in the body. (Only `POST /api/recipes` and `POST /api/extract-and-save` claim a draft video.)

**Response 200** — updated recipe object.

**Response 400** — `{ "error": "title is required" }`

**Response 404** — `{ "error": "Recipe not found" }`

---

### `DELETE /api/recipes/:id`

Delete a recipe. Also removes any meal-plan assignments that reference this recipe (cascade), and deletes its video file at `server/media/<id>.mp4` if one exists (best-effort; a missing file is not an error).

**Path param:** `id` — recipe UUID.

**Response 204** — no body.

**Response 404** — `{ "error": "Recipe not found" }`

---

### `GET /api/recipes/:id/video`

Stream a recipe's source video (Cook Mode's video pane). Supports HTTP `Range` requests so `<video>` can seek to a step's timestamp without downloading the whole file.

**Path param:** `id` — recipe UUID.

**No `Range` header — Response 200**
Headers: `Content-Type: video/mp4`, `Content-Length: <bytes>`, `Accept-Ranges: bytes`. Body is the full video.

**With `Range: bytes=<start>-<end>` — Response 206 Partial Content**
Headers: `Content-Range: bytes <start>-<end>/<total>`, `Accept-Ranges: bytes`, `Content-Length: <chunk size>`, `Content-Type: video/mp4`. Body is just that byte range. Suffix ranges (`bytes=-500`, meaning "last 500 bytes") are also supported.

**Response 404**
```json
{ "error": "no video" }
```
Returned when the recipe has no video (`has_video: false`) or its file is missing on disk despite the DB pointing at it.

**Response 416 Range Not Satisfiable**
Header: `Content-Range: bytes */<total>`, no body. Returned for a malformed `Range` header or a range outside `[0, total)`.

---

### `PATCH /api/recipes/:id/favorite`

Toggle or explicitly set the `favorite` flag.

**Path param:** `id` — recipe UUID.

**Request body** (all optional):
```json
{ "favorite": true }
```
If `favorite` is omitted from the body, the current value is **toggled**.
If `favorite` is provided as `true` or `false`, it is set to that value.

**Response 200** — updated recipe object.

**Response 404** — `{ "error": "Recipe not found" }`

---

### `POST /api/recipes/:id/assign-filters`

Run AI filter assignment for a single existing recipe. Loads the recipe + all user-defined filters, calls Gemini to pick which labels apply, saves the result to `recipe.filters`, and returns the updated full recipe object.

**Path param:** `id` — recipe UUID.

**Request body:** none.

**Response 200** — updated recipe object (with `filters` field populated).

**Response 404** — `{ "error": "Recipe not found" }`

**Response 503** — extract module not available or `GEMINI_API_KEY` not set.

Error responses for Gemini failures follow the extract error shape (see §6).

---

### `POST /api/recipes/assign-all`

Run AI filter assignment for **every recipe** in the library. Processes recipes sequentially. Individual failures are logged and skipped; the endpoint always returns a count.

If `GEMINI_API_KEY` is not set, returns 503 immediately.

**Request body:** none.

**Response 200**
```json
{ "updated": 12 }
```

`updated` — count of recipes whose `filters` were updated (failed recipes are not counted).

**Response 503** — `GEMINI_API_KEY` not set or extract module unavailable.

---

### `POST /api/recipes/:id/frames`

Re-download the recipe's source video and return multiple candidate JPEG frames so the user can choose a new cover photo. **No AI call** — ffmpeg only.

**Path param:** `id` — recipe UUID.

**Request body:** none.

**Response 200**
```json
{
  "candidates": [
    "data:image/jpeg;base64,...",
    "data:image/jpeg;base64,...",
    "data:image/jpeg;base64,..."
  ]
}
```

`candidates` — ordered array of JPEG data URIs (≤6), best-guess first (end-weighted toward the plated dish). May be an empty array if the video cannot be decoded, but the response is still 200.

The chosen frame is persisted later by the client via `PUT /api/recipes/:id` with the `image` field set to the selected data URI. The non-chosen candidates are transient and discarded by the client.

**Response 404** — `{ "error": "Recipe not found" }`

**Response 422**
```json
{ "error": "This recipe has no source video to grab frames from. Upload a photo instead.", "code": "NO_SOURCE" }
```
Returned when the recipe has no `source_url` (manually-entered recipes, or imports where the URL was not saved).

**Response 503** — extract module not available (`EXTRACT_UNAVAILABLE`).

**Error responses** for yt-dlp failures follow the extract error shape (see §8 error table). Common codes:
- `FETCH_FAILED` (502) — yt-dlp could not re-download the video, for a reason not covered below.
- `UNSUPPORTED_URL` (400) — the stored `source_url` is not an IG/TikTok link.
- `TIMEOUT` (504) — download timed out.
- `COOKIES_EXPIRED` (503), `SOURCE_RATE_LIMITED` (429), `PRIVATE_POST` (403), `POST_UNAVAILABLE` (404), `NO_VIDEO_IN_POST` (422), `GEO_OR_IP_BLOCKED` (403), `SOURCE_UNAVAILABLE` (502), `DOWNLOADER_MISSING` (503) — same specific yt-dlp classifications as `/api/extract`; see §8's table for meanings.

---

## 3. Filters

A flat, user-managed list of filter labels. Recipes store which labels are assigned to them in the `filters` field. The Library uses this list as its filter bar (replacing the old auto-derived protein/carb/category chips).

### Filter object

```json
{
  "id":         "uuid string",
  "label":      "Chicken",
  "position":   0,
  "created_at": "2026-07-09T05:00:00.000Z"
}
```

`position` controls display order (ascending). Managed via `PUT /api/filters/order`.

---

### `GET /api/filters`

Return all filters, ordered by `position ASC, created_at ASC`.

**Response 200** — array of filter objects.

```json
[{ ...filter }, ...]
```

---

### `POST /api/filters`

Create a new filter.

**Request body:**
```json
{ "label": "Chicken" }
```

`label` is trimmed. If a filter with the same label already exists (case-insensitive), the existing filter is returned instead of creating a duplicate (idempotent).

**Response 201** — the created filter object.

**Response 200** — returned when a case-insensitive duplicate already exists (existing filter returned, not re-created).

**Response 400** — `{ "error": "label is required" }` (empty or missing label).

---

### `PATCH /api/filters/:id`

Rename a filter. Automatically cascades the rename into every recipe's `filters` array so assignments stay valid.

**Path param:** `id` — filter UUID.

**Request body:**
```json
{ "label": "Poultry" }
```

**Response 200** — updated filter object.

**Response 400** — `{ "error": "label is required" }`

**Response 404** — `{ "error": "Filter not found" }`

Cascade: any recipe whose `filters` array contained the old label has it replaced with the new label atomically (SQLite transaction). `recipe.updated_at` is bumped for affected recipes.

---

### `DELETE /api/filters/:id`

Delete a filter. Automatically removes that label from every recipe's `filters` array.

**Path param:** `id` — filter UUID.

**Response 204** — no body.

**Response 404** — `{ "error": "Filter not found" }`

Cascade: same atomic transaction as rename — affected recipes have the label removed and `updated_at` bumped.

---

### `PUT /api/filters/order`

Set the display order for filters by supplying a complete ordered list of ids.

**Request body:**
```json
{ "ids": ["uuid-1", "uuid-2", "uuid-3"] }
```

Each filter's `position` is set to its index in the array. IDs not present in the array are unaffected (their positions may become stale). Typically the frontend sends all ids.

**Response 200** — the full reordered filter list (same shape as `GET /api/filters`).

**Response 400** — `{ "error": "ids must be an array" }`

---

## 4. Meal Plan

The meal plan is a join table: a day can hold multiple recipes; a recipe can appear on multiple days.

`GET /api/meal-plan` returns a date range keyed by ISO date, even if a day has no assignments. By default it returns the **current month's calendar grid** (Mon-first); pass `start`/`end` to request an explicit range.

### Meal plan entry object

```json
{
  "id":        "uuid string",
  "day":       "2026-07-08",
  "recipe_id": "uuid string",
  "position":  0,
  "recipe": {
    "id":      "uuid string",
    "title":   "string",
    "image":   "URL or null",
    "minutes": 25,
    "cuisine": "string"
  }
}
```

`recipe` is the minimal hydrated recipe stub. It is `null` if the referenced recipe was deleted since the plan entry was created.

---

### `GET /api/meal-plan`

Return the meal plan for a date range, keyed by ISO date.

**Query params (optional, both-or-neither):**
- `start` — `YYYY-MM-DD`, inclusive start of the range.
- `end` — `YYYY-MM-DD`, inclusive end of the range.

If neither is provided, the range defaults to the **current month's calendar grid**: the Monday on/before the 1st of the current month, through the Sunday on/after the last day of the current month (35 or 42 days, matching a Mon-first calendar view).

**Response 200**
```json
{
  "start": "2026-06-29",
  "end": "2026-08-02",
  "days": ["2026-06-29", "2026-06-30", "...", "2026-08-02"],
  "plan": {
    "2026-06-29": [{ ...mealPlanEntry }, ...],
    "2026-06-30": [],
    "...": []
  }
}
```

`days` is every ISO date in `[start, end]`, inclusive, ascending. Every date in `days` is present as a key in `plan`; empty days hold an empty array. Entries within each day are ordered by `position`.

**Response 400**
```json
{ "error": "start and end must both be provided, or neither" }
```
or
```json
{ "error": "start and end must be YYYY-MM-DD" }
```
or
```json
{ "error": "end must not be before start" }
```
or
```json
{ "error": "range must be at most 62 days" }
```

---

### `POST /api/meal-plan`

Assign a recipe to a day.

**Request body:**
```json
{
  "day":       "2026-07-08",
  "recipe_id": "uuid string"
}
```

Both fields are required. `day` must be a valid `YYYY-MM-DD` date string.
The recipe is appended after any existing assignments for that day (auto-position).

**Response 201** — the created meal plan entry object (with hydrated `recipe` stub).

**Response 400**
```json
{ "error": "day is required and must be YYYY-MM-DD" }
```
or
```json
{ "error": "recipe_id is required" }
```

**Response 404** — `{ "error": "Recipe not found" }` (if `recipe_id` doesn't exist)

---

### `DELETE /api/meal-plan/:id`

Remove a single meal-plan assignment.

**Path param:** `id` — meal plan entry UUID.

**Response 204** — no body.

**Response 404** — `{ "error": "Meal plan entry not found" }`

---

## 5. Shopping List

A flat ordered list of items. Positions are assigned automatically (append order).

### Shopping list item object

```json
{
  "id":       "uuid string",
  "name":     "string",
  "qty":      "1 cup",
  "checked":  false,
  "position": 0,
  "category": "Pantry staples"
}
```

`category` is one of the fixed Pantry category set (§7) — coerced/guessed on
create, editable via `PATCH`.

---

### `GET /api/shopping-list`

Return all shopping list items in position order.

**Response 200** — array of shopping list item objects.

```json
[{ ...item }, ...]
```

---

### `POST /api/shopping-list`

Add one item.

**Request body:**
```json
{
  "name": "string (required)",
  "qty":  "string (optional, default empty string)"
}
```

**Response 201** — the created item object.

**Response 400** — `{ "error": "name is required" }`

---

### `POST /api/shopping-list/from-recipe/:recipeId`

Append a recipe's ingredients to the shopping list, **de-duplicated by case-insensitive name** against existing items (and against other ingredients in the same recipe).

Manual-add duplicates are allowed; only this endpoint de-dupes.

**Path param:** `recipeId` — recipe UUID.

**Response 201**
```json
{
  "added":   [{ ...item }, ...],
  "merged":  1,
  "skipped": 1
}
```

`added` — array of newly created items.
`merged` — count of ingredients that matched an existing item by name and had
their required amount accumulated onto it instead of creating a new row (see
"Accumulation" below).
`skipped` — retained for backward-compatible clients; currently always equal
to `merged`.

**Accumulation.** When an ingredient's name matches an item already on the
list (case-insensitive), the recipe's required amount is accumulated onto
that item's hidden internal tracking rather than creating a duplicate row.
The visible `qty` (buy amount) is bumped upward for "bumpable" units when the
accumulated total now needs more, and never decreases. Only same-dimension
amounts (e.g. both weights, both volumes) combine; a mismatched dimension is
ignored for accumulation purposes but the item is still counted as `merged`.

**Response 404** — `{ "error": "Recipe not found" }`

---

### `PATCH /api/shopping-list/:id`

Toggle `checked` or update `name`/`qty`.

**Path param:** `id` — item UUID.

**Request body** (all fields optional):
```json
{
  "checked": true,
  "name":    "string",
  "qty":     "string"
}
```

- If `checked` is absent from the body, the current value is **toggled**.
- If `checked` is provided as `true` or `false`, it is set to that value.
- `name` and `qty` are only updated when included in the body.

**Response 200** — updated item object.

**Response 404** — `{ "error": "Shopping list item not found" }`

---

### `DELETE /api/shopping-list/:id`

Remove one item.

**Path param:** `id` — item UUID.

**Response 204** — no body.

**Response 404** — `{ "error": "Shopping list item not found" }`

---

### `POST /api/shopping-list/clear-checked`

Remove all checked items.

**Response 200**
```json
{ "deleted": 3 }
```

`deleted` — the number of items removed.

---

### Price estimation

Price estimation is an **AI estimate from Gemini**, never a real quote or a
live store price — **unless a real price is available**, in which case that
always wins. It requires a persisted store choice, and results are cached
server-side in a `price_book` table (30-day staleness) so repeat presses on
an unchanged list cost zero Gemini calls.

**Lookup precedence, applied identically by `GET /api/shopping-list/prices`
and `POST /api/shopping-list/estimate`: manual → receipt → AI → unpriced.**

1. A `price_book` row with `source: "manual"` (§ `PUT /:id/price` below) wins
   outright — the user typed it in themselves.
2. Otherwise, the most recent observation in `receipt_prices` — an
   append-only log of what was actually paid, built by `POST
   /api/pantry/receipt` (§7) — wins. This is real money the user spent, so it
   beats a Gemini guess. See "Receipt prices" below for how it's scaled to
   the list row's own quantity.
3. Otherwise, the `price_book` AI cache, exactly as before.

**Items with a receipt price never reach Gemini at all** — `POST /estimate`
excludes them from the batch entirely, which is the actual payoff of the
receipt-price feature: as receipts accumulate, a press costs less (and
eventually nothing) for a regular shop. See `docs/decisions.md`, "2026-09-03
— Receipts build the price database."

#### Receipt prices — how a `receipt_prices` observation becomes a price

`receipt_prices` is a separate, **append-only observation log** — never a
cache, never upserted, never overwritten by this feature. Full column
reference: `docs/data-shapes.md` § Receipt prices.

- **Matching is exact on the normalized item name only** (`name_key`, same
  normalization as `price_book`). No fuzzy matching — a wrong match would
  attach a real price to the wrong food, which is worse than no match. Known
  follow-up, not implemented.
- **Most recent observation wins** when the same item has been bought more
  than once (ordered by `purchased_at`, then `created_at` as a tiebreak) —
  never an average. A sale price and a normal price blended together would
  produce a number that was never actually true.
- **Scaling.** When the receipt's quantity and the shopping-list row's own
  `qty` both parse (via `parseRequired()` in `server/storeQty.js`) to the
  **same dimension** — `weight`, `volume`, `clove`, or a **bare** `count`
  (see below) — the price scales: `(observation's total_price /
  observation's base_amount) * the list row's own base_amount`, rounded to
  the cent (same `Math.round` convention as every other price in this app —
  no epsilon guard needed; an exact-quantity match reproduces the observed
  total to the cent). Examples: a receipt line of `1.87 lb` for `$8.41` and a
  list row asking `1.5 lb` shows **`$6.75`**; a receipt line of `12` eggs for
  `$3.60` and a list row asking `6` shows **`$1.80`**. `qty_priced` is `null`
  in the scaled case — the full requested qty was priced exactly, so there's
  nothing to caveat.
- **Unscalable → fall back to the observation as a whole.** This happens
  when the dimensions differ, either quantity fails to parse (e.g. blank), or
  the dimension is `count` and **either side is not a bare number** (no unit
  word at all). `parseRequired()` also returns `count` for a quantity with no
  recognized unit at all, which includes container words like `1 bag` or `1
  jar` — a "bag" is not a fixed size, so scaling `1 bag` → `2 bags` as a
  literal doubling would silently misprice a differently-sized bag. A plain
  count like `12 eggs` → `6 eggs` IS safe to scale (see above); only the
  container case is excluded, via a bare-count check (`isBareCount()`,
  `server/storeQty.js`) rather than banning `count` outright. In the
  fallback case, `price` is the observation's own `total_price` and
  `qty_priced` is its `qty_text` — the UI already renders this as "priced
  as …".
- **Precedence interacts with manual prices exactly as before, with one
  addition**: a `price_book` row with `source: "manual"` is *still* an
  unconditional miss on `POST /estimate` (re-priced by Gemini every press,
  regardless of any receipt observation) — but once that press flips it back
  to `source: "ai"`, the (untouched) receipt observation becomes the display
  winner again on the very next read, per the precedence order above.

#### `GET /api/shopping-list/store`

Return the persisted store choice plus the curated chain list the picker
renders. Never errors, even on an empty `settings` table.

**Response 200**
```json
{
  "store":  "Trader Joe's",
  "zip":    "02139",
  "stores": ["Aldi", "Costco", "Food Lion", "Giant", "H-E-B", "Hannaford",
             "Harris Teeter", "Kroger", "Market Basket", "Meijer", "Publix",
             "Safeway", "Sam's Club", "ShopRite", "Sprouts", "Stop & Shop",
             "Target", "Trader Joe's", "Walmart", "Wegmans",
             "Whole Foods Market"]
}
```

`store` and `zip` are `""` when unset. `stores` is the fixed curated list —
it is **server-side only** and is not duplicated in `client/` source; the
picker should also offer a free-text "Other…" entry for any store not on
this list.

---

#### `PUT /api/shopping-list/store`

Set the store and/or ZIP. Persists to a `settings(key, value)` table under
keys `shopping.store` / `shopping.zip`.

**Request body:**
```json
{
  "store": "Trader Joe's",
  "zip":   "02139"
}
```

- `store` — required, non-empty after trimming, ≤ 60 characters, no control
  characters or newlines. May be any string — either one of `stores` above
  or a custom "Other…" value.
- `zip` — optional. When the key is present, `""` clears the stored ZIP and
  any other value must be exactly 5 digits. When the key is omitted
  entirely, the previously stored ZIP is left unchanged.

**Response 200** — same shape as `GET /api/shopping-list/store`, reflecting
the values just saved.

**Response 400**
```json
{ "error": "Pick a store." }
```
or
```json
{ "error": "ZIP must be 5 digits." }
```
Neither error changes the stored value.

---

#### `GET /api/shopping-list/prices`

Hydrate cached prices for **every** item currently on the shopping list, with
**no Gemini call, ever** — a plain read of `price_book`. This exists so a
price, once estimated, stays next to its ingredient across a reload instead
of disappearing (see `docs/decisions.md`, "2026-09-02 — Prices persist per
item, not per estimate"). It is a separate route rather than a `cachedOnly`
flag on `POST /estimate` specifically so the read path is structurally
incapable of spending quota — it never imports or calls the pricing module.

No request body. No `estimateInFlight` guard — a concurrent `POST /estimate`
does not block or get blocked by this route, and this route never writes to
`price_book`.

**Response 200**
```json
{
  "store": "Trader Joe's",
  "zip":   "02139",
  "items": [
    {
      "id":         "4dc5e6fb-…",
      "name":       "Bananas",
      "qty":        "6",
      "checked":    false,
      "qty_priced": "6",
      "price":      1.38,
      "source":     "ai",
      "updated_at": "2026-09-03T02:21:58.585Z"
    },
    {
      "id":         "9a10-…",
      "name":       "Boneless skinless chicken breast",
      "qty":        "1.5 lb",
      "checked":    false,
      "qty_priced": null,
      "price":      6.75,
      "source":     "receipt",
      "updated_at": "2026-08-20"
    },
    {
      "id":         "2ab7-…",
      "name":       "Saffron threads",
      "qty":        "1 pack",
      "checked":    true,
      "qty_priced": null,
      "price":      null,
      "source":     null,
      "updated_at": null
    }
  ],
  "total":            8.13,
  "total_unchecked":  8.13,
  "priced_count":     2,
  "unpriced_count":   1
}
```

Same field meanings as `POST /api/shopping-list/estimate`'s response
(`items[].id` maps back to the row **by id, never by name**; `price` is USD
rounded to 2 decimals or `null`; `total` / `total_unchecked` are reference
sums the client is free to recompute from live checked state) — this
response is that same shape **minus `gemini_calls`** (nothing was ever
computed) and minus the per-item `cached` flag (meaningless here — nothing
was freshly priced this request, so every non-null price is definitionally
from the cache or a receipt). An item with no cached entry and no receipt
observation comes back `price: null`, `source: null`, and counts toward
`unpriced_count`, exactly like an unpriced item from the estimate endpoint.

`items[].source` is `"manual"` when the user typed it in via `PUT
/api/shopping-list/:id/price`, `"receipt"` when it came from a
`receipt_prices` observation (see "Price estimation" above for the
precedence and scaling rules), `"ai"` when it came from a Gemini estimate, or
`null` when the item is unpriced. The client uses this to mark manual and
receipt prices visually, because the total block's "AI estimate — not a real
price" disclaimer is false for both. For a receipt-sourced item,
`updated_at` is the observation's `purchased_at` (the receipt's own date
when readable, else the scan time), not a `price_book` cache timestamp.

**The 30-day staleness window that `POST /estimate` enforces does NOT apply
here — this is deliberate, not an oversight.** `POST /estimate` treats an
entry older than 30 days as a miss and re-prices it; `GET /prices` returns it
regardless of age. Reading means "show me everything you have" (a price must
never silently vanish from the screen, which was the literal user complaint
this endpoint fixes); pressing Estimate means "fill gaps and refresh anything
stale." Both routes read the identical `(store, zip, name_key, qty_key)` key
in the identical `price_book` table — they are intentionally allowed to give
different answers from the same data. Do not "fix" this asymmetry to make the
two routes agree; that would reintroduce the reload bug.

**No store set** — unlike `POST /estimate`'s `400 NO_STORE`, this returns
**200** with `store: ""`, `zip: ""`, and every item `price: null`. A fresh
read of an unconfigured app is a normal empty state, not an error.

An empty shopping list returns **200** with `items: []`, `total: 0`,
`total_unchecked: 0`, `priced_count: 0`, `unpriced_count: 0`.

---

#### `POST /api/shopping-list/estimate`

Price every item currently on the shopping list — **checked and unchecked
alike; `checked` state is never a filter and is never sent to Gemini.**
Mutating (writes the price book cache), so `POST`.

**Request body** (all fields optional):
```json
{ "refresh": false }
```
`refresh: true` ignores cached entries and re-prices every item on this list,
regardless of cache freshness.

**Response 200**
```json
{
  "store":           "Trader Joe's",
  "zip":              "02139",
  "currency":         "USD",
  "items": [
    {
      "id":         "4dc5e6fb-…",
      "name":       "Bananas",
      "qty":        "6",
      "qty_priced": "6",
      "checked":    false,
      "price":      1.38,
      "cached":     true,
      "source":     "ai",
      "updated_at": "2026-09-03T02:21:58.585Z"
    }
  ],
  "total":            19.35,
  "total_unchecked":  19.35,
  "priced_count":     4,
  "unpriced_count":   0,
  "estimated_at":     "2026-09-03T02:22:02.841Z",
  "gemini_calls":     0
}
```

Field notes:
- `items` — one entry per row currently on `shopping_list`, in list order,
  regardless of `checked`.
- `items[].id` — the `shopping_list` row id. The client must map prices back
  to rows **by id, never by name** (two rows can share a name).
- `items[].checked` — that row's `checked` value as of request time; the
  client should still prefer its own live state for display.
- `items[].qty` — the row's own quantity, unchanged.
- `items[].qty_priced` — what Gemini actually priced (its assumption when
  `qty` was blank, otherwise an echo of `qty`); `null` when the item is
  unpriced.
- `items[].price` — USD, a plain number rounded to 2 decimals, or `null`
  when the item could not be priced.
- `items[].cached` — `true` when the price came from `price_book` or
  `receipt_prices` with no Gemini call this press for that item.
- `items[].source` — `"receipt"` when a `receipt_prices` observation priced
  the item (see "Price estimation" above), `"ai"` for a price this endpoint
  just wrote or already had cached from Gemini, or `null` when the item is
  unpriced. **Never `"manual"` in this response** — see "Manual prices"
  below: a manual price is always re-priced by this endpoint, so any row
  this endpoint returns with a non-null `price` is, by construction,
  `"receipt"` or `"ai"`.
- `total` — sum of all non-null `price` values (a reference figure; the
  client recomputes the number it displays from its own checked state).
- `total_unchecked` — the same sum restricted to rows that were unchecked at
  request time.
- `priced_count` / `unpriced_count` — count all rows, not just unchecked
  ones; `priced_count + unpriced_count` always equals `items.length`.
- `gemini_calls` — how many Gemini requests this press made. `0` on a fully
  cached press — the key acceptance property of this endpoint.

**Receipt prices are checked BEFORE the AI cache and are excluded from the
Gemini batch entirely** — the whole reason the feature exists. Per item, the
precedence used to decide hit/miss for this endpoint is: a `source: "manual"`
`price_book` row is always a miss (see below); otherwise a `receipt_prices`
observation, if one exists, is always a hit (`cached: true`, `source:
"receipt"`) and that item is never added to the Gemini prompt — not gated on
`refresh`, since a receipt observation is a record of real money spent, not a
re-askable estimate; otherwise the normal AI cache hit/miss check (30-day
staleness, `refresh`) applies. A press whose only misses are receipt-priced
items returns `gemini_calls: 0`.

**Manual prices are always overwritten, literally.** A `price_book` row with
`source: "manual"` (set via `PUT /api/shopping-list/:id/price`) is treated as
a cache **miss on every press, regardless of its age** — it is never treated
as a hit just because it's recent. It joins the normal batch of misses, gets
a real Gemini call like any other missing item, and the row is overwritten
with `source: "ai"`. This is a deliberate, user-chosen tradeoff: "estimate
should overwrite manual," accepted with the cost stated plainly — every press
spends one Gemini call per manually-priced item still on the list. See
`docs/decisions.md`, "2026-09-03 — Manual prices."

An empty shopping list returns **200** with `items: []`, `total: 0`,
`total_unchecked: 0`, `gemini_calls: 0` — not an error.

**Errors**

| Status | code | When |
|---|---|---|
| 400 | `NO_STORE` | `shopping.store` is unset — pick a store first |
| 409 | `ESTIMATE_IN_PROGRESS` | another estimate request is already running |
| 503 | `EXTRACT_UNAVAILABLE` | the extraction module failed to load |
| 503 | `CONFIG` | `GEMINI_API_KEY` missing / SDK not installed |
| 429 | `RATE_LIMITED` | every model in the fallback chain is rate-limited |
| 504 | `TIMEOUT` | exceeded `GEMINI_TIMEOUT_MS` |
| 422 | `PARSE_FAILED` | unparseable JSON after the one retry |
| 502 | `FETCH_FAILED` | the Gemini call failed for another reason |
| 500 | — | anything unexpected |

Error body is the house shape: `{ "error": "...", "code": "..." }`.

**Caching.** Prices are cached in `price_book`, keyed by
`(normalizeStore(store), normalizeZip(zip), normalizeName(item.name), item.qty)`
— the row's own current `qty` (trimmed) is part of the cache key, not just
compared after the fact. A cached entry is used only when it exists, is
under 30 days old, and the request did not set `refresh: true` — anything
else is a cache miss. Cache misses are de-duplicated by normalized name
**and** qty before being sent to Gemini in a **single request** (capped at
60 distinct missing name+qty pairs per press — the remainder come back
unpriced and are retried on the next press), so two list rows named "Milk"
with the **same** qty cost one Gemini prompt entry but both still receive a
price and both count toward the total. Two rows named "Milk" with
**different** qtys ("1 gal" vs "2 gal") each get their own prompt entry and
their own cache line — they do not share a cached price and do not fight
over the same cache row (an earlier name-only cache key caused exactly that:
whichever qty was priced last silently overwrote the other's price, forcing
a real Gemini call on every single press for the loser).

Every returned price is validated before it is trusted or cached: it must be
a real finite number strictly greater than 0 and no more than 999. `null`,
`undefined`, booleans, arrays/objects, empty strings, non-numeric strings,
and exactly `0` are all treated as **unpriced** — none of them are ever
written to `price_book` as a real price (a naive numeric coercion would
otherwise turn "the model couldn't price this" into a cached $0.00 for 30
days, which is why the check happens before any arithmetic on the raw
value).

**Why blank-`qty` items cache correctly.** Internally, `price_book` stores
the requested qty and the model's assumed qty in two separate columns:
`qty_key` (the row's own qty, verbatim — `''` is valid and common for a
manually-added item) is the actual cache key, while `qty_priced` — the qty
Gemini says it assumed/priced — is display-only provenance and never
participates in the lookup. Earlier revisions conflated the two into one
column, which meant a blank-qty item's cache row was stored under whatever
the model assumed ("1 each") but could never be found again by its own blank
qty — it re-priced on every single press, forever. See `docs/data-shapes.md`
§4b for the full column reference and the index migration history.

---

#### `PUT /api/shopping-list/:id/price`

Set or clear a **manual** price for one shopping-list item — the ability to
type a price in yourself, before or after ever pressing Estimate. A manual
price is stored exactly like an AI price: a `price_book` row for that item's
current `(store, zip, name_key, qty_key)` key, with a `source` column set to
`"manual"` instead of `"ai"`. There is no separate table and no column added
to `shopping_list` — this is deliberate (see `docs/decisions.md`, "2026-09-03
— Manual prices"), so a manual price hydrates via `GET /prices`, contributes
to totals, survives a reload, and clears when the item's `qty` changes or the
store/ZIP changes, through the exact same paths an AI price already does.

**Request body:**
```json
{ "price": 4.50 }
```
or, to clear a manual price and return the item to unpriced:
```json
{ "price": null }
```

- `price` is **required** in the body (its absence is a 400, not treated as
  `null`).
- A numeric `price` upserts a `price_book` row for this item's current
  `name`/`qty` with `source: "manual"`, `qty_priced` set to the item's own
  `qty` (there is no model assumption to record), and `updated_at` set to
  now. If a row already existed for that key — `"ai"` or `"manual"` — it is
  overwritten.
- `price: null` **deletes** the `price_book` row for this item's current key
  (whatever its `source`), so the item goes back to unpriced. This is how the
  UI undoes a manual entry — e.g. tapping a manually-set price and clearing
  it.
- Validated with the same `coercePrice` function `POST /estimate` trusts
  before writing to `price_book` (real finite number, not negative, not over
  the 999 sanity cap; `null`/`undefined`/booleans/objects/non-numeric strings
  all rejected) — **with one deliberate difference**: exactly `0` is rejected
  on the AI path (it can only mean "the model failed to price this"), but is
  **allowed** here. A human typing `0` is a real, meaningful signal — the
  item is free, already owned, or otherwise not being paid for — not a
  parsing failure, so it is stored as a genuine $0.00 price (counts toward
  `priced_count`, contributes $0 to the total) rather than being treated as
  unpriced.

**Response 200** — **the same shape as `GET /api/shopping-list/prices`** (the
whole list's prices and totals, including the just-changed item), not a
single-item patch. The client is expected to replace its price state
wholesale from this response rather than patch one entry in place.

**Errors**

| Status | code | When |
|---|---|---|
| 404 | — | `:id` is not a `shopping_list` row |
| 400 | `NO_STORE` | `shopping.store` is unset — prices are keyed per store+ZIP, so there is nowhere to put one. The client responds exactly as it does for `POST /estimate` in this state: open the store picker instead of showing an error. |
| 400 | — | `price` key missing from the body, or fails `coercePrice` validation (`{ "error": "Enter a valid price." }`) |
| 503 | `EXTRACT_UNAVAILABLE` | the extraction module (which owns `coercePrice`) failed to load — only reachable when setting a non-null price; clearing never needs it |

Error body is the house shape: `{ "error": "...", "code": "..." }` (the
validation-failure 400 omits `code`, matching the store-validation errors in
`PUT /api/shopping-list/store`).

**The headline behavior — a manual price does not survive a re-estimate.**
`POST /api/shopping-list/estimate` treats any `price_book` row with
`source: "manual"` as an unconditional cache miss (see that endpoint's docs
above): the very next press re-prices it with Gemini and flips it back to
`source: "ai"`. Setting a manual price never blocks or defers a future
estimate — it only fills the gap, or corrects the number, until the next
press.

---

## 6. History

A log of what the user cooked and when, each entry linked to a Library recipe. Multiple entries for the same recipe on the same day are allowed.

History entries survive recipe deletion — if the linked recipe is later deleted the entry remains in the log with `recipe: null`.

### History entry object

```json
{
  "id":          "uuid string",
  "recipe_id":   "uuid string",
  "date":        "2026-07-09",
  "rating":      4,
  "image":       "data:image/jpeg;base64,... or null",
  "description": "string (may be empty)",
  "created_at":  "2026-07-09T10:00:00.000Z",
  "updated_at":  "2026-07-09T10:00:00.000Z",
  "recipe": {
    "id":      "uuid string",
    "title":   "string",
    "image":   "URL or null",
    "cuisine": "string",
    "minutes": 25
  }
}
```

Field notes:
- `date` — ISO date `YYYY-MM-DD` (the day the recipe was cooked).
- `rating` — integer 1–5 or `null` (unrated).
- `image` — data URI of the user's uploaded photo, or `null`.
- `description` — free-text note; defaults to empty string.
- `recipe` — minimal hydrated stub of the linked Library recipe. `null` when the recipe has been deleted since the entry was created; the entry itself is preserved.

---

### `GET /api/history`

Return all history entries, newest date first (tie-broken by `created_at DESC`), each hydrated with the linked recipe stub.

**Response 200** — array of history entry objects.

```json
[{ ...historyEntry }, ...]
```

---

### `POST /api/history`

Create a new history entry.

**Request body:**
```json
{
  "recipe_id":   "uuid string (required)",
  "date":        "2026-07-09 (optional, defaults to today's local date)",
  "rating":      4,
  "image":       "data URI string or null",
  "description": "string"
}
```

- `recipe_id` — required; must reference an existing recipe (404 if not found).
- `date` — optional; if omitted, defaults to today's date in local time (`YYYY-MM-DD`).
- `rating` — optional; coerced to integer, clamped to 1–5; `null` if omitted or invalid.
- `image` — optional; stored as a plain text data URI string.
- `description` — optional; trimmed; defaults to empty string.

**Response 201** — the created history entry object (hydrated).

**Response 400**
```json
{ "error": "recipe_id is required" }
```

**Response 404** — `{ "error": "Recipe not found" }` (when `recipe_id` does not exist)

---

### `PATCH /api/history/:id`

Partial update of a history entry. Only the fields present in the request body are changed.

**Path param:** `id` — history entry UUID.

**Request body** (all fields optional):
```json
{
  "date":        "2026-07-10",
  "rating":      5,
  "image":       "data URI string or null",
  "description": "string"
}
```

- `recipe_id` cannot be changed after creation.
- `rating` — set to `null` by passing `null` or `""`.

**Response 200** — updated history entry object (hydrated).

**Response 404** — `{ "error": "History entry not found" }`

---

### `DELETE /api/history/:id`

Remove a single history entry. Does not affect the linked recipe.

**Path param:** `id` — history entry UUID.

**Response 204** — no body.

**Response 404** — `{ "error": "History entry not found" }`

---

## 7. Pantry

An inventory of ingredients the user has at home. Items are grouped by a fixed ordered set of categories. The frontend receives a flat array and groups by `category` client-side.

### Fixed category list (in display order)

```
Produce
Dairy & Eggs
Meat & Seafood
Bakery
Frozen
Pantry staples
Beverages
Condiments & Spices
Other
```

Any `category` sent to the API is matched case-insensitively against this list. Unrecognised values are coerced to `'Other'`.

### Pantry item object

```json
{
  "id":         "uuid string",
  "name":       "string",
  "qty":        "2 lb",
  "category":   "Meat & Seafood",
  "position":   0,
  "created_at": "2026-07-09T10:00:00.000Z",
  "updated_at": "2026-07-09T10:00:00.000Z"
}
```

Field notes:
- `qty` — free-text quantity string; defaults to `""`.
- `category` — one of the fixed set above; coerced on write.
- `position` — integer; used for ordering within a category (ascending). Auto-assigned on create as max+1 within the category.

---

### `GET /api/pantry`

Return all pantry items as a flat array, ordered by category (fixed order above), then `position ASC`, then `name ASC`. The frontend groups by `category`.

**Response 200** — array of pantry item objects.

```json
[{ ...pantryItem }, ...]
```

---

### `POST /api/pantry`

Add one item to the pantry.

**Request body:**
```json
{
  "name":     "string (required)",
  "qty":      "string (optional, default empty string)",
  "category": "string (optional, coerced to allowed set, default 'Other')"
}
```

**Response 201** — the created pantry item object.

**Response 400** — `{ "error": "name is required" }` (empty or missing name).

---

### `PATCH /api/pantry/:id`

Partial update of `name`, `qty`, and/or `category`. Only fields present in the body are changed. `category` is coerced to the allowed set if supplied.

**Path param:** `id` — pantry item UUID.

**Request body** (all fields optional):
```json
{
  "name":     "string",
  "qty":      "string",
  "category": "string"
}
```

**Response 200** — updated pantry item object.

**Response 404** — `{ "error": "Pantry item not found" }`

---

### `DELETE /api/pantry/:id`

Remove one pantry item.

**Path param:** `id` — pantry item UUID.

**Response 204** — no body.

**Response 404** — `{ "error": "Pantry item not found" }`

---

### `POST /api/shopping-list/move-to-pantry`

Move all **checked** shopping-list items into the pantry in one operation.

- Each checked item is auto-categorized by a server-side keyword guesser (`guessCategory`) — see below.
- De-duped by case-insensitive `name`: if a pantry item with that name already exists, the item is **skipped** (not duplicated) but is still **removed** from the shopping list.
- All checked items (whether added or skipped) are deleted from `shopping_list`.

**Request body:** none.

**Response 200**
```json
{
  "moved":   [{ ...pantryItem }, ...],
  "skipped": 1
}
```

`moved` — array of pantry items that were newly created.
`skipped` — count of checked shopping items whose name already existed in the pantry (they were removed from the shopping list but not re-added to the pantry).

If there are no checked items, returns `{ "moved": [], "skipped": 0 }`.

#### `guessCategory` — how auto-categorization works

The server matches keywords in the lowercased item name using regex, checking more-specific categories first:

| Category | Keywords matched |
|---|---|
| Dairy & Eggs | milk, cheese, egg, butter, yogurt, cream, parmesan, mozzarella |
| Meat & Seafood | chicken, beef, steak, pork, bacon, sausage, turkey, lamb, fish, salmon, tuna, shrimp, prawn, meat |
| Produce | lettuce, tomato, onion, garlic, potato, carrot, pepper, apple, banana, lemon, lime, spinach, broccoli, avocado, cucumber, herb, cilantro, mushroom, berry, fruit, vegetable |
| Bakery | bread, bun, bagel, roll, tortilla, naan, pita, croissant |
| Frozen | frozen, ice cream, popsicle |
| Condiments & Spices | salt, sauce, ketchup, mustard, mayo, vinegar, spice, soy sauce, sriracha, honey, syrup, seasoning, oil (word-boundary) |
| Pantry staples | flour, sugar, rice, pasta, noodle, bean, lentil, oat, cereal, stock, broth, can (word-boundary), canned, baking, cornstarch, quinoa |
| Beverages | juice, soda, water, coffee, tea, wine, beer, drink |
| Other | (fallback — no keywords matched) |

Dairy & Eggs is checked before Beverages so "milk" is not mis-filed as a beverage.
The user can always recategorize via `PATCH /api/pantry/:id`.

---

### `POST /api/pantry/:id/to-shopping`

"Running low" — add this pantry item to the shopping list. The pantry item is **not** removed.

De-duped by case-insensitive name (same logic as `POST /api/shopping-list/from-recipe/:id`): if an item with this name is already on the shopping list, the call is a no-op.

**Path param:** `id` — pantry item UUID.

**Request body:** none.

**Response 201** — the created shopping list item (when added):
```json
{
  "id":       "uuid string",
  "name":     "string",
  "qty":      "string",
  "checked":  false,
  "position": 5
}
```

**Response 200** — when already on the shopping list (skipped):
```json
{ "added": null, "skipped": true }
```

**Response 404** — `{ "error": "Pantry item not found" }`

---

### `POST /api/pantry/receipt`

AI receipt import, step 1 of 2. Reads a photo of a grocery receipt with Gemini and returns the grocery items on it as a **draft** for the Pantry — **the Pantry side is not persisted here**. The frontend shows the list for review, then sends the keepers to `POST /api/pantry/bulk`.

**This same scan also builds the price database.** Immediately, as part of this request (not gated on the Pantry review/bulk-add step, and not a second upload), the server records one append-only `receipt_prices` observation per item whose price was readable — see `docs/decisions.md`, "2026-09-03 — Receipts build the price database." Those observations are what `GET /api/shopping-list/prices` and `POST /api/shopping-list/estimate` read (§5, "Price estimation").

Runs server-side only; the Gemini API key is never exposed to the browser. Unlike video extraction this sends the image **inline** rather than through the Gemini Files API.

**Request:** `multipart/form-data` with a single file field named `receipt`.
Accepted types: JPEG, PNG, WebP, HEIC/HEIF. **Max 12 MB.**

The model is instructed to:
- expand receipt abbreviations into plain names (`GV WHL MLK GAL` → `Whole milk`),
- report the **generic product**, not the branded one — strip store brands (`H-E-B`, `GV`/Great Value, Kirkland, `365`) and national brands (`Heinz`, `Kraft`, `Barilla`, ...) from `name` (`H-E-B Onion Powder` → `Onion powder`; `Kirkland EVOO` → `Extra virgin olive oil`), **except** when the brand IS the common name a person would actually put on a shopping list (`Cheerios` stays `Cheerios`),
- strip the package size out of `name` too — it belongs in `qty` (`GV Garlic Minced 3oz` → name `Minced garlic`, `qty: "3 oz"`, not `Minced garlic 3oz`),
- keep descriptive attributes that identify the food itself (cut, fat content, roast level, etc.) — only the brand and the package size come out (`Boneless skinless chicken breast`, `Sharp cheddar cheese`, `Low sodium chicken broth` are unaffected),
- skip every non-grocery line (subtotal, tax, total, payment, loyalty, bag fees) **and** non-food goods (cleaning supplies, paper goods, toiletries, pet, pharmacy),
- report the amount purchased in `qty`, converting any metric amount to imperial,
- report what was actually **paid** for that line in `price` (a plain USD number, `null` when genuinely unreadable — never a guess),
- read the receipt's own **purchase date**, when legible, as `date`,
- pick a `category` from the fixed pantry list.

**Applies to new scans only** (added 2026-09-03, see `docs/decisions.md`). Existing Pantry rows and `receipt_prices` observations saved before this change keep their old (possibly branded/sized) names — this is a prompt change, not a backfill.

**Response 200:**
```json
{
  "store": "Fresh Market",
  "date":  "2026-08-25",
  "items": [
    { "name": "Whole milk", "qty": "1 gal", "category": "Dairy & Eggs", "price": 4.29 },
    { "name": "Boneless skinless chicken breast", "qty": "1.87 lb", "category": "Meat & Seafood", "price": 8.41 },
    { "name": "Loose bagel", "qty": "", "category": "Bakery", "price": null }
  ]
}
```

`store` is `""` when the store name is unreadable. `date` is `null` when the receipt's purchase date is unreadable (the price observations below still get recorded — see "Price attribution" below). `category` is always one of the fixed categories — when the model returns nothing usable, the server falls back to its own keyword guess (the same `guessCategory` used by `POST /api/shopping-list/from-recipe/:id`). `price` is a plain USD number rounded to 2 decimals, or `null` when that line's price couldn't be read — **an unreadable price never drops the item itself**, it still comes back for Pantry review with `price: null`.

**Price attribution (recorded server-side, not part of what the frontend needs to send back).** For every item with a non-null `price`, one row is inserted into `receipt_prices`:
- **Store**: the store name printed on the receipt when legible, else the app's configured shopping store (`GET /api/shopping-list/store`). If neither is available, nothing is recorded for this scan (no error — the Pantry review still proceeds).
- **ZIP**: always the app's configured `shopping.zip` (receipts essentially never print one).
- **`purchased_at`**: the receipt's own `date` when readable, else the time of this scan.
- **`base_amount` / `dim`**: `parseRequired(qty)` from `server/storeQty.js` — `dim` ∈ `volume | weight | clove | count`, `base_amount` is `0` when `qty` doesn't parse to a usable amount.
- **`unit_price`**: `price / base_amount` when `base_amount > 0`, else `null`.

**Errors** — same `{ error, code }` shape and code→status mapping as §8 AI Extract:

| Status | Code | When |
|---|---|---|
| 400 | `UNSUPPORTED_URL` | no file sent, or the file is not an image |
| 413 | `FETCH_FAILED` | image over 12 MB |
| 422 | `NO_RECIPE` | image read fine but held no grocery lines |
| 422 | `PARSE_FAILED` | model output was not parseable JSON after one retry |
| 429 | `RATE_LIMITED` | every model in the fallback chain is rate-limited |
| 503 | `CONFIG` / `EXTRACT_UNAVAILABLE` | `GEMINI_API_KEY` unset, or the extract module failed to load |

---

### `POST /api/pantry/bulk`

Add many pantry items in one transaction. Backs step 2 of the receipt import, but is a plain bulk-add usable by any caller.

De-duped by **case-insensitive name**, both against the existing pantry and within the request itself. Existing items are left untouched — a duplicate is skipped, not updated.

**Request body:**
```json
{
  "items": [
    { "name": "Whole milk", "qty": "1 gal", "category": "Dairy & Eggs" },
    { "name": "Roma tomatoes", "qty": "2.14 lb" }
  ]
}
```

`name` is required per item; entries with a blank name are dropped. `qty` defaults to `""`. `category` is coerced to the fixed list (unknown → `Other`); when **omitted**, the server guesses from the name. Max **200** items per request.

**Response 200:**
```json
{
  "added":   [ { "id": "uuid", "name": "Whole milk", "qty": "1 gal", "category": "Dairy & Eggs", "position": 0, "created_at": "…", "updated_at": "…" } ],
  "skipped": ["Roma tomatoes"]
}
```

`added` holds the full created pantry items; `skipped` holds the **names** that were already in the pantry.

**Response 400** — `{ "error": "items must be an array" }` or `{ "error": "Too many items — 200 max per request." }`

---

## 8. AI Extract

Runs server-side only. The Gemini API key is never exposed to the browser.
Both endpoints return a **draft recipe JSON** that is **not persisted** — the frontend displays it as an editable draft, and a separate `POST /api/recipes` call saves it.

### Draft recipe object

Same shape as a recipe object (see §2) but without `id`, `created_at`, `updated_at`, `favorite`, `source_url`, or `source_caption` (those are absent or supplied by the frontend at save time). The `filters` field **is** present — it is populated by AI assignment using the user's current filter list at extraction time. A few additional fields (camelCase, matching `imageCandidates`) support the cover-photo picker and Cook Mode's video pane:

```json
{
  "title":           "string",
  "description":     "string",
  "cuisine":         "string",
  "category":        "string",
  "minutes":         25,
  "servings":        4,
  "image":           "data:image/jpeg;base64,... or null",
  "imageCandidates": ["data:image/jpeg;base64,...", "data:image/jpeg;base64,..."],
  "ingredients":     [{ "name": "string", "qty": "string (imperial)" }],
  "steps":           ["string"],
  "stepTimes":       [0, 45.5],
  "videoToken":      "uuid string or null",
  "tags":            [],
  "filters":         ["Chicken", "Quick"]
}
```

All measurements are imperial (weights oz/lb, volumes cups/tbsp/tsp/fl oz, temps °F).

Field notes for the frame fields:
- `imageCandidates` — ordered array of JPEG data URIs (≤6), best-guess first. Extracted with ffmpeg (no AI call). Empty array `[]` if no frames could be grabbed.
- `image` — equals `imageCandidates[0]` when candidates is non-empty; `null` otherwise.
- Both fields are **transient** — only the single chosen frame is persisted to the recipe via `PUT /api/recipes/:id` (`image` field).

Field notes for the video/Cook Mode fields:
- `stepTimes` — number array (seconds), positionally parallel to `steps` (same length; padded with `0` for any step whose moment wasn't identified). Comes from the SAME single Gemini call that extracts the recipe — no extra request. Send it back as `step_times` (snake_case) on `POST /api/recipes` to persist it.
- `videoToken` — a token referencing a copy of the source video stashed at `server/media/drafts/<videoToken>.mp4` on the server, or `null` if the video couldn't be stashed (extraction still succeeds either way — the recipe just won't have Cook Mode video). Send it back as `video_token` (snake_case) on `POST /api/recipes` to attach the video to the saved recipe. Unclaimed drafts are swept after 24 hours.

### Extract error object

```json
{
  "error": "user-friendly message string",
  "code":  "MACHINE_READABLE_CODE"
}
```

| `code`               | HTTP status | Meaning                                                               |
|----------------------|-------------|-----------------------------------------------------------------------|
| `UNSUPPORTED_URL`    | 400         | URL is not an Instagram or TikTok link (or URL field is missing).     |
| `NO_RECIPE`          | 422         | Video processed but no recipe was found in it.                        |
| `PARSE_FAILED`       | 422         | Gemini returned output that could not be parsed as valid recipe JSON. |
| `FETCH_FAILED`       | 502         | yt-dlp could not download the video, for a reason not covered by the more specific codes below. |
| `TIMEOUT`            | 504         | The extraction request timed out.                                     |
| `CONFIG`             | 503         | Server is not configured (missing `GEMINI_API_KEY`).                  |
| `RATE_LIMITED`       | 429         | Every model in Gemini's free-tier fallback chain is rate-limited. **Not** the same as `SOURCE_RATE_LIMITED` below. |
| `COOKIES_EXPIRED`    | 503         | Instagram's saved login has expired or is missing the session cookie (yt-dlp: "cookies are no longer valid" / "API is not granting access" / the generic cookies-from-browser hint). Message tells the user to re-export cookies including the HttpOnly `sessionid` and points at the `YTDLP_COOKIES` path. |
| `SOURCE_RATE_LIMITED`| 429         | Instagram or TikTok itself is rate-limiting this server's requests (yt-dlp: "exceeded the rate-limit for accessing posts anonymously", HTTP 429 / "Too Many Requests"). Distinct from `RATE_LIMITED`, which is Gemini quota. |
| `PRIVATE_POST`       | 403         | The post is private / restricted to followers (yt-dlp: "only available for registered users who follow this account", "Restricted Video", "This video is only available for registered users"). |
| `POST_UNAVAILABLE`   | 404         | The post is deleted, gone, or returned an empty media response (yt-dlp: "Instagram sent an empty media response", "Video not available, status code N", HTTP 404). |
| `NO_VIDEO_IN_POST`   | 422         | No video formats were found — either a photo/carousel post, or Instagram withholding the video. Deliberately one honest message for both; the response doesn't reliably distinguish them. |
| `GEO_OR_IP_BLOCKED`  | 403         | This server's IP address is blocked from accessing the post (yt-dlp: "Your IP address is blocked from accessing this post"). |
| `SOURCE_UNAVAILABLE` | 502         | Transient extractor failure, usually worth retrying (yt-dlp: "Unexpected response from webpage request", "Unable to solve JS challenge"). |
| `DOWNLOADER_MISSING` | 503         | The yt-dlp binary could not be found or spawned on the server.        |
| `EXTRACT_UNAVAILABLE`| 503         | Extract module failed to load on the server. (Route-level ad hoc code — not one of `CODES` in `extract/errors.js`.) |

---

### `POST /api/extract`

**Path B — extract from a URL.**
Accepts an Instagram Reel or TikTok link. The backend runs yt-dlp to download the video and caption, then passes them to Gemini.

**Request body:**
```json
{ "url": "https://www.tiktok.com/@chef/video/123" }
```

**Response 200** — draft recipe object.

**Error responses** — extract error object with status from the table above. Common errors:
- `400` — URL missing or not Instagram/TikTok.
- `403` — post is private (`PRIVATE_POST`) or this server's IP is blocked (`GEO_OR_IP_BLOCKED`).
- `404` — post deleted/unavailable (`POST_UNAVAILABLE`).
- `422` — no video in the post — photo/carousel or IG withheld it (`NO_VIDEO_IN_POST`).
- `429` — Instagram/TikTok is rate-limiting the server (`SOURCE_RATE_LIMITED`) or Gemini's free tier is exhausted (`RATE_LIMITED`).
- `502` — yt-dlp could not fetch the video for another reason (`FETCH_FAILED`), or a transient extractor hiccup worth retrying (`SOURCE_UNAVAILABLE`).
- `503` — server not configured (`CONFIG`), IG cookies expired (`COOKIES_EXPIRED`), or yt-dlp itself is missing (`DOWNLOADER_MISSING`).
- `504` — request timed out.

---

### `POST /api/extract/upload`

**Path A — extract from an uploaded video file.**
Always available; the reliable fallback when a link fails.

**Request:** `multipart/form-data`, single field named `video`.

```
Content-Type: multipart/form-data
field name:   video
max size:     200 MB
```

The server saves the upload to a temp file, calls Gemini, then deletes the temp file regardless of success or failure.

**Response 200** — draft recipe object.

**Error responses** — extract error object with status from the table above. Common errors:
- `400` — no file attached.
- `422` — video processed but no recipe found, or unparseable Gemini output.
- `503` — server not configured (set `GEMINI_API_KEY` in `server/.env`).

---

## 9. Common error shape

All error responses follow:
```json
{ "error": "human-readable message" }
```

Extract errors additionally carry `code` (see §6 table).

Standard HTTP status codes used:
- `200` — success
- `201` — created
- `204` — success, no body (DELETE)
- `400` — bad request / missing required field
- `404` — not found
- `422` — unprocessable (extract produced no usable recipe)
- `502` — bad gateway (yt-dlp downstream failure)
- `503` — service unavailable (extract not configured)
- `504` — gateway timeout (extract timed out)
- `500` — unexpected server error
