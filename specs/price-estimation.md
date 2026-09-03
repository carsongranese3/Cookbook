# Spec: Shopping List price estimation

Status: **Mode B — delta on an existing screen.** The Shopping List already exists and works;
this spec documents its current behavior and the specific addition. It is **not** a from-scratch
re-spec of the Shopping List.

Sources this spec must not contradict: `CLAUDE.md`, `docs/decisions.md` (§ "2026-09-02 — Shopping
List price estimation (scope decisions)"), `docs/design.md`. The scope decisions in that log entry
are **fixed** — this spec elaborates them, it does not reopen them.

Not sourced from Azure DevOps (not requested).

Feature, in the user's words:
> "Price estimation in the shopping list. I want to set it to a grocery store I pick and when I hit
> a button I want a price estimation of everything in the list."

and, on how checked items are handled:
> "If there is checked stuff have an option where I can discount checked stuff."

---

## 1. Current behavior (what exists today, verified on disk)

### 1.1 Screen — `client/src/screens/ShoppingList.jsx`

- Loads once via `api.shopping.get()` → `GET /api/shopping-list`; shows a spinner
  (`state-center` + `spinner`) while loading, an `.error-banner` with a **Retry** button on failure.
- Header (`.library-header`): eyebrow `"{uncheckedCount} to buy"`, title "Shopping List",
  desktop search box + `+ Add item`, phone `+ Add` in the top right.
- A category toggle bar (`.chip-row` / `.chip.active`), one chip per category, seeded once from
  content (categories with items on, empty ones off).
- Items are grouped into fixed category sections. `catOf(it)` folds any unknown category to
  `'Other'`. Categories come from `PANTRY_CATEGORIES`, exported by
  `client/src/screens/PantryScreen.jsx` (and duplicated server-side at `server/index.js:1419-1429`).
- Item row (`.shop-item`): `.shop-checkbox` → `.shop-item-name` (title-cased) → `.shop-item-qty`
  (only when `qty` is non-empty) → `.shop-item-delete`.
- Whole-list action row `.shop-actions`, buttons styled `btn btn-ghost shop-action-btn`:
  **Send to Reminders**, **Copy N for Reminders**, and — only when something is checked —
  **Move to Pantry** and **Clear checked**.
- `handleMoveToPantry` is the existing precedent for "button → server round-trip → inline result":
  a `movingToPantry` busy flag, a label swap (`Moving…`), a transient `.shop-pantry-msg`
  (`role="status"`) cleared by `setTimeout` after ~3–3.5s, and `load()` to revert on error.
- Every mutating control is disabled when the `isOffline` prop is true. Copy-for-Reminders is
  deliberately **not** gated on `isOffline` because it is purely local.

### 1.2 Data — `server/db.js`, `server/index.js`

- `shopping_list(id, name, qty TEXT, checked INTEGER, position, category, req_base, req_dim)`.
  `req_base` / `req_dim` are hidden accumulation columns used by `from-recipe`.
- `rowToShoppingItem` (`server/index.js:1058`) returns
  `{ id, name, qty, checked, position, category }` — **no price/cost field exists anywhere.**
- `qty` is free text: `"1 lb"`, `"2"`, `"1 bag"`, `"1 block"`, `"1 pack"`, or `""`.
- Routes: `GET`, `POST`, `POST /from-recipe/:recipeId`, `PATCH /:id`, `DELETE /:id`,
  `POST /clear-checked`, `POST /move-to-pantry`.
- There is **no** settings table, no key-value store, and no price/cost code in the repo.
- Gemini access is server-side only, via `server/extract/*`, keyed by `GEMINI_API_KEY` in
  `server/.env`.

### 1.3 What must not change

Everything in §1.1–1.2 keeps working exactly as it does today. Specifically: item add/edit/toggle/
delete, `from-recipe` accumulation, category grouping and the toggle bar, Send/Copy to Reminders,
Move to Pantry, Clear checked, the offline gating, and the `{id,name,qty,checked,position,category}`
item shape. No column is added to `shopping_list`. No existing endpoint changes its response shape.

---

## 2. The delta

Four additions, nothing else:

1. **A persisted store choice** (grocery chain + optional ZIP), stored server-side so the Mac and
   the phone agree, editable from a small modal on the Shopping List.
2. **An "Estimate cost" button** in the existing `.shop-actions` row that asks the server to price
   the list, and renders **a price per item plus a list total**.
3. **A "skip checked items" toggle** on the total, so the user can discount what is already in the
   cart. Client-side arithmetic only — see §5.1.
4. **A server-side price book** (cache) so repeat presses cost zero Gemini calls until entries go
   stale (30 days), the store/ZIP changes, or an item's `qty` changes.

The number is always an **AI estimate**, never a quote. The UI must say so on screen every time a
total is shown.

Files expected to change (smallest viable set):

| File | Change |
|---|---|
| `server/db.js` | new `settings` and `price_book` tables (+ unique index) |
| `server/extract/price.js` | **new** — Gemini pricing module, modeled on `server/extract/receipt.js` |
| `server/extract/index.js` | one added named export (mirrors line 48, `extractReceipt`) |
| `server/index.js` | store settings routes + `POST /api/shopping-list/estimate`, in the Shopping List section |
| `client/src/api.js` | `api.shopping.getStore/setStore/estimate` |
| `client/src/screens/ShoppingList.jsx` | store button + modal, Estimate button, total line + skip-checked toggle, per-item price |
| `client/src/styles.css` | `.shop-estimate*`, `.shop-item-price` |
| `docs/api.md` | new §5 endpoints **and** fix the stale §5 item shape (see §7) |
| `docs/data-shapes.md` | the two new tables + the estimate response |

---

## 3. Data shapes

### 3.1 `settings` table (new, generic key-value)

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
```

Keys used by this feature — exactly these two strings:

| key | value | default when absent |
|---|---|---|
| `shopping.store` | display name of the chosen chain, e.g. `Trader Joe's` | `''` (no store picked) |
| `shopping.zip`   | 5-digit US ZIP, e.g. `02139` | `''` (no ZIP) |

Created with `CREATE TABLE IF NOT EXISTS` next to the other tables in `server/db.js`. Any future
column follows the existing boot-time `PRAGMA table_info` → `ALTER TABLE ADD COLUMN` migrations-array
pattern (`recipeMigrations` / `shoppingMigrations`).

The skip-checked toggle is **not** stored here — it is transient client state that lives only as long
as the on-screen estimate does (§6.4).

### 3.2 `price_book` table (new)

```sql
CREATE TABLE IF NOT EXISTS price_book (
  id         TEXT PRIMARY KEY,
  store      TEXT NOT NULL,             -- normalized store string (see normalizeStore)
  zip        TEXT NOT NULL DEFAULT '',  -- '' when no ZIP, never NULL
  name_key   TEXT NOT NULL,             -- normalized item name (see normalizeName)
  name       TEXT NOT NULL,             -- the item name as it was priced (display only)
  qty_key    TEXT NOT NULL DEFAULT '',  -- the REQUESTED qty (the list row's own qty, '' allowed)
                                        -- part of the unique key; see the note below
 qty_priced TEXT NOT NULL DEFAULT '',  -- what the model says it priced (display only, NOT a key)
  unit_price REAL NOT NULL,             -- USD price for buying qty_priced of this item
  currency   TEXT NOT NULL DEFAULT 'USD',
  updated_at TEXT NOT NULL              -- ISO 8601
);
CREATE UNIQUE INDEX IF NOT EXISTS price_book_key
  ON price_book (store, zip, name_key, qty_key);
```

- **`zip` must be `''`, never `NULL`.** SQLite treats NULLs as distinct inside a UNIQUE index, so a
  NULL zip would silently allow unlimited duplicate rows for the no-ZIP case.
- `unit_price` is **the price of `qty_priced`**, not a per-unit rate. The server does **no
  arithmetic on quantities** — see §5.3.
- The book has no concept of `checked`. Whether an item is in the cart has no bearing on what it
  costs, so a cached price is reused across check/uncheck freely.
- Writes are upserts on the unique key
  (`INSERT ... ON CONFLICT(store, zip, name_key, qty_key) DO UPDATE`).
- **`qty_key` and `qty_priced` are deliberately different columns.** `qty_key` is what we *asked* to
  price (the list row's qty, verbatim, `''` when the user left it blank); `qty_priced` is what the
  model *says* it priced ("1 loaf"). Conflating them was a real bug: a blank-qty row was stored
  under the model's assumed qty and then looked up by its own `''`, so it missed forever and cost a
  Gemini call on every press. Only `qty_key` is ever compared.
- Rows are never deleted by this feature. Changing store or ZIP just misses the cache; switching
  back is free.

### 3.3 Normalization helpers (server, one definition each)

```
normalizeName(s)  = String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
normalizeStore(s) = String(s ?? '').trim().replace(/\s+/g, ' ')      // case preserved
normalizeZip(s)   = String(s ?? '').trim()                          // '' or /^\d{5}$/
```

`normalizeName` is deliberately dumb: trim, lowercase, collapse internal whitespace. **No stemming,
no singularization, no synonym mapping.** "Tomatoes" and "tomato" are different cache keys, and that
is acceptable.

### 3.4 Curated store list — one source of truth

The chain list lives **on the server only**, next to the Shopping List routes in `server/index.js`,
and is returned by `GET /api/shopping-list/store`. **Do not hardcode it in the client** — the
`PANTRY_CATEGORIES` list is already duplicated in two places and must not gain a third sibling
problem.

```
Aldi, Costco, Food Lion, Giant, H-E-B, Hannaford, Harris Teeter, Kroger, Market Basket, Meijer,
Publix, Safeway, Sam's Club, ShopRite, Sprouts, Stop & Shop, Target, Trader Joe's, Walmart,
Wegmans, Whole Foods Market
```

This generic national set is **confirmed by the user** — they chose it over naming their own local
stores. Alongside it the picker offers an **"Other…"** option that reveals a free-text field, so an
unlisted local store still works; a custom store is stored as the plain string the user typed.

Server validation for any store value: non-empty after `normalizeStore`, ≤ 60 characters, no control
characters or newlines (it is interpolated into a Gemini prompt).

### 3.5 Estimate response (transient — never persisted on `shopping_list`)

```json
{
  "store": "Trader Joe's",
  "zip": "02139",
  "currency": "USD",
  "items": [
    {
      "id": "9f1c…",
      "name": "whole milk",
      "qty": "1 gal",
      "qty_priced": "1 gal",
      "checked": false,
      "price": 4.29,
      "cached": true,
      "updated_at": "2026-08-14T11:02:44.101Z"
    },
    {
      "id": "2ab7…",
      "name": "saffron threads",
      "qty": "1 pack",
      "qty_priced": null,
      "checked": true,
      "price": null,
      "cached": false,
      "updated_at": null
    }
  ],
  "total": 4.29,
  "total_unchecked": 4.29,
  "priced_count": 1,
  "unpriced_count": 1,
  "estimated_at": "2026-09-02T14:11:03.221Z",
  "gemini_calls": 1
}
```

- `items` covers **every** row on the list, checked and unchecked alike (§5.1).
- `items[].id` is the `shopping_list` row id — the client maps prices back by id, not by name.
- `items[].checked` is the row's state **at request time**, included so the response is
  self-describing; the client uses its own live state for display.
- `price` is USD, `null` when the item could not be priced. Never a string, never a `$`-prefixed
  value.
- `total` = sum of all non-null `price` values. `total_unchecked` = the same sum restricted to items
  that were unchecked at request time. Both are reference values; **the number on screen is always
  recomputed client-side** from the snapshot and the *live* checked state (§6.3 state 4).
- `priced_count` / `unpriced_count` count all rows, not just unchecked ones.
- `cached` — true when the price came from `price_book` without a Gemini call this press.
- `gemini_calls` — how many Gemini requests this press made. **0 on a fully cached press.** This
  field exists so the caching acceptance criterion is directly observable; it is not shown in the UI.

---

## 4. Endpoints

All relative `/api/*`, added inside the existing Shopping List section of `server/index.js`.

### 4.1 `GET /api/shopping-list/store`

Returns the persisted choice plus the curated list the picker renders.

**200**
```json
{ "store": "Trader Joe's", "zip": "02139", "stores": ["Aldi", "Costco", "…"] }
```
`store` and `zip` are `""` when unset. Never errors on an empty `settings` table.

### 4.2 `PUT /api/shopping-list/store`

**Body:** `{ "store": "Trader Joe's", "zip": "02139" }` — `zip` optional, `""` clears it.

- `store` may be any of `stores` **or** a custom string; validated per §3.4.
- `zip` must be `""` or exactly 5 digits.
- Writes `shopping.store` / `shopping.zip` via upsert.

**200** — same shape as §4.1.
**400** — `{ "error": "Pick a store." }` or `{ "error": "ZIP must be 5 digits." }`

### 4.3 `POST /api/shopping-list/estimate`

Price the list. Mutating (writes the price book, spends quota), so POST.

**Body** (all optional): `{ "refresh": false }`. `refresh: true` ignores cached entries and
re-prices every item.

There is **no** request parameter for checked items. Everything is priced; what counts toward the
displayed total is a client-side decision (§5.1).

**200** — the §3.5 shape.

**Errors**

| Status | code | When |
|---|---|---|
| 400 | `NO_STORE` | `shopping.store` is unset |
| 409 | `ESTIMATE_IN_PROGRESS` | another estimate is already running (see §5.5) |
| 503 | `EXTRACT_UNAVAILABLE` | `getExtractModule()` returned null |
| 503 | `CONFIG` | `GEMINI_API_KEY` missing / SDK not installed |
| 429 | `RATE_LIMITED` | every model in the chain is rate-limited |
| 504 | `TIMEOUT` | exceeded `GEMINI_TIMEOUT_MS` |
| 422 | `PARSE_FAILED` | unparseable JSON after the one retry |
| 502 | `FETCH_FAILED` | Gemini call failed for another reason |
| 500 | — | anything unexpected |

Error body is the house shape: `{ "error": err.userMessage, "code": err.code }`.

**These codes are all existing `CODES` values** (`server/extract/errors.js`) already mapped by
`extractCodeToStatus` (`server/index.js:299`). `NO_STORE` and `ESTIMATE_IN_PROGRESS` are plain route
guards that set their own status directly — they are **not** `ExtractError` codes. If a future change
does introduce a new `ExtractError` code, it **must** be added to `extractCodeToStatus` or it silently
falls through to 500.

---

## 5. Server behavior

### 5.1 Which items get priced — all of them

**Every row on the shopping list is priced, regardless of `checked` state.** The server does not
filter on `checked` at any point.

Whether checked items count toward the **total** is decided on the client by the skip-checked toggle
(§6.3 state 4a). Pricing everything up front is precisely what makes that toggle free: both totals
are already derivable from one snapshot, so **flipping the toggle is pure client-side arithmetic —
zero Gemini calls, zero requests of any kind, no cache miss, and never a re-estimate.** Filtering
server-side would have meant a fresh round-trip (and possibly a fresh Gemini call) every time the
user changed their mind about what was already in the cart.

The same property is what lets checking an item off mid-shop update the total instantly without
invalidating the estimate (§6.3 state 6).

If the list is empty, return **200** with `items: []`, `total: 0`, `total_unchecked: 0`,
`gemini_calls: 0`. No error. (The button is not rendered in that state anyway.)

### 5.2 Cache resolution, per item

For each item, look up `price_book` by `(normalizeStore(store), normalizeZip(zip),
normalizeName(item.name))`. Treat the entry as a **hit** only when all of:

1. a row exists, **and**
2. `updated_at` is newer than 30 days ago, **and**
3. `qty_priced === item.qty` (exact string compare after `trim()`), **and**
4. `refresh` is not true.

Anything else is a **miss**. `checked` is not part of this test. Misses are batched into one Gemini
call. Because `qty_key` is part of the unique key, a qty edit writes a **new** row rather than
overwriting the old one — two rows with the same name and different quantities each keep their own
cached price. That is deliberate: keying on name alone made same-name/different-qty rows re-price
each other forever, one Gemini call per press, permanently defeating the cache. The superseded row
is harmless and ages out at 30 days.

### 5.3 The Gemini call — one per press

Modeled directly on `server/extract/receipt.js`: same shared helpers from `server/extract/gemini.js`
(`resolveModelChain`, `withTimeout`, `classifyGeminiError`, `parseModelJson`, `TIMEOUT_MS`), the same
`callModel` closure that walks the model chain skipping rate-limited / 400 / 404 models, the same
single JSON-only retry, and the same defensive coercion that **drops** unusable entries rather than
defaulting them.

- **All missing items go in one request.** Never one call per item.
- Items are sent with a stable index so the mapping back is immune to the model rewriting names:
  `[{ "i": 0, "name": "whole milk", "qty": "1 gal" }, …]`. `checked` is never sent — it is
  irrelevant to what something costs.
- Names are **de-duplicated by `name_key` before the call** — two list rows named "Milk" cost one
  entry in the prompt, and the returned price is applied to both rows (see §7, hazard a).
- Required response shape:
  ```json
  { "items": [ { "i": 0, "qty": "1 gal", "price": 4.29 } ] }
  ```
- Prompt rules the module must state explicitly:
  1. Return ONLY valid JSON — no prose, no markdown fences.
  2. Prices are **USD**, a plain number, no currency symbol, no range, no text.
  3. Price the **whole quantity given**, not a per-unit rate. `"1 gal"` → the price of a gallon.
  4. When `qty` is empty, assume a typical single store purchase, and **echo what you assumed** in
     the response `qty`.
  5. Give a typical current shelf price at `<store>`{` near ZIP <zip>` when set}. It is an
     approximation — do not refuse because you cannot know the exact price.
  6. Use `"price": null` for anything you genuinely cannot price. Do not guess wildly, and do not
     omit the entry.
  7. Imperial units only (house rule from `CLAUDE.md`).
- **No arithmetic on `qty` anywhere.** The server never parses `"1 block"` into a number and never
  multiplies. This is what makes hazard (b) a non-issue: whatever the qty string says, the model
  prices that string as a whole and echoes back what it priced.
- `server/storeQty.js` is **not** touched — it has no price concept and gains none.

### 5.4 Coercion and sanity limits

Every returned price passes through:

```
n = Number(raw); valid iff Number.isFinite(n) && n >= 0 && n <= 999
```

Invalid → treated as `null` (unpriced), **not** written to the book. Round to 2 decimals for storage
and display. Nothing from the model is rendered as HTML, and no model-supplied string other than the
echoed `qty` (trimmed, ≤ 24 chars) reaches the UI.

Batch cap: `MAX_ESTIMATE_ITEMS = 60` items per Gemini call. If more items are missing, price the
first 60 in list `position` order; the remainder come back `price: null` and are counted in
`unpriced_count`. Cached items do not count against the cap.

### 5.5 In-flight guard

There is no auth and no rate limiting on this server, and both the Mac and the phone hit it. A
module-level in-flight flag rejects a concurrent second estimate with **409 `ESTIMATE_IN_PROGRESS`**.
The flag is cleared in a `finally`. This is quota protection, not a security control — the client
must *also* disable the button while pending (§6.2).

---

## 6. UI — every state

### 6.1 Store picker

- A control in the existing `.shop-actions` row, `btn btn-ghost shop-action-btn`:
  - no store set → label **`Set store`**
  - store set → label **`Store: Trader Joe's`** (with ZIP appended when present:
    `Store: Trader Joe's · 02139`)
- Opens a modal using the existing pattern: `modal-scrim` → `modal-box` → `modal-header mf-header`
  + `mf-close-btn` → `modal-body`, exactly as `ReceiptImportModal.jsx` / `CopyFallbackModal`.
- Modal body: a `form-input form-select` populated from the `stores` array in the GET response
  (with an `Other…` entry), an optional ZIP `form-input` (`inputMode="numeric"`, `maxLength={5}`,
  hint "Optional — prices vary by area"), and `form-actions` with **Save** (`btn btn-primary`) and
  **Cancel** (`btn btn-ghost`).
- Choosing `Other…` reveals a text input for the store name; Save is disabled until it is non-empty.
- Save calls `PUT`, closes on success; on failure it stays open and shows the error inside the modal.
- Disabled while `isOffline` (it is a server write).

### 6.2 The estimate control

A `btn btn-ghost shop-action-btn` in `.shop-actions`, placed after **Copy for Reminders**.

| Condition | Label | Enabled |
|---|---|---|
| default | `Estimate cost` | yes |
| pending | `Estimating…` | **no** |
| an estimate is on screen and still current | `Re-estimate` | yes |
| an estimate is on screen but stale | `Re-estimate` (with the stale note below the row) | yes |
| `isOffline` | `Estimate cost` | no |
| no store set | `Estimate cost` | yes — pressing it opens the store picker instead of calling the API |

The whole `.shop-actions` row only renders when `items.length > 0`, so an empty list needs no extra
guard. **The button is not disabled when every item is checked** — the list is still priceable, and
the user can include checked items in the total (§6.3 state 4a).

### 6.3 UI states, exhaustively

1. **No store picked yet** — action row shows `Set store`; pressing `Estimate cost` opens the store
   modal rather than firing a request. No total is shown. (The server still guards with 400
   `NO_STORE` for a direct API call.)
2. **Store picked, never estimated** — `Estimate cost` is enabled; no total line; no per-item prices.
   Nothing is fetched automatically. **Estimating never happens on page load or on any other action.**
3. **Estimating (in progress)** — button reads `Estimating…` and is `disabled`; all other action-row
   buttons remain usable; the item list is not blocked. A `role="status"` line reads
   `Estimating prices at <store>…`. No spinner overlay — this matches `Moving…` on Move to Pantry.
4. **Estimated (success)** — a total block (`.shop-estimate`) below `.shop-actions`:
   > **Estimated total ≈ $84.20** · Trader Joe's · 02139 · 23 of 25 items priced
   > AI estimate — not a real price.

   and a `.shop-item-price` on each priced row, right of `.shop-item-qty`, formatted `$4.29`.
   **Checked rows show their price too** (dimmed to match the existing `.shop-item-name.checked`
   treatment), because they may or may not be counted — the user needs to see the number either way.
   The disclaimer text is **required** and must be visible whenever a total is, not hidden behind a
   tooltip. The `≈` (or the word "Estimated") must be present.

   The displayed figure is **always recomputed on the client** from the snapshot: sum the snapshot
   prices of rows that are still on the list, are still priced, and — when the skip toggle is on —
   are currently unchecked. The server's `total` / `total_unchecked` are reference values, not the
   rendered number.

4a. **Skip-checked toggle** — rendered **only when at least one item on the list is currently
   checked**. When nothing is checked the control is absent entirely (not disabled, not hidden by
   CSS — not rendered), and the total line carries no checked-items qualifier.

   - A checkbox inside the `.shop-estimate` block, class `.shop-estimate-toggle`, with a real
     `<label>` bound by `htmlFor`/`id`: **`Skip 4 checked items`** (the count is live).
   - **Default is on** (checked items are skipped) — the common case is "what do I still have to
     spend". The default applies to each new estimate.
   - The total line gains a qualifier so the active mode is never ambiguous:
     - toggle **on** → `**Estimated total ≈ $61.15** · excluding 4 checked · Trader Joe's · 02139 · 23 of 25 items priced`
     - toggle **off** → `**Estimated total ≈ $84.20** · including 4 checked · Trader Joe's · 02139 · 23 of 25 items priced`
   - Flipping it re-renders the total from the existing snapshot. **No network request, no Gemini
     call, no cache write, no staleness.** It must remain instant and usable offline.
   - The toggle appears and disappears as items are checked/unchecked. Its on/off value is remembered
     for the life of the current estimate, so it survives an item being unchecked and re-checked.
   - When the toggle is on and *every* item is checked, the total reads `≈ $0.00 · excluding 25
     checked`. That is correct, not an error state.
5. **Partial success** — some items priced, some `price: null`. Unpriced rows show `—` in the price
   slot (with `title`/`aria-label` "No estimate available"). The total block says
   `23 of 25 items priced` and adds `2 items couldn't be priced`. This is a normal state, not an
   error — no `.error-banner`.
6. **Stale / invalidated** — the on-screen estimate is a snapshot. It is marked stale when the list
   changes structurally: an item is **added**, **deleted**, or has its **name or qty changed**, or
   when the **store or ZIP changes**. Stale rendering: the total block is dimmed and prefixed
   `List changed — ` with the button reading `Re-estimate`. Prices already on rows stay visible
   (dimmed) rather than vanishing.
   **Checking / unchecking an item does NOT mark the estimate stale**, and neither does flipping the
   skip toggle. Every row was already priced (§5.1), so both are pure arithmetic on data the client
   already holds — checking an item off simply moves its price in or out of the total. This is the
   normal in-store flow and must not nag the user to re-estimate.
   Items added after the estimate render `—` and are excluded from the total.
7. **Offline** (`isOffline`) — the Estimate button and the store picker are disabled. An estimate
   already on screen stays on screen, **and the skip-checked toggle keeps working** (it is local
   arithmetic). No queued/retried request.
8. **Error** — a `.error-banner` (`role="alert"`) below the action row, with the server's
   `error` string and a **Retry** button, matching the existing load-error banner. Any prior
   estimate stays on screen, marked stale.
   - no API key / SDK missing → 503 `CONFIG`: "The server is not configured for AI extraction…"
   - all models rate-limited → 429 `RATE_LIMITED`: the free-tier message
   - timeout → 504 `TIMEOUT`
   - unreadable model output → 422 `PARSE_FAILED`
   - concurrent press from another device → 409: "An estimate is already running."
   - network failure → the client's generic request error

### 6.4 Persistence of the on-screen estimate

The estimate **and the skip-checked toggle** are **client state only**. Neither is written to
`shopping_list`, stored in `localStorage`, or survives a reload or a tab switch away from the
Shopping List; the toggle resets to its default (on) with each new estimate. Re-pressing after a
reload is cheap (`gemini_calls: 0`) because the price book is server-side. The store choice, by
contrast, is server-persisted and does survive.

### 6.5 Styling

New classes only; no CSS framework, no existing rule rewritten:
- `.shop-estimate` — the total block (12–13px Onest, `var(--muted)` for the meta line, matching
  `.shop-pantry-msg` weight/color conventions), `.shop-estimate.stale` for the dimmed variant.
- `.shop-estimate-toggle` — the checkbox + label row inside that block; tap target ≥ 32px high on
  phone.
- `.shop-item-price` — sits beside `.shop-item-qty` (styles.css:1660): `font: 400 12px 'Onest'`,
  `white-space: nowrap`, `flex-shrink: 0`; `.shop-item-price.checked` dimmed like the name. It must
  not push `.shop-item-delete` off narrow phone rows — verify at 375px width.

---

## 7. Edge cases and failure states

**The four known hazards from the code map:**

- **(a) Duplicate item names.** Manual adds are not de-duped, so the list can hold two rows named
  "Milk" with different ids. Behavior: both rows are priced (the price book is keyed by name, so the
  same cached price applies to both) and **both contribute to the total** — that is correct for a
  list that genuinely contains two entries. The Gemini prompt sees the name once, not twice. The
  client maps prices back **by row id**, never by name, so two identically-named rows can never
  collide or swap — and one of them being checked while the other is not resolves cleanly under the
  skip toggle.
- **(b) `qty` with no numeric basis** (`"1 block"`, `"1 pack"`, `"1 bunch"`). Handled by never
  parsing qty: the string is passed to Gemini verbatim and priced as a whole. No `parseQty` /
  `parseRequired` call is added anywhere in this feature.
- **(c) `docs/api.md` §5 is stale** — its shopping-list item object omits `category`, and the
  `from-recipe` response now also returns `merged`. `move-to-pantry` is not documented in §5 at all.
  Verify against `server/index.js:1058-1235` and fix §5 while adding the new endpoints.
- **(d) No auth, no server-side rate limiting.** Mitigated three ways: the button is `disabled`
  while pending, the server keeps an in-flight guard returning 409, and the price book means a
  repeat press is free. The skip-checked toggle adds no exposure at all — it never touches the
  network.

**Other cases:**

- **Empty list** — `items.length === 0`: the whole `.shop-actions` row is already hidden today, so
  the Estimate button does not render. The endpoint still returns 200 with `total: 0`.
- **All items checked** — the list is still fully priced and the Estimate button stays enabled. With
  the skip toggle on (default) the total is `$0.00 · excluding N checked`; turning it off shows the
  full basket cost. Neither is an error.
- **Nothing checked** — the skip toggle is not rendered and the total line carries no qualifier.
- **Item checked while an estimate is on screen** — the toggle appears (if it was absent), the total
  drops by that item's price when the toggle is on, and nothing is marked stale.
- **Item with empty `qty`** — Gemini assumes a typical purchase and echoes it; the row shows the
  price and the echoed `qty_priced` is available to the UI as a `title` on the price so the user can
  see what was assumed. `qty_priced` is what gets stored, so a later real qty edit is a clean miss.
- **Item Gemini cannot price** (`price: null`, or a value failing the §5.4 sanity check) — nothing is
  written to the price book, so the next press retries it. The row shows `—`; the total is labeled
  "N of M items priced". An unpriced *checked* item is invisible to the toggle either way.
- **Model returns a price for an index that was not sent, or omits an index** — extra indices are
  dropped; omitted indices are treated as unpriced. Never throw on this.
- **Model returns a garbage-large or negative price** — rejected by §5.4, treated as unpriced.
- **Store changed** — the on-screen estimate goes stale, prices are dimmed, and the next press misses
  the cache for every item (different key). The old store's rows stay in `price_book`, so switching
  back later is free.
- **ZIP changed (including added or cleared)** — same as a store change: different key, full re-price.
  Setting a ZIP for the first time therefore costs one full Gemini call.
- **Cache entry older than 30 days** — miss; re-priced and upserted.
- **Item renamed via `PATCH`** — new `name_key`, so a miss; the old key's row is left behind harmlessly.
- **`qty` edited via `PATCH`** — `qty_priced` no longer matches, so a miss; the same key is
  overwritten with the new price and qty.
- **Concurrent presses from Mac and phone** — the second gets 409 and a plain message; no double
  Gemini spend.
- **Very long list (>60 unpriced items)** — first 60 by `position` are priced, the rest report as
  unpriced; a second press picks up the next 60 (the first 60 are now cached).
- **The list is mutated while an estimate is in flight** — the response is keyed by id; ids that no
  longer exist on the client are dropped, and the estimate is marked stale on arrival.
- **Gemini returns valid JSON but zero items** — 200 with everything unpriced. **Do not** throw
  `NO_RECIPE`; there is nothing for the user to fix.
- **Currency** — USD only. The response carries `"currency": "USD"` for honesty; the client formats
  with a literal `$` and does not attempt localization.

**Pre-existing bug in this file — flag, do not fix here (already being repaired):**
`client/src/screens/ShoppingList.jsx:348` renders `<ShoppingFormModal …>`, but `ShoppingFormModal` is
neither imported nor defined anywhere in the repo (grep-confirmed, whole tree). The orchestrator
reproduced it live: clicking "+ Add item" throws a `ReferenceError` and unmounts the entire
ShoppingList screen, since there is no error boundary. It predates and is unrelated to price
estimation. **It is being fixed as a separate change, by a different agent, in this same file, before
the price work lands** — so QA should not encounter it, and must not attribute it to this feature if
they do. Whoever implements price estimation must rebase onto that fix rather than re-adding a
modal of their own.

---

## 8. Assumptions (orchestrator: please confirm with the user)

Resolved by the user and no longer assumptions: how checked items are handled (§5.1 / §6.3 state 4a —
a toggle, defaulting to skip), and the curated store list plus free-text "Other…" (§3.4).

Still assumed:

1. **US-only, USD-only, 5-digit ZIP validation.** Consistent with the imperial-units house rule.
2. **The estimate and the skip toggle are not persisted client-side** and disappear on reload (the
   store choice does not).
3. **Prices are shown to 2 decimals with a `$`** and the total uses `≈`. No rounding to whole dollars.
4. **`MAX_ESTIMATE_ITEMS = 60`** is a guess at a safe single-prompt batch, not a measured limit.
5. **The exact toggle copy** (`Skip N checked items`, `excluding N checked` / `including N checked`)
   is my wording, chosen so the number on screen is never ambiguous. Reword freely; the requirement
   is that the active mode is legible next to the total, not the specific phrasing.

### 8.1 Deferred — considered and declined, not overlooked

- **Pre-filling the ZIP** from any source. There is no location data in the app, so it stays
  hand-typed.
- **Per-category subtotals** (e.g. "Produce ≈ $18.40"). The decision log specifies per-item + list
  total; section subtotals are a plausible later extension, explicitly not built now.
- **A "prices as of <date>" line** on the total block. The data exists (`updated_at` per item, up to
  30 days old) but it was judged clutter. Revisit if a stale price ever misleads.

---

## 9. Acceptance criteria

### AC-1 — Store choice
1. With `settings` empty, `GET /api/shopping-list/store` returns 200 with `store: ""`, `zip: ""`, and
   a non-empty `stores` array. It does not error.
2. The Shopping List action row shows **`Set store`** when no store is set.
3. Pressing it opens a modal whose select options are exactly the `stores` array from the API plus
   `Other…`; the chain list appears **nowhere** in `client/` source (grep for a chain name such as
   `Wegmans` under `client/src` returns nothing).
4. Choosing a chain + entering `02139` + Save closes the modal; the button now reads
   `Store: <chain> · 02139`.
5. Reloading the page keeps that choice. Loading the app on a second device (or a second browser
   profile) shows the same choice — it is server-side, not `localStorage`.
6. `PUT` with `zip: "0213"` returns 400 with a ZIP message and does not change the stored value.
7. `PUT` with `store: ""` returns 400. `PUT` with a 200-character store returns 400.
8. Choosing `Other…` and typing a store name saves that literal string and the button reflects it.

### AC-2 — Estimating
9. With no store set, pressing `Estimate cost` opens the store modal and makes **no** request to
   `/api/shopping-list/estimate` (verify in the network tab).
10. `POST /api/shopping-list/estimate` with no store set returns **400** with `code: "NO_STORE"`.
11. With a store set, pressing `Estimate cost` swaps the label to `Estimating…`, disables that
    button, and leaves the rest of the screen usable.
12. On success, **every** priced row shows a `$x.xx` beside its qty — checked rows included (dimmed)
    — and a total block appears below the action row.
13. The response's `items` array contains one entry per shopping-list row, checked and unchecked
    alike, and `priced_count + unpriced_count` equals the total row count.
14. The total block contains the store name, the ZIP when set, an `N of M items priced` count, and
    the literal disclaimer that the number is an AI estimate and not a real price. The disclaimer is
    visible on screen, not a tooltip.
15. With nothing checked, the displayed total equals the sum of the per-item prices of **every row
    still on the list**, whether or not a search term or category filter currently hides it (§6.3
    state 4 is the governing rule; the total is a list total, not a view total), to the
    cent.

### AC-3 — Caching (the quota criterion)
16. First press on a fresh DB: the response has `gemini_calls: 1` and `price_book` gains one row per
    priced item.
17. **Second press, list unchanged: the response has `gemini_calls: 0`**, every item has
    `cached: true`, and the total is identical. This is the headline acceptance test.
18. Adding one new item and pressing again: `gemini_calls: 1`, and only the new item has
    `cached: false`.
19. Editing an item's `qty` and pressing again: that item comes back `cached: false`, and a
    **new** `price_book` row is written for the new `qty_key` (the row for the previous qty
    remains, and ages out at 30 days). Pressing a third time with no further edit returns
    `cached: true`. Two rows with the same name and different quantities must **not** re-price
    each other — five consecutive presses must read `gemini_calls: 1, 0, 0, 0, 0`.
19a. An item whose `qty` is **blank** must cache like any other: press twice with no edit and the
    second press returns `gemini_calls: 0` with that item `cached: true`.
20. Checking or unchecking items and pressing again: `gemini_calls: 0` — `checked` state never
    causes a cache miss.
21. Changing the ZIP and pressing again: every item is `cached: false`, and `price_book` now holds
    two rows per item (old ZIP + new ZIP). Changing the ZIP back and pressing: `gemini_calls: 0`.
22. Manually setting a row's `updated_at` to 31 days ago and pressing: that item is re-priced;
    setting it to 29 days ago: it is not.
23. `POST` with `{"refresh": true}` re-prices everything (`gemini_calls: 1`, all `cached: false`)
    even when the cache is fresh.
24. A list with two rows both named "Milk" produces **one** entry in the Gemini request, **two**
    priced rows on screen, and a total that counts the price twice.

### AC-4 — States, and the skip-checked toggle
25. Never estimated: no total block and no per-item prices are rendered anywhere.
26. Nothing is estimated automatically — loading the Shopping List, toggling categories, searching,
    adding an item, checking an item, and moving to pantry all make zero calls to `/estimate`.
27. **With no items checked, the skip-checked toggle is not rendered at all** (absent from the DOM,
    not merely disabled or visually hidden), and the total line shows no `excluding` / `including`
    qualifier.
28. **Checking one item makes the toggle appear**, defaulted **on**, labelled `Skip 1 checked item`,
    and the total line gains `· excluding 1 checked`.
29. **Flipping the toggle off changes the displayed total** to include the checked items' prices and
    swaps the qualifier to `· including N checked`. Flipping it back restores the previous number
    exactly.
30. **Flipping the toggle in either direction issues zero network requests** (verify an empty network
    tab) and therefore `gemini_calls` is unchanged — no `/estimate` call, no store call, nothing.
    It also works with the offline flag set.
31. Flipping the toggle never marks the estimate stale and never changes any per-item price.
32. Unchecking the last checked item removes the toggle and the qualifier; the total returns to the
    all-items figure.
33. With every item checked and the toggle on, the total reads `≈ $0.00 · excluding N checked` and no
    error is shown; turning the toggle off shows the full basket total.
34. Partial success (force one item to `price: null`): that row shows `—`, the total block shows
    `N of M items priced` plus a "couldn't be priced" note, and **no** error banner appears.
35. After a successful estimate, deleting an item marks the block stale: it is dimmed, prefixed
    `List changed`, and the button reads `Re-estimate`. The prices remain visible.
36. After a successful estimate, **checking** an item does **not** show the stale prefix; with the
    toggle on the total drops by exactly that item's price. Unchecking restores it.
37. An item added after an estimate renders `—` and is excluded from the total.
38. With the offline flag set, the Estimate button and the store button are both disabled, and an
    estimate already on screen is still visible and still togglable.
39. Reloading the page clears the on-screen estimate and resets the toggle to its default, but keeps
    the store choice.

### AC-5 — Errors
40. With `GEMINI_API_KEY` unset, pressing Estimate produces a 503 and an `.error-banner` with the
    "not configured" message and a Retry button. The app does not crash and the list stays intact.
41. A forced 429 from the model chain surfaces the free-tier message with status 429 (not 500).
42. Two concurrent `POST /estimate` requests: the second returns **409** `ESTIMATE_IN_PROGRESS`, and
    the first still completes normally.
43. A model response containing `"price": "$4.29 (approx)"`, `-2`, or `100000` results in that item
    being **unpriced**, with nothing written to `price_book` — not a crash, and not a bogus total.
44. A model response that is not JSON triggers exactly one retry, then 422 `PARSE_FAILED`.

### AC-6 — No regressions
45. `GET /api/shopping-list` still returns exactly `{id, name, qty, checked, position, category}` —
    no price field leaks onto the item shape.
46. `shopping_list` has no new columns (`PRAGMA table_info(shopping_list)` unchanged).
47. Add item, toggle, delete, `from-recipe` accumulation, Send to Reminders, Copy for Reminders,
    Move to Pantry, Clear checked, category toggles, and search all behave exactly as before.
48. On a 375px-wide viewport, an item row with a long name, a qty, and a price still shows the
    delete control and does not overflow horizontally.
49. `docs/api.md` §5 documents the new endpoints **and** its item object now includes `category`;
    `from-recipe`'s documented response includes `merged`.
