import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { MulterError } from 'multer';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import db from './db.js';

// Load server/.env into process.env (Node >= 20.12). Harmless if absent —
// AI extract just reports CONFIG until GEMINI_API_KEY is set.
try {
  process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)));
} catch { /* no .env file yet */ }

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Multer — store uploaded video to OS temp dir, 200 MB guard.
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

// ===========================================================================
// Helpers
// ===========================================================================

/** Safely JSON-parse a value; return `fallback` on any failure. */
function safeParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed;
  } catch {
    return fallback;
  }
}

/** Turn a DB row into a full recipe API object. */
function rowToRecipe(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    cuisine: row.cuisine ?? '',
    category: row.category ?? '',
    minutes: row.minutes != null ? Number(row.minutes) : null,
    servings: row.servings != null ? Number(row.servings) : null,
    rating: row.rating != null ? Number(row.rating) : null,
    favorite: row.favorite === 1,
    image: row.image ?? null,
    ingredients: safeParse(row.ingredients, []),
    steps: safeParse(row.steps, []),
    tags: safeParse(row.tags, []),
    source_url: row.source_url ?? null,
    source_caption: row.source_caption ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Coerce a request body into clean, storable recipe fields.
 * - ingredients: array of {name, qty} objects; strings or objects are coerced.
 * - tags: array of strings.
 * - minutes/servings: integers (NaN → null).
 * - favorite: boolean → 0/1.
 */
function normalizeBody(body = {}) {
  const toIngredients = (v) => {
    if (!Array.isArray(v)) return [];
    return v
      .map((item) => {
        if (item && typeof item === 'object') {
          return {
            name: String(item.name ?? '').trim(),
            qty: String(item.qty ?? '').trim(),
          };
        }
        // Legacy string item — treat as name only
        const s = String(item).trim();
        return s ? { name: s, qty: '' } : null;
      })
      .filter((item) => item && item.name);
  };

  const toStringArray = (v) =>
    Array.isArray(v)
      ? v.map((s) => String(s).trim()).filter(Boolean)
      : [];

  const toInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  const toFloat = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    title: String(body.title ?? '').trim(),
    description: String(body.description ?? '').trim(),
    cuisine: String(body.cuisine ?? '').trim(),
    category: String(body.category ?? '').trim(),
    minutes: toInt(body.minutes),
    servings: toInt(body.servings),
    rating: toFloat(body.rating),
    favorite: body.favorite ? 1 : 0,
    image: body.image ? String(body.image).trim() : null,
    ingredients: toIngredients(body.ingredients),
    steps: toStringArray(body.steps),
    tags: toStringArray(body.tags),
    source_url: body.source_url ? String(body.source_url).trim() : null,
    source_caption: body.source_caption
      ? String(body.source_caption).trim()
      : null,
  };
}

/**
 * Map an ExtractError code to an HTTP status.
 * Unknown codes fall back to 500.
 */
function extractCodeToStatus(code) {
  switch (code) {
    case 'UNSUPPORTED_URL': return 400;
    case 'NO_RECIPE':       return 422;
    case 'PARSE_FAILED':    return 422;
    case 'FETCH_FAILED':    return 502;
    case 'TIMEOUT':         return 504;
    case 'CONFIG':          return 503;
    default:                return 500;
  }
}

// ===========================================================================
// Health
// ===========================================================================

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ===========================================================================
// Recipes CRUD
// ===========================================================================

// List all recipes (newest first).
app.get('/api/recipes', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM recipes ORDER BY datetime(created_at) DESC')
    .all();
  res.json(rows.map(rowToRecipe));
});

// Get one recipe.
app.get('/api/recipes/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM recipes WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });
  res.json(rowToRecipe(row));
});

