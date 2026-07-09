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
  "tags":           ["Italian", "Vegetarian"],
  "filters":        ["Chicken", "Quick"],
  "source_url":     "https://www.tiktok.com/... or null",
  "source_caption": "string or null",
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
- `tags` is an array of strings. The "Vegetarian" Library chip matches recipes whose tags contain `"Vegetarian"` (case-insensitive).
- `filters` is an array of user-defined filter label strings. Each entry must be a label that exists in the `GET /api/filters` list. AI extraction and the `/assign-filters` endpoints populate this automatically; it can also be set manually in `POST`/`PUT` recipe requests.
- `image` is a URL or `null`; the frontend falls back to a deterministic gradient placeholder.

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
  "tags":           ["string"],
  "filters":        ["string"],
  "source_url":     "string or null",
  "source_caption": "string or null"
}
```

**Response 201** — a new recipe was inserted (the normal case). Returns the created recipe object (same shape as GET).

**Response 200** — a recipe with the same non-null `source_url` was already created within the last 60 seconds, so **no new row is inserted**; the existing recipe is returned unchanged instead. This is an idempotency guard against repeated save clicks / retries (e.g. double-clicking "Save to library" on a slow request). The response body shape is **identical** in both the 200 and 201 case (the full recipe object), so a client can use `.id` either way without checking the status code.

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

**Request body** — same shape as POST (include `filters` to set assignments explicitly).

**Response 200** — updated recipe object.

**Response 400** — `{ "error": "title is required" }`

**Response 404** — `{ "error": "Recipe not found" }`

---

### `DELETE /api/recipes/:id`

Delete a recipe. Also removes any meal-plan assignments that reference this recipe (cascade).

**Path param:** `id` — recipe UUID.

**Response 204** — no body.

**Response 404** — `{ "error": "Recipe not found" }`

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
- `FETCH_FAILED` (502) — yt-dlp could not re-download the video (link expired, private, etc.).
- `UNSUPPORTED_URL` (400) — the stored `source_url` is not an IG/TikTok link.
- `TIMEOUT` (504) — download timed out.

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
  "position": 0
}
```

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
  "skipped": 1
}
```

`added` — array of newly created items.
`skipped` — count of ingredients that were already present by name (not added).

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

## 8. AI Extract

Runs server-side only. The Gemini API key is never exposed to the browser.
Both endpoints return a **draft recipe JSON** that is **not persisted** — the frontend displays it as an editable draft, and a separate `POST /api/recipes` call saves it.

### Draft recipe object

Same shape as a recipe object (see §2) but without `id`, `created_at`, `updated_at`, `favorite`, `source_url`, or `source_caption` (those are absent or supplied by the frontend at save time). The `filters` field **is** present — it is populated by AI assignment using the user's current filter list at extraction time. Two additional frame-picker fields are included:

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
  "tags":            [],
  "filters":         ["Chicken", "Quick"]
}
```

All measurements are imperial (weights oz/lb, volumes cups/tbsp/tsp/fl oz, temps °F).

Field notes for the frame fields:
- `imageCandidates` — ordered array of JPEG data URIs (≤6), best-guess first. Extracted with ffmpeg (no AI call). Empty array `[]` if no frames could be grabbed.
- `image` — equals `imageCandidates[0]` when candidates is non-empty; `null` otherwise.
- Both fields are **transient** — only the single chosen frame is persisted to the recipe via `PUT /api/recipes/:id` (`image` field).

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
| `FETCH_FAILED`       | 502         | yt-dlp could not download the video (private, bad link, etc.).        |
| `TIMEOUT`            | 504         | The extraction request timed out.                                     |
| `CONFIG`             | 503         | Server is not configured (missing `GEMINI_API_KEY`).                  |
| `EXTRACT_UNAVAILABLE`| 503         | Extract module failed to load on the server.                          |

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
- `502` — yt-dlp could not fetch the video (suggest upload fallback to user).
- `503` — server not configured.
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
