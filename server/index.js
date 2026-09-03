import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { MulterError } from 'multer';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
  copyFileSync,
  createReadStream,
} from 'node:fs';
import db from './db.js';
import { toStoreQuantity, parseRequired, computeBuyAmount, isBumpable } from './storeQty.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// Multer — receipt photos for the Pantry import. Much smaller than videos, and
// restricted to images so a stray video upload fails fast instead of burning a
// Gemini call. HEIC/HEIF are included: that is what an iPhone camera produces.
const RECEIPT_MAX_BYTES = 12 * 1024 * 1024; // 12 MB — matches extract/receipt.js
const uploadImage = multer({
  dest: tmpdir(),
  limits: { fileSize: RECEIPT_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//i.test(file.mimetype) ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(file.originalname ?? '');
    if (ok) return cb(null, true);
    cb(new MulterError('LIMIT_UNEXPECTED_FILE', 'receipt'));
  },
});

// ===========================================================================
// Video media storage (Cook Mode) — server/media/<recipeId>.mp4, drafts at
// server/media/drafts/<token>.mp4 until a recipe is saved and claims one.
// ===========================================================================

const MEDIA_DIR = join(__dirname, 'media');
const DRAFTS_DIR = join(MEDIA_DIR, 'drafts');
mkdirSync(DRAFTS_DIR, { recursive: true });

/** Sweep draft videos older than 24h. Simple, synchronous, logged; runs once at boot. */
function sweepStaleDrafts() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = readdirSync(DRAFTS_DIR);
  } catch (err) {
    console.warn('[media] Could not read drafts dir:', err.message);
    return;
  }
  let swept = 0;
  for (const name of entries) {
    const p = join(DRAFTS_DIR, name);
    try {
      const st = statSync(p);
      if (st.mtimeMs < cutoff) {
        unlinkSync(p);
        swept += 1;
      }
    } catch (err) {
      console.warn(`[media] Could not sweep draft ${name}:`, err.message);
    }
  }
  if (swept > 0) console.log(`[media] Swept ${swept} stale draft video(s).`);
}
sweepStaleDrafts();

// Backfill shopping-list rows still at the default 'Other' (older rows from
// before the category column). Only touches 'Other' rows, so a category a user
// explicitly chose in the add dialog is never overwritten.
try {
  const rows = db.prepare("SELECT id, name FROM shopping_list WHERE category = 'Other'").all();
  if (rows.length) {
    const upd = db.prepare('UPDATE shopping_list SET category = ? WHERE id = ?');
    db.transaction((list) => {
      for (const r of list) {
        const c = guessCategory(r.name);
        if (c !== 'Other') upd.run(c, r.id);
      }
    })(rows);
  }
} catch (err) {
  console.warn('[shopping] category backfill failed:', err.message);
}

/** Move (rename, falling back to copy+unlink across devices) src to dest. */
function moveFile(srcPath, destPath) {
  try {
    renameSync(srcPath, destPath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      copyFileSync(srcPath, destPath);
      unlinkSync(srcPath);
    } else {
      throw err;
    }
  }
}

/** A draft token must look like a UUID — defends the drafts dir against path traversal. */
function isValidToken(token) {
  return typeof token === 'string' && /^[a-zA-Z0-9-]+$/.test(token);
}

/**
 * Claim a draft video (server/media/drafts/<token>.mp4) for a newly-created
 * recipe, moving it to server/media/<recipeId>.mp4. Returns the bare filename
 * to store in `video_file`, or null if the token is missing/invalid/the draft
 * no longer exists. Never throws — a missing video must never block a save.
 */
function claimDraftVideo(token, recipeId) {
  if (!isValidToken(token)) return null;
  const draftPath = join(DRAFTS_DIR, `${token}.mp4`);
  if (!existsSync(draftPath)) return null;
  const finalName = `${recipeId}.mp4`;
  try {
    moveFile(draftPath, join(MEDIA_DIR, finalName));
    return finalName;
  } catch (err) {
    console.warn(`[media] Could not claim draft video ${token}:`, err.message);
    return null;
  }
}