// Create a recipe.
app.post('/api/recipes', (req, res) => {
  const data = normalizeBody(req.body);
  if (!data.title) {
    return res.status(400).json({ error: 'title is required' });
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO recipes
       (id, title, description, cuisine, category, minutes, servings, rating,
        favorite, image, ingredients, steps, tags, source_url, source_caption,
        created_at, updated_at)
     VALUES
       (@id, @title, @description, @cuisine, @category, @minutes, @servings,
        @rating, @favorite, @image, @ingredients, @steps, @tags,
        @source_url, @source_caption, @created_at, @updated_at)`
  ).run({
    id,
    ...data,
    ingredients: JSON.stringify(data.ingredients),
    steps: JSON.stringify(data.steps),
    tags: JSON.stringify(data.tags),
    created_at: now,
    updated_at: now,
  });
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
  res.status(201).json(rowToRecipe(row));
});

// Update a recipe.
app.put('/api/recipes/:id', (req, res) => {
  const existing = db
    .prepare('SELECT id FROM recipes WHERE id = ?')
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Recipe not found' });

  const data = normalizeBody(req.body);
  if (!data.title) {
    return res.status(400).json({ error: 'title is required' });
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE recipes SET
       title = @title,
       description = @description,
       cuisine = @cuisine,
       category = @category,
       minutes = @minutes,
       servings = @servings,
       rating = @rating,
       favorite = @favorite,
       image = @image,
       ingredients = @ingredients,
       steps = @steps,
       tags = @tags,
       source_url = @source_url,
       source_caption = @source_caption,
       updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id: req.params.id,
    ...data,
    ingredients: JSON.stringify(data.ingredients),
    steps: JSON.stringify(data.steps),
    tags: JSON.stringify(data.tags),
    updated_at: now,
  });
  const row = db
    .prepare('SELECT * FROM recipes WHERE id = ?')
    .get(req.params.id);
  res.json(rowToRecipe(row));
});

// Delete a recipe (cascades meal-plan entries via explicit DELETE).
app.delete('/api/recipes/:id', (req, res) => {
  const id = req.params.id;
  // Cascade: remove any meal-plan assignments for this recipe.
  db.prepare('DELETE FROM meal_plan WHERE recipe_id = ?').run(id);
  const result = db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  res.status(204).end();
});

// Favorite toggle / set.
app.patch('/api/recipes/:id/favorite', (req, res) => {
  const row = db
    .prepare('SELECT id, favorite FROM recipes WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });

  // If body contains explicit `favorite` boolean, use it; otherwise toggle.
  let newFavorite;
  if (typeof req.body.favorite === 'boolean') {
    newFavorite = req.body.favorite ? 1 : 0;
  } else if (req.body.favorite === 1 || req.body.favorite === 0) {
    newFavorite = req.body.favorite;
  } else {
    newFavorite = row.favorite ? 0 : 1;
  }

  db.prepare('UPDATE recipes SET favorite = ?, updated_at = ? WHERE id = ?').run(
    newFavorite,
    new Date().toISOString(),
    req.params.id
  );
  const updated = db
    .prepare('SELECT * FROM recipes WHERE id = ?')
    .get(req.params.id);
  res.json(rowToRecipe(updated));
});

// ===========================================================================
// Meal Plan
// ===========================================================================

/**
 * Return the Monday–Sunday ISO dates for the week containing `date`.
 */
function currentWeekDays(date = new Date()) {
  const dow = date.getDay(); // 0=Sun,1=Mon,...6=Sat
  const diffToMon = (dow === 0 ? -6 : 1 - dow);
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMon);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    // Build YYYY-MM-DD from LOCAL components (must match the client's
    // toISODate in client/src/utils/week.js). Using toISOString() here would
    // use UTC and drift a day in negative-offset timezones.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${day}`);
  }
  return days;
}

// GET /api/meal-plan — current Mon–Sun, hydrated with recipe minimal fields.
app.get('/api/meal-plan', (_req, res) => {
  const days = currentWeekDays();

  // Fetch all meal-plan rows for this week, joined to minimal recipe fields.
  const rows = db
    .prepare(
      `SELECT mp.id, mp.day, mp.recipe_id, mp.position,
              r.title, r.image, r.minutes, r.cuisine
       FROM meal_plan mp
       LEFT JOIN recipes r ON mp.recipe_id = r.id
       WHERE mp.day >= ? AND mp.day <= ?
       ORDER BY mp.day, mp.position`
    )
    .all(days[0], days[6]);

  // Build a map keyed by ISO date; every day in the week is present.
  const plan = {};
  for (const day of days) {
    plan[day] = [];
  }
  for (const row of rows) {
    if (!plan[row.day]) plan[row.day] = [];
    plan[row.day].push({
      id: row.id,
      recipe_id: row.recipe_id,
      position: row.position,
      recipe: row.title
        ? {
            id: row.recipe_id,
            title: row.title,
            image: row.image ?? null,
            minutes: row.minutes != null ? Number(row.minutes) : null,
            cuisine: row.cuisine ?? '',
          }
        : null, // recipe was deleted
    });
  }

  res.json({ week: days, plan });
});

