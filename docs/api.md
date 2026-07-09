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
6. [AI Extract](#6-ai-extract)
7. [Common error shape](#7-common-error-shape)

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

**Response 201** — the created recipe object (same shape as GET).

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

`GET /api/meal-plan` always returns all seven days of the **current Mon–Sun week**, even if a day has no assignments.

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

Return the current week's meal plan, keyed by ISO date.

**Response 200**
```json
{
  "week": ["2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13"],
  "plan": {
    "2026-07-07": [{ ...mealPlanEntry }, ...],
    "2026-07-08": [],
    "2026-07-09": [],
    "2026-07-10": [],
    "2026-07-11": [],
    "2026-07-12": [],
    "2026-07-13": []
  }
}
```

`week` is an array of ISO dates Mon–Sun for the current week.
Every day in `week` is present as a key in `plan`; empty days hold an empty array.
Entries within each day are ordered by `position`.

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

## 6. AI Extract

Runs server-side only. The Gemini API key is never exposed to the browser.
Both endpoints return a **draft recipe JSON** that is **not persisted** — the frontend displays it as an editable draft, and a separate `POST /api/recipes` call saves it.

### Draft recipe object

Same shape as a recipe object (see §2) but without `id`, `created_at`, `updated_at`, `favorite`, `source_url`, or `source_caption` (those are absent or supplied by the frontend at save time). The `filters` field **is** present — it is populated by AI assignment using the user's current filter list at extraction time:

```json
{
  "title":       "string",
  "description": "string",
  "cuisine":     "string",
  "category":    "string",
  "minutes":     25,
  "servings":    4,
  "image":       "data:image/jpeg;base64,... or null",
  "ingredients": [{ "name": "string", "qty": "string (imperial)" }],
  "steps":       ["string"],
  "tags":        [],
  "filters":     ["Chicken", "Quick"]
}
```

All measurements are imperial (weights oz/lb, volumes cups/tbsp/tsp/fl oz, temps °F).

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

## 7. Common error shape

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