/** Delete an orphaned draft video (e.g. the dedupe guard fired, so no recipe claimed it). */
function discardDraftVideo(token) {
  if (!isValidToken(token)) return;
  try {
    unlinkSync(join(DRAFTS_DIR, `${token}.mp4`));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[media] Could not discard draft video ${token}:`, err.message);
    }
  }
}

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
    protein: safeParse(row.protein, []),
    carb: safeParse(row.carb, []),
    minutes: row.minutes != null ? Number(row.minutes) : null,
    servings: row.servings != null ? Number(row.servings) : null,
    rating: row.rating != null ? Number(row.rating) : null,
    favorite: row.favorite === 1,
    image: row.image ?? null,
    ingredients: safeParse(row.ingredients, []),
    steps: safeParse(row.steps, []),
    step_times: safeParse(row.step_times, []),
    tags: safeParse(row.tags, []),
    filters: safeParse(row.filters, []),
    source_url: row.source_url ?? null,
    source_caption: row.source_caption ?? null,
    has_video: Boolean(row.video_file),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Coerce a request body into clean, storable recipe fields.
 * - ingredients: array of {name, qty} objects; strings or objects are coerced.
 * - tags: array of strings.
 * - step_times: array of finite non-negative numbers (garbage dropped), positionally
 *   parallel to steps; may be shorter or [].
 * - minutes/servings: integers (NaN → null).
 * - favorite: boolean → 0/1.
 *
 * NOTE: `video_token` (write-only) is deliberately NOT read/returned here — it
 * is not a persisted column. Route handlers read `body.video_token` directly
 * and resolve it via claimDraftVideo()/discardDraftVideo().
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

  // step_times: array of finite non-negative numbers; garbage entries are
  // dropped (not coerced to 0), default [].
  const toStepTimes = (v) => {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const item of v) {
      const n = typeof item === 'number' ? item : parseFloat(item);
      if (Number.isFinite(n) && n >= 0) out.push(n);
    }
    return out;
  };

  // Like toStringArray, but also accepts a single string ("Chicken" -> ["Chicken"]).
  const toStrArr = (v) =>
    Array.isArray(v)
      ? v.map((s) => String(s).trim()).filter(Boolean)
      : (typeof v === 'string' && v.trim() ? [v.trim()] : []);

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
    protein: toStrArr(body.protein),
    carb: toStrArr(body.carb),
    minutes: toInt(body.minutes),
    servings: toInt(body.servings),
    rating: toFloat(body.rating),
    favorite: body.favorite ? 1 : 0,
    image: body.image ? String(body.image).trim() : null,
    ingredients: toIngredients(body.ingredients),
    steps: toStringArray(body.steps),
    step_times: toStepTimes(body.step_times),
    tags: toStringArray(body.tags),
    filters: toStringArray(body.filters),
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
    case 'RATE_LIMITED':    return 429;
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
  const videoToken = req.body?.video_token ? String(req.body.video_token).trim() : null;
  if (!data.title) {
    return res.status(400).json({ error: 'title is required' });
  }
  // Defense in depth against duplicate saves: if this is an import with a
  // source_url, and an identical-source recipe was created in the last 60
  // seconds, treat this as a repeated click / retry rather than a new save.
  // Manual entries (null/empty source_url) are never deduped. Deliberate
  // re-imports outside the recency window still create a new recipe.
  if (typeof data.source_url === 'string' && data.source_url.trim() !== '') {
    const recentCutoff = new Date(Date.now() - 60_000).toISOString();
    const existing = db
      .prepare(
        `SELECT * FROM recipes
         WHERE source_url = ? AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(data.source_url, recentCutoff);
    if (existing) {
      // The recipe already exists — this token would otherwise orphan.
      if (videoToken) discardDraftVideo(videoToken);
      return res.status(200).json(rowToRecipe(existing));
    }
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  const videoFile = videoToken ? claimDraftVideo(videoToken, id) : null;
  db.prepare(
    `INSERT INTO recipes
       (id, title, description, cuisine, category, protein, carb, minutes, servings, rating,
        favorite, image, ingredients, steps, step_times, tags, filters, source_url, source_caption,
        video_file, created_at, updated_at)
     VALUES
       (@id, @title, @description, @cuisine, @category, @protein, @carb, @minutes, @servings,
        @rating, @favorite, @image, @ingredients, @steps, @step_times, @tags, @filters,
        @source_url, @source_caption, @video_file, @created_at, @updated_at)`
  ).run({
    id,
    ...data,
    ingredients: JSON.stringify(data.ingredients),
    steps: JSON.stringify(data.steps),
    step_times: JSON.stringify(data.step_times),
    tags: JSON.stringify(data.tags),
    filters: JSON.stringify(data.filters),
    protein: JSON.stringify(data.protein),
    carb: JSON.stringify(data.carb),
    video_file: videoFile,
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
       protein = @protein,
       carb = @carb,
       minutes = @minutes,
       servings = @servings,
       rating = @rating,
       favorite = @favorite,
       image = @image,
       ingredients = @ingredients,
       steps = @steps,
       step_times = @step_times,
       tags = @tags,
       filters = @filters,
       source_url = @source_url,
       source_caption = @source_caption,
       updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id: req.params.id,
    ...data,
    ingredients: JSON.stringify(data.ingredients),
    steps: JSON.stringify(data.steps),
    step_times: JSON.stringify(data.step_times),
    tags: JSON.stringify(data.tags),
    filters: JSON.stringify(data.filters),
    protein: JSON.stringify(data.protein),
    carb: JSON.stringify(data.carb),
    updated_at: now,
  });
  const row = db
    .prepare('SELECT * FROM recipes WHERE id = ?')
    .get(req.params.id);
  res.json(rowToRecipe(row));
});

// Delete a recipe (cascades meal-plan entries via explicit DELETE; also
// removes its video file, if any).
app.delete('/api/recipes/:id', (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT video_file FROM recipes WHERE id = ?').get(id);
  // Cascade: remove any meal-plan assignments for this recipe.
  db.prepare('DELETE FROM meal_plan WHERE recipe_id = ?').run(id);
  const result = db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  if (row?.video_file) {
    unlink(join(MEDIA_DIR, row.video_file)).catch((err) => {
      if (err.code !== 'ENOENT') {
        console.warn(`[media] Could not delete video for ${id}:`, err.message);
      }
    });
  }
  res.status(204).end();
});

// Stream a recipe's source video (Cook Mode video pane). Supports HTTP Range
// so <video> can seek — required for per-step timestamp scrubbing.
app.get('/api/recipes/:id/video', (req, res) => {
  const row = db.prepare('SELECT video_file FROM recipes WHERE id = ?').get(req.params.id);
  if (!row || !row.video_file) {
    return res.status(404).json({ error: 'no video' });
  }

  const videoPath = join(MEDIA_DIR, row.video_file);
  let stat;
  try {
    stat = statSync(videoPath);
  } catch {
    return res.status(404).json({ error: 'no video' });
  }
  const total = stat.size;

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(videoPath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (match[1] === '' && match[2] === '')) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` });
    return res.end();
  }

  let start, end;
  if (match[1] === '') {
    // Suffix range: "bytes=-500" → last 500 bytes (clamped to the file size).
    const suffixLength = parseInt(match[2], 10);
    end = total - 1;
    start = Math.max(0, total - suffixLength);
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === '' ? total - 1 : parseInt(match[2], 10);
  }

  if (
    !Number.isFinite(start) || !Number.isFinite(end) ||
    start < 0 || end >= total || start > end
  ) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` });
    return res.end();
  }

  const chunkSize = end - start + 1;
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': 'video/mp4',
  });
  createReadStream(videoPath, { start, end }).pipe(res);
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
// Filters CRUD
// ===========================================================================

/** Turn a DB row into a filter API object. */
function rowToFilter(row) {
  return {
    id:         row.id,
    label:      row.label,
    position:   row.position,
    created_at: row.created_at,
  };
}

// GET /api/filters — all filters ordered by position, then created_at.
app.get('/api/filters', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM filters ORDER BY position ASC, created_at ASC')
    .all();
  res.json(rows.map(rowToFilter));
});

// POST /api/filters — create a filter.
app.post('/api/filters', (req, res) => {
  const label = String(req.body?.label ?? '').trim();
  if (!label) return res.status(400).json({ error: 'label is required' });

  // Case-insensitive duplicate check — return existing rather than inserting.
  const existing = db
    .prepare('SELECT * FROM filters WHERE lower(label) = lower(?)')
    .get(label);
  if (existing) return res.json(rowToFilter(existing));

  // position = max existing position + 1 (or 0 if table is empty).
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) as mp FROM filters')
    .get();
  const position = (maxPos?.mp ?? -1) + 1;

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO filters (id, label, position, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, label, position, now);

  const row = db.prepare('SELECT * FROM filters WHERE id = ?').get(id);
  res.status(201).json(rowToFilter(row));
});

