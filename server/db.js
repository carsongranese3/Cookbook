import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Single-file SQLite database, created next to this file on first run.
const db = new Database(join(__dirname, 'cookbook.db'));
db.pragma('journal_mode = WAL');

// ---------------------------------------------------------------------------
// Recipes — full schema (new columns added since Phase 1 scaffold)
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    cuisine        TEXT NOT NULL DEFAULT '',
    category       TEXT NOT NULL DEFAULT '',
    protein        TEXT NOT NULL DEFAULT '[]', -- JSON string[] of main proteins
    carb           TEXT NOT NULL DEFAULT '[]', -- JSON string[] of main carbs
    minutes        INTEGER,
    servings       INTEGER,
    rating         REAL,
    favorite       INTEGER NOT NULL DEFAULT 0,
    image          TEXT,
    ingredients    TEXT NOT NULL DEFAULT '[]',  -- JSON [{name,qty}]
    steps          TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
    step_times     TEXT NOT NULL DEFAULT '[]',  -- JSON number[] (seconds), positionally parallel to steps
    tags           TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
    filters        TEXT NOT NULL DEFAULT '[]',  -- JSON string[] of assigned user filter labels
    source_url     TEXT,
    source_caption TEXT,
    video_file     TEXT,                        -- bare filename in server/media/, or NULL
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
`);

// ---------------------------------------------------------------------------
// Idempotent migration: add any columns that are missing from an older DB.
// Each ALTER TABLE is wrapped in its own try/catch; SQLite errors on dupe cols.
// ---------------------------------------------------------------------------

const existingCols = db
  .prepare("PRAGMA table_info(recipes)")
  .all()
  .map((r) => r.name);

const recipeMigrations = [
  { col: 'description',    ddl: 'TEXT NOT NULL DEFAULT ""' },
  { col: 'cuisine',        ddl: 'TEXT NOT NULL DEFAULT ""' },
  { col: 'category',       ddl: 'TEXT NOT NULL DEFAULT ""' },
  { col: 'protein',        ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { col: 'carb',           ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { col: 'minutes',        ddl: 'INTEGER' },
  { col: 'rating',         ddl: 'REAL' },
  { col: 'favorite',       ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { col: 'image',          ddl: 'TEXT' },
  { col: 'tags',           ddl: 'TEXT NOT NULL DEFAULT "[]"' },
  // servings: old schema stored it as TEXT; the new schema wants INTEGER.
  // SQLite supports ALTER ADD but not ALTER COLUMN, so if servings already
  // exists as TEXT we leave it (values still read as integers via JS coercion).
  { col: 'servings',       ddl: 'INTEGER' },
  { col: 'filters',        ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { col: 'step_times',     ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { col: 'video_file',     ddl: 'TEXT' },
];

for (const { col, ddl } of recipeMigrations) {
  if (!existingCols.includes(col)) {
    try {
      db.exec(`ALTER TABLE recipes ADD COLUMN ${col} ${ddl}`);
    } catch {
      // Column probably appeared between the PRAGMA read and now — harmless.
    }
  }
}

// Migrate notes → description and drop notes shadow if present
if (existingCols.includes('notes')) {
  // Copy notes into description where description is still blank
  db.exec(`
    UPDATE recipes
    SET description = notes
    WHERE (description IS NULL OR description = '')
      AND notes IS NOT NULL
      AND notes != ''
  `);
  // SQLite can't DROP COLUMN before version 3.35.0; leave the column in place
  // but stop reading/writing it. The UPDATE above preserves any existing notes.
}

// ---------------------------------------------------------------------------
// User-defined filters
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS filters (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

// ---------------------------------------------------------------------------
// Meal plan
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS meal_plan (
    id         TEXT PRIMARY KEY,
    day        TEXT NOT NULL,   -- ISO date YYYY-MM-DD
    recipe_id  TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  );
`);

// ---------------------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS shopping_list (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    qty      TEXT NOT NULL DEFAULT '',
    checked  INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'Other',
    req_base REAL NOT NULL DEFAULT 0,   -- hidden: accumulated required amount, canonical base
    req_dim  TEXT NOT NULL DEFAULT ''   -- hidden: dimension of req_base ('volume'|'weight'|'clove'|'count')
  );
`);

// Idempotent migration: add columns missing from an older shopping_list table.
const shoppingCols = db
  .prepare('PRAGMA table_info(shopping_list)')
  .all()
  .map((r) => r.name);
const shoppingMigrations = [
  { col: 'category', ddl: "TEXT NOT NULL DEFAULT 'Other'" },
  { col: 'req_base', ddl: 'REAL NOT NULL DEFAULT 0' },
  { col: 'req_dim',  ddl: "TEXT NOT NULL DEFAULT ''" },
];
for (const { col, ddl } of shoppingMigrations) {
  if (!shoppingCols.includes(col)) {
    try {
      db.exec(`ALTER TABLE shopping_list ADD COLUMN ${col} ${ddl}`);
    } catch {
      // Column appeared between the PRAGMA read and now — harmless.
    }
  }
}

// ---------------------------------------------------------------------------
// History — log of what was cooked, linked to a Library recipe.
// Multiple entries per day per recipe are allowed (no uniqueness constraint).
// History rows are intentionally NOT cascade-deleted when a recipe is deleted;
// the hydration layer renders recipe: null for orphaned entries.
// ---------------------------------------------------------------------------

// No FOREIGN KEY constraint on recipe_id — history entries intentionally
// survive recipe deletion. The hydration layer renders recipe: null for
// any entry whose recipe_id no longer exists in the recipes table.
db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id          TEXT PRIMARY KEY,
    recipe_id   TEXT NOT NULL,
    date        TEXT NOT NULL,
    rating      INTEGER,
    image       TEXT,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`);

