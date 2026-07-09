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
    tags           TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
    filters        TEXT NOT NULL DEFAULT '[]',  -- JSON string[] of assigned user filter labels
    source_url     TEXT,
    source_caption TEXT,
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
    position INTEGER NOT NULL DEFAULT 0
  );
`);

export default db;