// PATCH /api/filters/:id — rename a filter; cascades into recipe.filters arrays.
app.patch('/api/filters/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM filters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Filter not found' });

  const newLabel = String(req.body?.label ?? '').trim();
  if (!newLabel) return res.status(400).json({ error: 'label is required' });

  // If label unchanged (case-insensitive) just return the current filter.
  if (newLabel.toLowerCase() === row.label.toLowerCase()) {
    // Still apply the exact casing from the request if it differs.
    db.prepare('UPDATE filters SET label = ? WHERE id = ?').run(newLabel, row.id);
    const updated = db.prepare('SELECT * FROM filters WHERE id = ?').get(row.id);
    return res.json(rowToFilter(updated));
  }

  const oldLabel = row.label;

  // Cascade: update every recipe whose filters array contains the old label.
  const recipesToUpdate = db
    .prepare("SELECT id, filters FROM recipes WHERE filters != '[]'")
    .all();

  const updateRecipeFilters = db.prepare(
    'UPDATE recipes SET filters = ?, updated_at = ? WHERE id = ?'
  );
  const now = new Date().toISOString();

  const cascade = db.transaction(() => {
    db.prepare('UPDATE filters SET label = ? WHERE id = ?').run(newLabel, row.id);
    for (const r of recipesToUpdate) {
      const arr = safeParse(r.filters, []);
      const oldLower = oldLabel.toLowerCase();
      if (!arr.some((l) => l.toLowerCase() === oldLower)) continue;
      const updated = arr.map((l) =>
        l.toLowerCase() === oldLower ? newLabel : l
      );
      updateRecipeFilters.run(JSON.stringify(updated), now, r.id);
    }
  });
  cascade();

  const updated = db.prepare('SELECT * FROM filters WHERE id = ?').get(row.id);
  res.json(rowToFilter(updated));
});

// DELETE /api/filters/:id — delete a filter; cascades removal from recipe.filters arrays.
app.delete('/api/filters/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM filters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Filter not found' });

  const label = row.label;

  const recipesToUpdate = db
    .prepare("SELECT id, filters FROM recipes WHERE filters != '[]'")
    .all();

  const updateRecipeFilters = db.prepare(
    'UPDATE recipes SET filters = ?, updated_at = ? WHERE id = ?'
  );
  const now = new Date().toISOString();
  const labelLower = label.toLowerCase();

  const cascade = db.transaction(() => {
    db.prepare('DELETE FROM filters WHERE id = ?').run(row.id);
    for (const r of recipesToUpdate) {
      const arr = safeParse(r.filters, []);
      if (!arr.some((l) => l.toLowerCase() === labelLower)) continue;
      const filtered = arr.filter((l) => l.toLowerCase() !== labelLower);
      updateRecipeFilters.run(JSON.stringify(filtered), now, r.id);
    }
  });
  cascade();

  res.status(204).end();
});

// PUT /api/filters/order — reorder filters by providing an ordered array of ids.
// NOTE: this route must be registered before /api/filters/:id so Express matches
// the literal "order" path segment, not the :id param.
app.put('/api/filters/order', (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'ids must be an array' });
  }

  const update = db.prepare('UPDATE filters SET position = ? WHERE id = ?');
  const reorder = db.transaction(() => {
    for (let i = 0; i < ids.length; i++) {
      update.run(i, ids[i]);
    }
  });
  reorder();

  const rows = db
    .prepare('SELECT * FROM filters ORDER BY position ASC, created_at ASC')
    .all();
  res.json(rows.map(rowToFilter));
});

// ===========================================================================
// Recipe filter assignment endpoints
// ===========================================================================

// POST /api/recipes/assign-all — AI-assign filters for every recipe.
// NOTE: must be registered before /api/recipes/:id to avoid param capture.
app.post('/api/recipes/assign-all', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'Server is not configured for AI extraction. Set GEMINI_API_KEY in server/.env.',
      code: 'CONFIG',
    });
  }

  const mod = await getExtractModule();
  if (!mod) {
    return res.status(503).json({
      error: 'Extraction service is not configured on this server.',
      code: 'EXTRACT_UNAVAILABLE',
    });
  }

  const filterRows = db
    .prepare('SELECT label FROM filters ORDER BY position ASC, created_at ASC')
    .all();
  const filterLabels = filterRows.map((r) => r.label);

  const recipes = db.prepare('SELECT * FROM recipes').all();
  const updateStmt = db.prepare(
    'UPDATE recipes SET filters = ?, updated_at = ? WHERE id = ?'
  );
  const now = new Date().toISOString();

  let updated = 0;
  for (const recipeRow of recipes) {
    const recipe = rowToRecipe(recipeRow);
    try {
      const assigned = await mod.assignFilters(recipe, filterLabels);
      updateStmt.run(JSON.stringify(assigned), now, recipe.id);
      updated += 1;
    } catch (err) {
      // Log but continue to next recipe.
      console.warn(`[assign-all] assignFilters failed for ${recipe.id}:`, err.message);
    }
  }

  res.json({ updated });
});