// ---------------------------------------------------------------------------
// Pantry — ingredient inventory grouped by category.
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS pantry (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    qty        TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT 'Other',
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// ---------------------------------------------------------------------------
// Settings — generic key/value store. Currently used for the shopping list's
// persisted store choice (see server/index.js Shopping List section).
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`);

// ---------------------------------------------------------------------------
// Price book — cache of Gemini-estimated grocery prices, keyed by store, ZIP,
// and normalized item name. Backs POST /api/shopping-list/estimate.
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS price_book (
    id         TEXT PRIMARY KEY,
    store      TEXT NOT NULL,             -- normalized store string (see normalizeStore)
    zip        TEXT NOT NULL DEFAULT '',  -- '' when no ZIP, never NULL
    name_key   TEXT NOT NULL,             -- normalized item name (see normalizeName)
    name       TEXT NOT NULL,             -- the item name as it was priced (display only)
    qty_key    TEXT NOT NULL DEFAULT '',  -- the REQUESTED qty, verbatim ('' allowed) — the cache key
    qty_priced TEXT NOT NULL DEFAULT '',  -- the model's ASSUMED/echoed qty — display-only provenance
    unit_price REAL NOT NULL,             -- USD price for buying qty_key/qty_priced of this item
    currency   TEXT NOT NULL DEFAULT 'USD',
    source     TEXT NOT NULL DEFAULT 'ai', -- 'ai' (Gemini estimate) | 'manual' (user-entered)
    updated_at TEXT NOT NULL              -- ISO 8601
  );
`);

// Idempotent column migration: add qty_key to an older price_book table.
// qty_key and qty_priced are deliberately two different columns — qty_key is
// what the shopping-list row actually asked to have priced (verbatim, '' is
// a valid, common value for a manually-added item with no qty), qty_priced
// is what the model says it priced (its own assumption when qty_key was
// blank). Conflating them into one column meant a blank-qty item's cache row
// was stored under the model's assumed qty and could never be found again by
// its own blank qty — it re-priced (a real Gemini call) on every single
// press, forever.
const priceBookCols = db.prepare('PRAGMA table_info(price_book)').all().map((r) => r.name);
if (!priceBookCols.includes('qty_key')) {
  try {
    db.exec("ALTER TABLE price_book ADD COLUMN qty_key TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column appeared between the PRAGMA read and now — harmless.
  }
  // One-time backfill for pre-existing rows: best available approximation is
  // qty_key = qty_priced (the old code effectively assumed the two were the
  // same). This keeps already-correct rows (the common case, where the
  // shopping-list qty was non-blank and the model just echoed it) hitting
  // exactly as before. Rows that were actually blank-qty stay a miss just
  // once more — the very next press re-prices and rewrites them with the
  // correct blank qty_key, self-healing from then on. This must run ONLY
  // here, the one time the column is created — never on every boot, or it
  // would stomp the correct blank qty_key on rows this very fix produces.
  db.exec(`
    UPDATE price_book SET qty_key = qty_priced
    WHERE qty_key = '' AND qty_priced != ''
  `);
}

// Idempotent column migration: add `source` to an older price_book table.
// Distinguishes an AI-estimated price ('ai') from one the user typed in by
// hand ('manual') — see docs/decisions.md "2026-09-03 — Manual prices".
// Backfilling is trivial and needs no UPDATE: SQLite fills every existing
// row with the column's own DEFAULT on ADD COLUMN, and 'ai' is correct for
// every row that predates this feature — manual prices did not exist yet.
const priceBookColsSource = db.prepare('PRAGMA table_info(price_book)').all().map((r) => r.name);
if (!priceBookColsSource.includes('source')) {
  try {
    db.exec("ALTER TABLE price_book ADD COLUMN source TEXT NOT NULL DEFAULT 'ai'");
  } catch {
    // Column appeared between the PRAGMA read and now — harmless.
  }
}

// Idempotent index migration: the unique key has widened twice now —
// originally (store, zip, name_key), then (store, zip, name_key, qty_priced),
// now (store, zip, name_key, qty_key). Both earlier shapes may exist in the
// wild, so detect either and rebuild; `CREATE UNIQUE INDEX IF NOT EXISTS`
// alone won't pick up a column change on an existing DB.
const priceBookIndex = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'price_book_key'")
  .get();
if (priceBookIndex && !/qty_key/.test(priceBookIndex.sql || '')) {
  db.exec('DROP INDEX IF EXISTS price_book_key');
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS price_book_key
    ON price_book (store, zip, name_key, qty_key);
`);

export default db;