// POST /api/meal-plan — assign a recipe to a day.
app.post('/api/meal-plan', (req, res) => {
  const { day, recipe_id } = req.body ?? {};
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return res
      .status(400)
      .json({ error: 'day is required and must be YYYY-MM-DD' });
  }
  if (!recipe_id) {
    return res.status(400).json({ error: 'recipe_id is required' });
  }
  const recipe = db
    .prepare('SELECT id FROM recipes WHERE id = ?')
    .get(recipe_id);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

  // position = max existing position for this day + 1
  const maxPos = db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) as mp FROM meal_plan WHERE day = ?'
    )
    .get(day);
  const position = (maxPos?.mp ?? -1) + 1;

  const id = randomUUID();
  db.prepare(
    'INSERT INTO meal_plan (id, day, recipe_id, position) VALUES (?, ?, ?, ?)'
  ).run(id, day, recipe_id, position);

  // Return the created entry with hydrated recipe stub
  const row = db
    .prepare(
      `SELECT mp.id, mp.day, mp.recipe_id, mp.position,
              r.title, r.image, r.minutes, r.cuisine
       FROM meal_plan mp
       LEFT JOIN recipes r ON mp.recipe_id = r.id
       WHERE mp.id = ?`
    )
    .get(id);

  res.status(201).json({
    id: row.id,
    day: row.day,
    recipe_id: row.recipe_id,
    position: row.position,
    recipe: row.title
      ? {
          id: row.recipe_id,
          title: row.title,
          image: row.image ?? null,
          minutes: row.minutes != null ? Number(row.minutes) : null,
          cuisine: row.cuisine ?? '',
        }
      : null,
  });
});

// DELETE /api/meal-plan/:id — remove a single meal-plan assignment.
app.delete('/api/meal-plan/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM meal_plan WHERE id = ?')
    .run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Meal plan entry not found' });
  }
  res.status(204).end();
});

// ===========================================================================
// Shopping List
// ===========================================================================

function rowToShoppingItem(row) {
  return {
    id: row.id,
    name: row.name,
    qty: row.qty ?? '',
    checked: row.checked === 1,
    position: row.position,
  };
}

// GET /api/shopping-list
app.get('/api/shopping-list', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM shopping_list ORDER BY position, rowid')
    .all();
  res.json(rows.map(rowToShoppingItem));
});

// POST /api/shopping-list — add one item.
app.post('/api/shopping-list', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const qty = String(req.body?.qty ?? '').trim();
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) as mp FROM shopping_list')
    .get();
  const position = (maxPos?.mp ?? -1) + 1;

  const id = randomUUID();
  db.prepare(
    'INSERT INTO shopping_list (id, name, qty, checked, position) VALUES (?, ?, ?, 0, ?)'
  ).run(id, name, qty, position);

  const row = db
    .prepare('SELECT * FROM shopping_list WHERE id = ?')
    .get(id);
  res.status(201).json(rowToShoppingItem(row));
});

// POST /api/shopping-list/from-recipe/:recipeId
// Append a recipe's ingredients, de-duped by case-insensitive name.
app.post('/api/shopping-list/from-recipe/:recipeId', (req, res) => {
  const recipe = db
    .prepare('SELECT ingredients FROM recipes WHERE id = ?')
    .get(req.params.recipeId);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

  const recipeIngredients = safeParse(recipe.ingredients, []);

  // Fetch existing names (lowercase) for de-dupe check.
  const existingRows = db
    .prepare('SELECT name FROM shopping_list')
    .all();
  const existingNames = new Set(existingRows.map((r) => r.name.toLowerCase()));

  // Get current max position
  let maxPos = (
    db
      .prepare('SELECT COALESCE(MAX(position), -1) as mp FROM shopping_list')
      .get()?.mp ?? -1
  );

  const added = [];
  const insertStmt = db.prepare(
    'INSERT INTO shopping_list (id, name, qty, checked, position) VALUES (?, ?, ?, 0, ?)'
  );
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insertStmt.run(item.id, item.name, item.qty, item.position);
      added.push(item);
    }
  });

  const toInsert = [];
  for (const ing of recipeIngredients) {
    const nameLower = (ing.name ?? '').toLowerCase();
    if (!nameLower || existingNames.has(nameLower)) continue;
    existingNames.add(nameLower); // guard against duplicates within the same recipe
    maxPos += 1;
    toInsert.push({
      id: randomUUID(),
      name: ing.name,
      qty: ing.qty ?? '',
      position: maxPos,
    });
  }
  insertMany(toInsert);

  // Return all newly added items
  const addedItems = added.map((item) =>
    rowToShoppingItem(
      db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(item.id)
    )
  );
  res.status(201).json({ added: addedItems, skipped: recipeIngredients.length - added.length });
});