// POST /api/recipes/:id/frames — re-download a recipe's source video and return
// candidate JPEG frames so the user can choose a new cover photo.
// No AI call — ffmpeg only. Requires the recipe to have a source_url.
app.post('/api/recipes/:id/frames', async (req, res) => {
  const row = db
    .prepare('SELECT id, source_url FROM recipes WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });

  if (!row.source_url) {
    return res.status(422).json({
      error: 'This recipe has no source video to grab frames from. Upload a photo instead.',
      code: 'NO_SOURCE',
    });
  }

  const mod = await getExtractModule();
  if (!mod) {
    return res.status(503).json({
      error: 'Extraction service is not configured on this server.',
      code: 'EXTRACT_UNAVAILABLE',
    });
  }

  try {
    const candidates = await mod.getCandidateFramesFromUrl(row.source_url);
    res.json({ candidates });
  } catch (err) {
    if (err.code && err.userMessage) {
      console.warn(`[frames] ${err.code}: ${err.message}`);
      return res.status(extractCodeToStatus(err.code)).json({
        error: err.userMessage,
        code: err.code,
      });
    }
    console.error('[frames] Unexpected error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// POST /api/recipes/:id/assign-filters — AI-assign filters for a single recipe.
app.post('/api/recipes/:id/assign-filters', async (req, res) => {
  const recipeRow = db
    .prepare('SELECT * FROM recipes WHERE id = ?')
    .get(req.params.id);
  if (!recipeRow) return res.status(404).json({ error: 'Recipe not found' });

  const mod = await getExtractModule();
  if (!mod) {
    return res.status(503).json({
      error: 'Extraction service is not configured on this server.',
      code: 'EXTRACT_UNAVAILABLE',
    });
  }

  const filterRows = db
    .prepare('SELECT label FROM filters ORDER BY position ASC, created_at ASC')
    .all();
  const filterLabels = filterRows.map((r) => r.label);
  const recipe = rowToRecipe(recipeRow);

  try {
    const assigned = await mod.assignFilters(recipe, filterLabels);
    const now = new Date().toISOString();
    db.prepare('UPDATE recipes SET filters = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(assigned),
      now,
      recipe.id,
    );
    const updated = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipe.id);
    res.json(rowToRecipe(updated));
  } catch (err) {
    if (err.code && err.userMessage) {
      console.warn(`[assign-filters] ${err.code}: ${err.message}`);
      return res.status(extractCodeToStatus(err.code)).json({
        error: err.userMessage,
        code: err.code,
      });
    }
    console.error('[assign-filters] Unexpected error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// ===========================================================================
// Meal Plan
// ===========================================================================

// Build YYYY-MM-DD from LOCAL components (must match the client's
// toISODate in client/src/utils/week.js). Using toISOString() here would
// use UTC and drift a day in negative-offset timezones.
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse a YYYY-MM-DD string into a local Date (avoids the UTC-midnight
// parsing of `new Date('YYYY-MM-DD')`, which drifts a day in negative
// offsets — same reasoning as toISODate above).
function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Every ISO date from `startISO` to `endISO`, inclusive, ascending.
 */
function datesInRange(startISO, endISO) {
  const start = parseLocalDate(startISO);
  const end = parseLocalDate(endISO);
  const days = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(toISODate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/**
 * The calendar-grid range for the month containing `date`: the Monday
 * on/before the 1st of the month, through the Sunday on/after the last day.
 */
function monthGridRange(date = new Date()) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);

  const firstDow = first.getDay(); // 0=Sun,1=Mon,...6=Sat
  const diffToMon = firstDow === 0 ? -6 : 1 - firstDow;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() + diffToMon);

  const lastDow = last.getDay();
  const diffToSun = lastDow === 0 ? 0 : 7 - lastDow;
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + diffToSun);

  return { start: toISODate(gridStart), end: toISODate(gridEnd) };
}

const MAX_MEAL_PLAN_RANGE_DAYS = 62;

// GET /api/meal-plan — a date range (via ?start=&end=), or the current
// month's calendar grid by default, hydrated with recipe minimal fields.
app.get('/api/meal-plan', (req, res) => {
  const { start: qStart, end: qEnd } = req.query;

  let start, end;
  if (qStart || qEnd) {
    if (!qStart || !qEnd) {
      return res
        .status(400)
        .json({ error: 'start and end must both be provided, or neither' });
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(qStart) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(qEnd)
    ) {
      return res
        .status(400)
        .json({ error: 'start and end must be YYYY-MM-DD' });
    }
    if (qEnd < qStart) {
      return res.status(400).json({ error: 'end must not be before start' });
    }
    start = qStart;
    end = qEnd;
  } else {
    ({ start, end } = monthGridRange());
  }

  // Enforce the cap arithmetically from the two parsed local dates BEFORE
  // materializing the day list, so a huge user-supplied range can't drive
  // unbounded work/allocation. Math.round absorbs the ±1h DST drift so the
  // inclusive count stays exact across a spring-forward/fall-back boundary.
  const dayCount =
    Math.round((parseLocalDate(end) - parseLocalDate(start)) / 86400000) + 1;
  if (dayCount > MAX_MEAL_PLAN_RANGE_DAYS) {
    return res
      .status(400)
      .json({ error: `range must be at most ${MAX_MEAL_PLAN_RANGE_DAYS} days` });
  }

  const days = datesInRange(start, end);

  // Fetch all meal-plan rows in range, joined to minimal recipe fields.
  const rows = db
    .prepare(
      `SELECT mp.id, mp.day, mp.recipe_id, mp.position,
              r.title, r.image, r.minutes, r.cuisine
       FROM meal_plan mp
       LEFT JOIN recipes r ON mp.recipe_id = r.id
       WHERE mp.day >= ? AND mp.day <= ?
       ORDER BY mp.day, mp.position`
    )
    .all(start, end);

  // Build a map keyed by ISO date; every day in the range is present.
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

  res.json({ start, end, days, plan });
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
    category: row.category ?? 'Other',
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

  // Use the caller's explicit category if given; otherwise classify by name.
  const providedCategory = String(req.body?.category ?? '').trim();
  const category = providedCategory || guessCategory(name);

  const id = randomUUID();
  db.prepare(
    'INSERT INTO shopping_list (id, name, qty, checked, position, category) VALUES (?, ?, ?, 0, ?, ?)'
  ).run(id, name, qty, position, category);

  const row = db
    .prepare('SELECT * FROM shopping_list WHERE id = ?')
    .get(id);
  res.status(201).json(rowToShoppingItem(row));
});

// POST /api/shopping-list/from-recipe/:recipeId
// Add a recipe's ingredients. Items already on the list ACCUMULATE the recipe's
// required amount (hidden), bumping the visible buy amount when the total
// outgrows what's already in the cart (see storeQty.js).
app.post('/api/shopping-list/from-recipe/:recipeId', (req, res) => {
  const recipe = db
    .prepare('SELECT ingredients FROM recipes WHERE id = ?')
    .get(req.params.recipeId);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

  const recipeIngredients = safeParse(recipe.ingredients, []);

  // Map existing shopping rows by lowercase name so we can accumulate onto them.
  const existing = new Map();
  for (const r of db.prepare('SELECT * FROM shopping_list').all()) {
    existing.set(r.name.toLowerCase(), r);
  }
  let maxPos =
    db.prepare('SELECT COALESCE(MAX(position), -1) as mp FROM shopping_list').get()?.mp ?? -1;

  const insertStmt = db.prepare(
    'INSERT INTO shopping_list (id, name, qty, checked, position, category, req_base, req_dim) VALUES (?, ?, ?, 0, ?, ?, ?, ?)'
  );
  const updateStmt = db.prepare(
    'UPDATE shopping_list SET qty = ?, req_base = ?, req_dim = ? WHERE id = ?'
  );

  // Leading numeric value of a buy string ("2 bottles" → 2, "" → 0), used to
  // guarantee an accumulation never *decreases* a shown amount.
  const leadingNum = (s) => {
    const m = String(s ?? '').match(/^\s*(\d*\.?\d+)/);
    return m ? parseFloat(m[1]) : (String(s ?? '').trim() ? 1 : 0);
  };

  const addedIds = [];
  let merged = 0;

  db.transaction(() => {
    for (const ing of recipeIngredients) {
      const name = String(ing.name ?? '').trim();
      const key = name.toLowerCase();
      if (!key) continue;

      const { base, dim } = parseRequired(ing.qty);
      const row = existing.get(key);

      if (row) {
        // Accumulate required amount (only same-dimension amounts combine).
        let newBase = row.req_base || 0;
        let newDim = row.req_dim || '';
        if (!newDim || newDim === dim) {
          newBase += base;
          newDim = newDim || dim;
        }
        // Recompute the buy amount for bumpable items; never decrease it.
        let newQty = row.qty;
        if (isBumpable(name, newDim)) {
          const candidate = computeBuyAmount(name, newBase, newDim, ing.qty);
          if (leadingNum(candidate) > leadingNum(row.qty)) newQty = candidate;
        }
        updateStmt.run(newQty, newBase, newDim, row.id);
        existing.set(key, { ...row, qty: newQty, req_base: newBase, req_dim: newDim });
        merged += 1;
      } else {
        maxPos += 1;
        const id = randomUUID();
        const qty = computeBuyAmount(name, base, dim, ing.qty);
        const category = guessCategory(name);
        insertStmt.run(id, name, qty, maxPos, category, base, dim);
        existing.set(key, { id, name, qty, req_base: base, req_dim: dim, category });
        addedIds.push(id);
      }
    }
  })();

  const addedItems = addedIds.map((id) =>
    rowToShoppingItem(db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(id))
  );
  // `skipped` retained for backward-compatible clients; equals the merged count.
  res.status(201).json({ added: addedItems, merged, skipped: merged });
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
// History
// ===========================================================================

/**
 * Hydrate a raw history DB row into the API shape, fetching the minimal recipe
 * stub via a LEFT JOIN so that deleted recipes yield recipe: null rather than
 * dropping the entry.
 */
function rowToHistoryEntry(row) {
  return {
    id:          row.id,
    recipe_id:   row.recipe_id,
    date:        row.date,
    rating:      row.rating != null ? Number(row.rating) : null,
    image:       row.image ?? null,
    description: row.description ?? '',
    created_at:  row.created_at,
    updated_at:  row.updated_at,
    recipe: row.recipe_title
      ? {
          id:      row.recipe_id,
          title:   row.recipe_title,
          image:   row.recipe_image ?? null,
          cuisine: row.recipe_cuisine ?? '',
          minutes: row.recipe_minutes != null ? Number(row.recipe_minutes) : null,
        }
      : null,
  };
}

/** Fetch a single history row joined to the recipe stub (or null if deleted). */
function getHistoryRow(id) {
  return db
    .prepare(
      `SELECT h.id, h.recipe_id, h.date, h.rating, h.image, h.description,
              h.created_at, h.updated_at,
              r.title  AS recipe_title,
              r.image  AS recipe_image,
              r.cuisine AS recipe_cuisine,
              r.minutes AS recipe_minutes
       FROM history h
       LEFT JOIN recipes r ON h.recipe_id = r.id
       WHERE h.id = ?`
    )
    .get(id);
}

/** Build today's date as YYYY-MM-DD from local components (mirrors currentWeekDays). */
function localToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// GET /api/history — all entries, newest date first, hydrated with recipe stub.
app.get('/api/history', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT h.id, h.recipe_id, h.date, h.rating, h.image, h.description,
              h.created_at, h.updated_at,
              r.title  AS recipe_title,
              r.image  AS recipe_image,
              r.cuisine AS recipe_cuisine,
              r.minutes AS recipe_minutes
       FROM history h
       LEFT JOIN recipes r ON h.recipe_id = r.id
       ORDER BY h.date DESC, h.created_at DESC`
    )
    .all();
  res.json(rows.map(rowToHistoryEntry));
});

// POST /api/history — create a new history entry.
app.post('/api/history', (req, res) => {
  const body = req.body ?? {};

  const recipe_id = String(body.recipe_id ?? '').trim();
  if (!recipe_id) {
    return res.status(400).json({ error: 'recipe_id is required' });
  }

  // Verify the recipe exists (we still allow entries to persist if later deleted,
  // but the POST itself must reference a real recipe).
  const recipeExists = db
    .prepare('SELECT id FROM recipes WHERE id = ?')
    .get(recipe_id);
  if (!recipeExists) {
    return res.status(404).json({ error: 'Recipe not found' });
  }

  const date = String(body.date ?? '').trim() || localToday();

  // Clamp rating to integer 1–5 or null.
  let rating = null;
  if (body.rating !== undefined && body.rating !== null && body.rating !== '') {
    const r = parseInt(body.rating, 10);
    if (Number.isFinite(r)) {
      rating = Math.min(5, Math.max(1, r));
    }
  }

  const image       = body.image ? String(body.image) : null;
  const description = String(body.description ?? '').trim();

  const id  = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO history (id, recipe_id, date, rating, image, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, recipe_id, date, rating, image, description, now, now);

  const row = getHistoryRow(id);
  res.status(201).json(rowToHistoryEntry(row));
});

// PATCH /api/history/:id — partial update (date, rating, image, description).
app.patch('/api/history/:id', (req, res) => {
  const existing = db
    .prepare('SELECT * FROM history WHERE id = ?')
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'History entry not found' });

  const body = req.body ?? {};
  const now  = new Date().toISOString();

  // Only update fields that were provided.
  const newDate = 'date' in body
    ? String(body.date ?? '').trim() || existing.date
    : existing.date;

  let newRating = existing.rating;
  if ('rating' in body) {
    if (body.rating === null || body.rating === '') {
      newRating = null;
    } else {
      const r = parseInt(body.rating, 10);
      newRating = Number.isFinite(r) ? Math.min(5, Math.max(1, r)) : null;
    }
  }

  const newImage = 'image' in body
    ? (body.image ? String(body.image) : null)
    : existing.image;

  const newDescription = 'description' in body
    ? String(body.description ?? '').trim()
    : existing.description;

  db.prepare(
    `UPDATE history
     SET date = ?, rating = ?, image = ?, description = ?, updated_at = ?
     WHERE id = ?`
  ).run(newDate, newRating, newImage, newDescription, now, req.params.id);

  const row = getHistoryRow(req.params.id);
  res.json(rowToHistoryEntry(row));
});

// DELETE /api/history/:id — remove a single history entry.
app.delete('/api/history/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM history WHERE id = ?')
    .run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'History entry not found' });
  }
  res.status(204).end();
});

// ===========================================================================
// Pantry
// ===========================================================================

/**
 * Fixed ordered category list for the Pantry.
 * Any incoming category is coerced (case-insensitive) to one of these, or
 * falls back to 'Other'.
 */
const PANTRY_CATEGORIES = [
  'Produce',
  'Dairy & Eggs',
  'Meat & Seafood',
  'Bakery',
  'Frozen',
  'Pantry staples',
  'Beverages',
  'Condiments & Spices',
  'Other',
];

/**
 * Coerce an incoming category string to one of PANTRY_CATEGORIES.
 * Case-insensitive match; falls back to 'Other'.
 */
function coerceCategory(raw) {
  const lower = String(raw ?? '').trim().toLowerCase();
  const match = PANTRY_CATEGORIES.find((c) => c.toLowerCase() === lower);
  return match ?? 'Other';
}

/**
 * Guess a pantry category from an ingredient name by matching keywords in the
 * lowercased name. More-specific categories are checked before generic ones.
 * Returns one of PANTRY_CATEGORIES; falls back to 'Other'.
 */
function guessCategory(name) {
  const n = String(name ?? '').toLowerCase();

  // Dairy & Eggs — check before Beverages (milk belongs here, not Beverages)
  if (/milk|cheese|egg|butter|yogurt|cream|parmesan|mozzarella/.test(n)) {
    return 'Dairy & Eggs';
  }

  // Meat & Seafood
  if (/chicken|beef|steak|pork|bacon|sausage|turkey|lamb|fish|salmon|tuna|shrimp|prawn|meat/.test(n)) {
    return 'Meat & Seafood';
  }

  // Dried spices & ground seasonings — checked before Produce so "black pepper",
  // "cayenne pepper", "garlic powder", etc. don't get read as fresh produce.
  if (/cayenne|peppercorn|black pepper|white pepper|pepper flake|chili powder|paprika|cumin|oregano|cinnamon|turmeric|garlic powder|onion powder|nutmeg|coriander|cardamom|allspice|curry powder|garam masala|italian seasoning|bay leaf|ground /.test(n)) {
    return 'Condiments & Spices';
  }

  // Produce
  if (/lettuce|tomato|onion|garlic|potato|carrot|pepper|apple|banana|lemon|lime|spinach|broccoli|avocado|cucumber|herb|cilantro|mushroom|berry|fruit|vegetable/.test(n)) {
    return 'Produce';
  }

  // Bakery
  if (/bread|bun|bagel|roll|tortilla|naan|pita|croissant/.test(n)) {
    return 'Bakery';
  }

  // Frozen — keyword "frozen" or specific frozen goods
  if (/frozen|ice cream|popsicle/.test(n)) {
    return 'Frozen';
  }

  // Condiments & Spices — before Pantry staples so "salt" doesn't fall through
  if (/salt|sauce|ketchup|mustard|mayo|vinegar|spice|soy sauce|sriracha|honey|syrup|seasoning/.test(n)) {
    return 'Condiments & Spices';
  }
  // "oil" and "pepper" (as a spice) also land here but "pepper" (vegetable) was
  // already matched above under Produce, so no conflict.
  if (/\boil\b/.test(n)) {
    return 'Condiments & Spices';
  }

  // Pantry staples
  if (/flour|sugar|rice|pasta|noodle|bean|lentil|oat|cereal|stock|broth|\bcan\b|canned|baking|cornstarch|quinoa/.test(n)) {
    return 'Pantry staples';
  }

  // Beverages
  if (/juice|soda|water|coffee|tea|wine|beer|drink/.test(n)) {
    return 'Beverages';
  }

  return 'Other';
}

/** Turn a DB pantry row into the API shape. */
function rowToPantryItem(row) {
  return {
    id:         row.id,
    name:       row.name,
    qty:        row.qty ?? '',
    category:   row.category,
    position:   row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Sort key for the fixed category order. Returns the index in PANTRY_CATEGORIES,
 * or PANTRY_CATEGORIES.length (last) for any unrecognised value.
 */
function categoryOrder(cat) {
  const idx = PANTRY_CATEGORIES.indexOf(cat);
  return idx === -1 ? PANTRY_CATEGORIES.length : idx;
}

// GET /api/pantry — all items ordered by fixed category order, then position ASC, name ASC.
app.get('/api/pantry', (_req, res) => {
  // Fetch all rows; sort in JS because SQLite CASE ordering is verbose and the
  // list is small (personal pantry — hundreds of items at most).
  const rows = db
    .prepare('SELECT * FROM pantry ORDER BY position ASC, name ASC')
    .all();

  rows.sort((a, b) => {
    const catDiff = categoryOrder(a.category) - categoryOrder(b.category);
    if (catDiff !== 0) return catDiff;
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name);
  });

  res.json(rows.map(rowToPantryItem));
});

// POST /api/pantry — add one pantry item.
app.post('/api/pantry', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const qty      = String(req.body?.qty ?? '').trim();
  const category = coerceCategory(req.body?.category);

  // position = max existing position within this category + 1 (or 0).
  const maxPos = db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) as mp FROM pantry WHERE category = ?'
    )
    .get(category);
  const position = (maxPos?.mp ?? -1) + 1;

  const id  = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO pantry (id, name, qty, category, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, qty, category, position, now, now);

  const row = db.prepare('SELECT * FROM pantry WHERE id = ?').get(id);
  res.status(201).json(rowToPantryItem(row));
});

// PATCH /api/pantry/:id — partial update of name, qty, category.
app.patch('/api/pantry/:id', (req, res) => {
  const existing = db
    .prepare('SELECT * FROM pantry WHERE id = ?')
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Pantry item not found' });

  const body = req.body ?? {};
  const now  = new Date().toISOString();

  const newName     = 'name'     in body ? String(body.name ?? '').trim() || existing.name : existing.name;
  const newQty      = 'qty'      in body ? String(body.qty  ?? '').trim()                  : existing.qty;
  const newCategory = 'category' in body ? coerceCategory(body.category)                   : existing.category;

  db.prepare(
    'UPDATE pantry SET name = ?, qty = ?, category = ?, updated_at = ? WHERE id = ?'
  ).run(newName, newQty, newCategory, now, req.params.id);

  const row = db.prepare('SELECT * FROM pantry WHERE id = ?').get(req.params.id);
  res.json(rowToPantryItem(row));
});

// DELETE /api/pantry/:id
app.delete('/api/pantry/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM pantry WHERE id = ?')
    .run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Pantry item not found' });
  }
  res.status(204).end();
});

// POST /api/pantry/:id/to-shopping — "running low": copy pantry item to shopping list.
// The pantry item is NOT removed. De-duped by case-insensitive name (same as from-recipe).
app.post('/api/pantry/:id/to-shopping', (req, res) => {
  const pantryItem = db
    .prepare('SELECT * FROM pantry WHERE id = ?')
    .get(req.params.id);
  if (!pantryItem) return res.status(404).json({ error: 'Pantry item not found' });

  // De-dupe: if this name already exists on the shopping list, skip.
  const existing = db
    .prepare('SELECT * FROM shopping_list WHERE lower(name) = lower(?)')
    .get(pantryItem.name);
  if (existing) {
    return res.json({ added: null, skipped: true });
  }

  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) as mp FROM shopping_list')
    .get();
  const position = (maxPos?.mp ?? -1) + 1;

  const id  = randomUUID();
  db.prepare(
    'INSERT INTO shopping_list (id, name, qty, checked, position, category) VALUES (?, ?, ?, 0, ?, ?)'
  ).run(id, pantryItem.name, pantryItem.qty, position, pantryItem.category ?? 'Other');

  const row = db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(id);
  res.status(201).json(rowToShoppingItem(row));
});

// ===========================================================================
// Pantry — receipt import (AI)
// ===========================================================================

// POST /api/pantry/receipt — read a photo of a grocery receipt and return the
// grocery items on it as a DRAFT. Nothing is persisted here: the client shows
// the list for review, then posts the keepers to /api/pantry/bulk.
app.post('/api/pantry/receipt', uploadImage.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No receipt image uploaded.', code: 'UNSUPPORTED_URL' });
  }

  const tempPath = req.file.path;

  const mod = await getExtractModule();
  if (!mod) {
    await unlink(tempPath).catch(() => {});
    return res.status(503).json({
      error: 'Extraction service is not configured on this server.',
      code: 'EXTRACT_UNAVAILABLE',
    });
  }

  // Gemini needs a real image/* MIME. Browsers and the iOS share sheet
  // sometimes send application/octet-stream, so fall back to the extension.
  const rawMime = req.file.mimetype;
  const extMime = /\.hei[cf]$/i.test(req.file.originalname ?? '') ? 'image/heic'
    : /\.png$/i.test(req.file.originalname ?? '')                 ? 'image/png'
    : /\.webp$/i.test(req.file.originalname ?? '')                ? 'image/webp'
    : 'image/jpeg';
  const mimeType = (rawMime && rawMime.startsWith('image/')) ? rawMime : extMime;

  try {
    const receipt = await mod.extractReceipt(tempPath, mimeType, PANTRY_CATEGORIES);
    // The model returns null for a category it couldn't place; fall back to the
    // server's own keyword guess rather than dumping everything into "Other".
    const items = receipt.items.map((it) => ({
      name:     it.name,
      qty:      it.qty,
      category: it.category ?? guessCategory(it.name),
    }));
    res.json({ store: receipt.store, items });
  } catch (err) {
    if (err.code && err.userMessage) {
      console.warn(`[pantry/receipt] ${err.code}: ${err.message}`);
      return res.status(extractCodeToStatus(err.code)).json({
        error: err.userMessage,
        code:  err.code,
      });
    }
    console.error('[pantry/receipt] Unexpected error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  } finally {
    // Always clean up the temp file.
    await unlink(tempPath).catch(() => {});
  }
});

// POST /api/pantry/bulk — add many pantry items in one transaction.
// Backs the receipt-import review step, but is a plain bulk-add: it takes
// { items: [{ name, qty, category }] } from any caller.
// De-duped by case-insensitive name, both against the existing pantry and
// within the request itself. Returns what landed and what was skipped.
const MAX_BULK_PANTRY_ITEMS = 200;

app.post('/api/pantry/bulk', (req, res) => {
  const raw = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!raw) {
    return res.status(400).json({ error: 'items must be an array' });
  }
  if (raw.length > MAX_BULK_PANTRY_ITEMS) {
    return res.status(400).json({
      error: `Too many items — ${MAX_BULK_PANTRY_ITEMS} max per request.`,
    });
  }

  // Normalize, dropping blanks and de-duping within the request.
  const seenInBatch = new Set();
  const candidates  = [];
  for (const entry of raw) {
    const name = String(entry?.name ?? '').trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);

    const rawCat = String(entry?.category ?? '').trim();
    candidates.push({
      name,
      qty:      String(entry?.qty ?? '').trim(),
      category: rawCat ? coerceCategory(rawCat) : guessCategory(name),
    });
  }

  if (candidates.length === 0) {
    return res.json({ added: [], skipped: [] });
  }

  // Existing pantry names, lowercased, for the de-dupe.
  const existingNames = new Set(
    db.prepare('SELECT name FROM pantry').all().map((r) => r.name.toLowerCase())
  );

  // Next free position per category, so a batch doesn't collide on position.
  const nextPos = new Map(
    db
      .prepare('SELECT category, COALESCE(MAX(position), -1) AS mp FROM pantry GROUP BY category')
      .all()
      .map((r) => [r.category, r.mp + 1])
  );

  const insert = db.prepare(
    'INSERT INTO pantry (id, name, qty, category, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const now      = new Date().toISOString();
  const addedIds = [];
  const skipped  = [];

  const runBatch = db.transaction(() => {
    for (const item of candidates) {
      if (existingNames.has(item.name.toLowerCase())) {
        skipped.push(item.name);
        continue;
      }
      const position = nextPos.get(item.category) ?? 0;
      nextPos.set(item.category, position + 1);

      const id = randomUUID();
      insert.run(id, item.name, item.qty, item.category, position, now, now);
      addedIds.push(id);
    }
  });
  runBatch();

  const getRow = db.prepare('SELECT * FROM pantry WHERE id = ?');
  const added  = addedIds.map((id) => rowToPantryItem(getRow.get(id)));

  res.json({ added, skipped });
});

// POST /api/shopping-list/move-to-pantry — move all CHECKED shopping items into the pantry.
// NOTE: registered here (after shopping-list routes) but under /api/shopping-list/* to keep
// routes semantically grouped. Express matches routes in registration order; since
// /api/shopping-list/clear-checked is already registered above and uses a literal path,
// and move-to-pantry also uses a literal path, there is no conflict with /:id.
app.post('/api/shopping-list/move-to-pantry', (req, res) => {
  // Fetch all checked shopping items.
  const checkedItems = db
    .prepare('SELECT * FROM shopping_list WHERE checked = 1')
    .all();

  if (checkedItems.length === 0) {
    return res.json({ moved: [], skipped: 0 });
  }

  // Fetch existing pantry names (lowercase) for de-dupe.
  const existingPantryRows = db
    .prepare('SELECT name FROM pantry')
    .all();
  const existingPantryNames = new Set(
    existingPantryRows.map((r) => r.name.toLowerCase())
  );

  const moved   = [];
  let   skipped = 0;

  const insertPantry = db.prepare(
    'INSERT INTO pantry (id, name, qty, category, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const deleteShoppingItem = db.prepare(
    'DELETE FROM shopping_list WHERE id = ?'
  );

  const now = new Date().toISOString();

  const move = db.transaction(() => {
    for (const item of checkedItems) {
      const nameLower = item.name.toLowerCase();

      if (existingPantryNames.has(nameLower)) {
        // Already in pantry — skip adding but still remove from shopping list.
        skipped += 1;
        deleteShoppingItem.run(item.id);
        continue;
      }

      // Prefer the item's stored category (set when it was added to the list),
      // falling back to a name-based guess for older rows.
      const category = item.category || guessCategory(item.name);

      // position = max within category so far (may change with each insert inside
      // the transaction, so we query inline per item).
      const maxPos = db
        .prepare(
          'SELECT COALESCE(MAX(position), -1) as mp FROM pantry WHERE category = ?'
        )
        .get(category);
      const position = (maxPos?.mp ?? -1) + 1;

      const id = randomUUID();
      insertPantry.run(id, item.name, item.qty, category, position, now, now);
      deleteShoppingItem.run(item.id);

      existingPantryNames.add(nameLower); // guard against two checked items with same name
      moved.push(id);
    }
  });
  move();

  // Hydrate the moved pantry items for the response.
  const movedItems = moved.map((id) =>
    rowToPantryItem(db.prepare('SELECT * FROM pantry WHERE id = ?').get(id))
  );

  res.json({ moved: movedItems, skipped });
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
    // Load the user's filter labels and pass them into extraction so the AI
    // assigns filters in the SAME call (1 Gemini call per import, not 2).
    const filterLabels = db
      .prepare('SELECT label FROM filters ORDER BY position ASC, created_at ASC')
      .all()
      .map((r) => r.label);
    const draft = await mod.extractFromUrl(url, filterLabels);
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
    // Gemini needs a real video/* MIME; browsers/curl sometimes send
    // application/octet-stream, so normalize anything non-video to mp4.
    const rawMime = req.file.mimetype;
    const mimeType = (rawMime && rawMime.startsWith('video/')) ? rawMime : 'video/mp4';

    try {
      const filterLabels = db
        .prepare('SELECT label FROM filters ORDER BY position ASC, created_at ASC')
        .all()
        .map((r) => r.label);
      const draft = await mod.extractFromFile(tempPath, mimeType, filterLabels);
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
    const filterLabels = db
      .prepare('SELECT label FROM filters ORDER BY position ASC, created_at ASC')
      .all()
      .map((r) => r.label);
    const draft = await mod.extractFromUrl(url, filterLabels);

    const data = normalizeBody({ ...draft, step_times: draft.stepTimes, source_url: url });
    if (!data.title) data.title = 'Imported recipe';

    const now = new Date().toISOString();
    const id = randomUUID();
    const videoFile = draft.videoToken ? claimDraftVideo(draft.videoToken, id) : null;
    db.prepare(
      `INSERT INTO recipes
         (id, title, description, cuisine, category, protein, carb, minutes, servings, rating,
          favorite, image, ingredients, steps, step_times, tags, filters, source_url, source_caption,
          video_file, created_at, updated_at)
       VALUES
         (@id, @title, @description, @cuisine, @category, @protein, @carb, @minutes, @servings,
          @rating, @favorite, @image, @ingredients, @steps, @step_times, @tags, @filters,
          @source_url, @source_caption, @video_file, @created_at, @updated_at)`
    ).run({
      id,
      ...data,
      ingredients: JSON.stringify(data.ingredients),
      steps: JSON.stringify(data.steps),
      step_times: JSON.stringify(data.step_times),
      tags: JSON.stringify(data.tags),
      filters: JSON.stringify(data.filters),
      protein: JSON.stringify(data.protein),
      carb: JSON.stringify(data.carb),
      video_file: videoFile,
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
    // Receipt photos have their own, much smaller limit — say so, rather than
    // quoting the 200 MB video limit at someone uploading a picture.
    const isReceipt = err.field === 'receipt';

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: isReceipt
          ? `That photo is too large. The limit is ${Math.round(RECEIPT_MAX_BYTES / (1024 * 1024))} MB.`
          : 'That video is too large. The limit is 200 MB — upload a shorter clip.',
        code: 'FETCH_FAILED',
      });
    }
    if (isReceipt && err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: "That file isn't an image. Upload a photo of the receipt (JPEG, PNG, HEIC).",
        code: 'UNSUPPORTED_URL',
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