// PATCH /api/shopping-list/:id — toggle checked or update name/qty.
app.patch('/api/shopping-list/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM shopping_list WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Shopping list item not found' });

  const body = req.body ?? {};
  // If body includes `checked`, set it explicitly; otherwise toggle.
  let newChecked;
  if (typeof body.checked === 'boolean') {
    newChecked = body.checked ? 1 : 0;
  } else if (body.checked === 1 || body.checked === 0) {
    newChecked = body.checked;
  } else if ('checked' in body) {
    newChecked = body.checked ? 1 : 0;
  } else {
    newChecked = row.checked ? 0 : 1; // toggle
  }

  const newName = 'name' in body ? String(body.name ?? '').trim() || row.name : row.name;
  const newQty  = 'qty'  in body ? String(body.qty  ?? '').trim()            : row.qty;

  db.prepare(
    'UPDATE shopping_list SET name = ?, qty = ?, checked = ? WHERE id = ?'
  ).run(newName, newQty, newChecked, req.params.id);

  const updated = db
    .prepare('SELECT * FROM shopping_list WHERE id = ?')
    .get(req.params.id);
  res.json(rowToShoppingItem(updated));
});

// DELETE /api/shopping-list/:id
app.delete('/api/shopping-list/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM shopping_list WHERE id = ?')
    .run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Shopping list item not found' });
  }
  res.status(204).end();
});

// POST /api/shopping-list/clear-checked
app.post('/api/shopping-list/clear-checked', (_req, res) => {
  const result = db
    .prepare('DELETE FROM shopping_list WHERE checked = 1')
    .run();
  res.json({ deleted: result.changes });
});

// ===========================================================================
// AI Extract
// ===========================================================================

/**
 * Lazy-load the extract module. If the module (or its deps) are unavailable,
 * the import rejects and we return 503 with EXTRACT_UNAVAILABLE so CRUD routes
 * keep working without a valid Gemini key.
 */
async function getExtractModule() {
  try {
    return await import('./extract/index.js');
  } catch (err) {
    console.error('[extract] Module unavailable:', err.message);
    return null;
  }
}

// POST /api/extract — Path B: extract from a URL.
app.post('/api/extract', async (req, res) => {
  const { url } = req.body ?? {};
  if (!url) {
    return res.status(400).json({ error: 'url is required', code: 'UNSUPPORTED_URL' });
  }

  const mod = await getExtractModule();
  if (!mod) {
    return res.status(503).json({
      error: 'Extraction service is not configured on this server.',
      code: 'EXTRACT_UNAVAILABLE',
    });
  }

  try {
    const draft = await mod.extractFromUrl(url);
    res.json(draft);
  } catch (err) {
    if (err.code && err.userMessage) {
      // ExtractError — log the real underlying reason (e.g. yt-dlp stderr) so
      // it's diagnosable; the client only gets the friendly userMessage.
      console.warn(`[extract/url] ${err.code}: ${err.message}`);
      return res.status(extractCodeToStatus(err.code)).json({
        error: err.userMessage,
        code: err.code,
      });
    }
    console.error('[extract/url] Unexpected error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// POST /api/extract/upload — Path A: extract from an uploaded video file.
app.post(
  '/api/extract/upload',
  upload.single('video'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded.', code: 'UNSUPPORTED_URL' });
    }

    const mod = await getExtractModule();
    if (!mod) {
      // Clean up the temp file before responding.
      await unlink(req.file.path).catch(() => {});
      return res.status(503).json({
        error: 'Extraction service is not configured on this server.',
        code: 'EXTRACT_UNAVAILABLE',
      });
    }

    const tempPath = req.file.path;
    const mimeType = req.file.mimetype || 'video/mp4';

    try {
      const draft = await mod.extractFromFile(tempPath, mimeType);
      res.json(draft);
    } catch (err) {
      if (err.code && err.userMessage) {
        console.warn(`[extract/upload] ${err.code}: ${err.message}`);
        return res.status(extractCodeToStatus(err.code)).json({
          error: err.userMessage,
          code: err.code,
        });
      }
      console.error('[extract/upload] Unexpected error:', err);
      res.status(500).json({ error: 'An unexpected error occurred.' });
    } finally {
      // Always clean up the temp file.
      await unlink(tempPath).catch(() => {});
    }
  }
);

// POST /api/extract-and-save — one-shot: extract a recipe from an IG/TikTok URL
// AND save it, returning the created recipe. Used by the iOS "Add to Cookbook"
// share Shortcut (fire-and-forget from the Instagram/TikTok share sheet — no
// review step). The regular two-step flow (/api/extract → edit → POST /api/recipes)
// is unchanged.
app.post('/api/extract-and-save', async (req, res) => {
  const { url } = req.body ?? {};
  if (!url) {
    return res.status(400).json({ error: 'url is required', code: 'UNSUPPORTED_URL' });
  }

  const mod = await getExtractModule();
  if (!mod) {
    return res.status(503).json({
      error: 'Extraction service is not configured on this server.',
      code: 'EXTRACT_UNAVAILABLE',
    });
  }

  try {
    const draft = await mod.extractFromUrl(url);
    const data = normalizeBody({ ...draft, source_url: url });
    if (!data.title) data.title = 'Imported recipe';

    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO recipes
         (id, title, description, cuisine, category, minutes, servings, rating,
          favorite, image, ingredients, steps, tags, source_url, source_caption,
          created_at, updated_at)
       VALUES
         (@id, @title, @description, @cuisine, @category, @minutes, @servings,
          @rating, @favorite, @image, @ingredients, @steps, @tags,
          @source_url, @source_caption, @created_at, @updated_at)`
    ).run({
      id,
      ...data,
      ingredients: JSON.stringify(data.ingredients),
      steps: JSON.stringify(data.steps),
      tags: JSON.stringify(data.tags),
      created_at: now,
      updated_at: now,
    });
    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    res.status(201).json(rowToRecipe(row));
  } catch (err) {
    if (err.code && err.userMessage) {
      console.warn(`[extract-and-save] ${err.code}: ${err.message}`);
      return res.status(extractCodeToStatus(err.code)).json({
        error: err.userMessage,
        code: err.code,
      });
    }
    console.error('[extract-and-save] Unexpected error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// ===========================================================================
// Serve the built frontend (single-process production mode)
// ===========================================================================

// When client/dist exists (i.e. after `npm run build` in client/), serve the
// whole app from this one server so a single always-on process runs everything.
// In dev there's no dist and the Vite dev server handles the UI instead.
const clientDist = fileURLToPath(new URL('../client/dist', import.meta.url));
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-API GET returns index.html.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(clientDist, 'index.html'));
  });
}

// ===========================================================================
// Error handling
// ===========================================================================

/**
 * Central error handler. Maps multer upload errors to clean JSON status codes
 * (notably the 200 MB file-size guard → 413) and prevents Express's default
 * HTML stack-trace page from leaking internal file paths to the client.
 */
// eslint-disable-next-line no-unused-vars -- Express requires the 4-arg signature.
app.use((err, req, res, next) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'That video is too large. The limit is 200 MB — upload a shorter clip.',
        code: 'FETCH_FAILED',
      });
    }
    return res.status(400).json({ error: 'Upload failed.', code: 'FETCH_FAILED' });
  }
  console.error('[error] Unhandled:', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

// ===========================================================================
// Start
// ===========================================================================

app.listen(PORT, () => {
  const servesApp = existsSync(clientDist);
  console.log(
    servesApp
      ? `Cookbook running on http://localhost:${PORT} (API + app)`
      : `Cookbook API listening on http://localhost:${PORT} (run "npm run build" in client/ to serve the app too)`,
  );
});
