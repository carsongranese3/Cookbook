#!/usr/bin/env node
/**
 * server/scripts/backfill-videos.mjs
 *
 * One-time backfill for Cook Mode: for every existing recipe that has a
 * `source_url` but no video yet, re-download its source video via yt-dlp,
 * persist a copy to server/media/<id>.mp4, and make ONE additional Gemini
 * call (per recipe) to timestamp its EXISTING steps — writing the result to
 * `step_times`.
 *
 * This is the one place a second Gemini call per recipe is acceptable: it is
 * a manual, one-shot migration, not a repeated per-import cost.
 *
 * Run manually (NOT wired to any endpoint):
 *   node server/scripts/backfill-videos.mjs
 *   node server/scripts/backfill-videos.mjs --dry-run
 *   node server/scripts/backfill-videos.mjs --id=<recipeId> --retime
 *
 * `--retime` (requires `--id=<recipeId>`): re-runs ONLY the Gemini timestamp
 * call against the recipe's EXISTING on-disk video at server/media/<id>.mp4
 * — no yt-dlp download, no `video_file` change. It just overwrites
 * `step_times`. Useful for testing prompt changes without burning a
 * redownload against a rate-limited source. Fails loudly if the recipe has
 * no `video_file` on disk.
 *
 * Behavior:
 *   - Processes recipes SEQUENTIALLY (not in parallel) to respect Gemini's
 *     free-tier rate limits.
 *   - Logs each recipe as OK/FAIL with a reason, and continues on failure.
 *   - Never fabricates timestamps — a failed recipe's step_times stays [].
 *   - Prints a final OK/FAIL summary.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, renameSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(__dirname, '..');
const MEDIA_DIR = join(SERVER_DIR, 'media');

// Load server/.env the same way index.js does (Node >= 20.12). Harmless if absent.
try {
  process.loadEnvFile(join(SERVER_DIR, '.env'));
} catch { /* no .env file yet */ }

const DRY_RUN = process.argv.includes('--dry-run');
// Optional `--id=<recipeId>` restricts the run to a single recipe (used for a
// one-recipe smoke test before committing to the full backfill).
const ONLY_ID = (process.argv.find((a) => a.startsWith('--id=')) || '').slice('--id='.length) || null;
// `--retime`: re-timestamp an EXISTING on-disk video only (no download, no
// video_file change). Requires --id.
const RETIME = process.argv.includes('--retime');

// better-sqlite3 requires cwd server/ — db.js resolves its path relative to
// itself (join(__dirname-of-db.js, 'cookbook.db')), so this works regardless
// of the caller's cwd as long as db.js is imported by absolute-resolved path.
const { default: db } = await import(join(SERVER_DIR, 'db.js'));
const { downloadVideo } = await import(join(SERVER_DIR, 'extract', 'ytdlp.js'));

/** Safely JSON-parse a value; return `fallback` on any failure. */
function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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

/**
 * ONE Gemini call: given the video + the recipe's EXISTING numbered steps,
 * ask only for a timestamp (seconds) per step index. Returns a number[] the
 * same length as `steps`. Throws on any failure — the caller catches it
 * per-recipe and leaves step_times untouched (never fabricated).
 *
 * @param {string} filePath
 * @param {string} mimeType
 * @param {string[]} steps
 * @returns {Promise<number[]>}
 */
async function timestampSteps(filePath, mimeType, steps) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const sdk = await import('@google/generative-ai');
  const { GoogleGenerativeAI } = sdk;
  let FileManager = sdk.GoogleAIFileManager;
  if (!FileManager) {
    const serverSdk = await import('@google/generative-ai/server');
    FileManager = serverSdk.GoogleAIFileManager;
  }

  const fileManager = new FileManager(apiKey);
  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName: 'backfill-video',
  });
  let uploadedFile = uploadResult.file;

  const deadline = Date.now() + 120_000;
  while (uploadedFile.state === 'PROCESSING') {
    if (Date.now() > deadline) throw new Error('Gemini file processing timed out');
    await new Promise((r) => setTimeout(r, 3000));
    uploadedFile = await fileManager.getFile(uploadedFile.name);
  }
  if (uploadedFile.state === 'FAILED') {
    throw new Error('Gemini file processing failed');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelId = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const model = genAI.getGenerativeModel({ model: modelId });

  const numberedSteps = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const prompt =
    `Watch this cooking video. Here are the recipe's steps, already written and numbered:\n\n` +
    `${numberedSteps}\n\n` +
    `Return ONLY a JSON array of exactly ${steps.length} numbers (no prose, no markdown code ` +
    `fences) — one timestamp in SECONDS (decimals allowed) per step, in the SAME order. Each ` +
    `timestamp is the START of that step's segment: the earliest moment the ingredients or ` +
    `actions for that step FIRST begin to appear on screen, such that starting playback there ` +
    `shows the ENTIRE step from its beginning — NOT the moment the step's main action peaks or a ` +
    `single verb happens (e.g. for "Whisk together lemon juice, zest, honey and garlic," the ` +
    `timestamp is when those ingredients first start going into the bowl, NOT when whisking ` +
    `starts). Timestamps must be non-decreasing across the array. Use 0 only if a step's segment ` +
    `truly isn't shown in the video.`;

  const filePart = {
    fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri },
  };
  const result = await model.generateContent([prompt, filePart]);
  const rawText = result.response.text();

  let cleaned = rawText.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON array found in Gemini response');
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Gemini response was not a JSON array');

  const times = [];
  for (let i = 0; i < steps.length; i++) {
    const n = parseFloat(parsed[i]);
    times.push(Number.isFinite(n) && n >= 0 ? n : 0);
  }
  return times;
}

/**
 * `--retime` mode: re-run ONLY the Gemini timestamp call against a recipe's
 * EXISTING on-disk video (server/media/<id>.mp4). No yt-dlp download, no
 * `video_file` change — overwrites `step_times` only. Requires --id.
 */
async function runRetime() {
  if (!ONLY_ID) {
    console.error('[backfill] --retime requires --id=<recipeId>.');
    process.exitCode = 1;
    return;
  }

  const recipe = db
    .prepare('SELECT id, title, steps, video_file, step_times FROM recipes WHERE id = ?')
    .get(ONLY_ID);

  if (!recipe) {
    console.error(`[backfill] --retime: no recipe found with id=${ONLY_ID}.`);
    process.exitCode = 1;
    return;
  }
  if (!recipe.video_file) {
    console.error(`[backfill] --retime: recipe ${ONLY_ID} has no video_file on record.`);
    process.exitCode = 1;
    return;
  }

  const videoPath = join(MEDIA_DIR, recipe.video_file);
  if (!existsSync(videoPath)) {
    console.error(`[backfill] --retime: on-disk video not found at ${videoPath}.`);
    process.exitCode = 1;
    return;
  }

  const steps = safeParse(recipe.steps, []);
  if (steps.length === 0) {
    console.log(`[backfill] --retime: recipe ${ONLY_ID} has no steps to timestamp.`);
    return;
  }

  const before = safeParse(recipe.step_times, []);
  console.log(`[backfill] --retime ${recipe.id} — "${recipe.title}"`);
  console.log(`  using on-disk video: ${videoPath} (no download)`);
  console.log(`  BEFORE step_times: ${JSON.stringify(before)}`);

  const mimeType = videoPath.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';

  try {
    const stepTimes = await timestampSteps(videoPath, mimeType, steps);
    db.prepare('UPDATE recipes SET step_times = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(stepTimes),
      new Date().toISOString(),
      recipe.id
    );
    console.log(`  AFTER step_times:  ${JSON.stringify(stepTimes)}`);
    console.log('  OK — step_times updated (video_file untouched, no download).');
  } catch (err) {
    console.log(`  FAIL — ${err.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  mkdirSync(MEDIA_DIR, { recursive: true });

  let recipes = db
    .prepare(
      `SELECT id, title, source_url, steps, video_file FROM recipes
       WHERE source_url IS NOT NULL AND source_url != ''
         AND (video_file IS NULL OR video_file = '')
       ORDER BY created_at ASC`
    )
    .all();

  if (ONLY_ID) {
    recipes = recipes.filter((r) => r.id === ONLY_ID);
    console.log(`[backfill] --id=${ONLY_ID} → ${recipes.length} matching recipe(s).`);
  }

  console.log(
    `[backfill] ${recipes.length} recipe(s) with a source_url and no video.` +
      (DRY_RUN ? ' (dry run — no writes, no Gemini calls)' : '')
  );

  const results = { ok: [], fail: [] };

  for (const recipe of recipes) {
    const steps = safeParse(recipe.steps, []);
    console.log(`\n[backfill] ${recipe.id} — "${recipe.title}"`);

    if (DRY_RUN) {
      console.log(
        `  would re-download ${recipe.source_url}, save to media/${recipe.id}.mp4, ` +
          `and timestamp ${steps.length} step(s).`
      );
      continue;
    }

    let cleanup = null;
    try {
      const dl = await downloadVideo(recipe.source_url);
      cleanup = dl.cleanup;

      const destPath = join(MEDIA_DIR, `${recipe.id}.mp4`);
      moveFile(dl.filePath, destPath);
      db.prepare('UPDATE recipes SET video_file = ?, updated_at = ? WHERE id = ?').run(
        `${recipe.id}.mp4`,
        new Date().toISOString(),
        recipe.id
      );

      if (steps.length > 0) {
        const stepTimes = await timestampSteps(destPath, dl.mimeType, steps);
        db.prepare('UPDATE recipes SET step_times = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(stepTimes),
          new Date().toISOString(),
          recipe.id
        );
        console.log(`  OK — video saved, ${stepTimes.length} step timestamp(s) written.`);
      } else {
        console.log('  OK — video saved (recipe has no steps to timestamp).');
      }
      results.ok.push(recipe.id);
    } catch (err) {
      console.log(`  FAIL — ${err.message}`);
      results.fail.push({ id: recipe.id, title: recipe.title, reason: err.message });
      // step_times is intentionally left untouched (never fabricated).
    } finally {
      if (cleanup) await cleanup().catch(() => {});
    }
  }

  if (DRY_RUN) {
    console.log(`\n[backfill] Dry run complete. ${recipes.length} recipe(s) would be processed.`);
    return;
  }

  console.log(`\n[backfill] Done. ${results.ok.length} OK, ${results.fail.length} FAILED.`);
  if (results.fail.length > 0) {
    console.log('[backfill] Failures:');
    for (const f of results.fail) {
      console.log(`  - ${f.id} "${f.title}": ${f.reason}`);
    }
  }
}

if (RETIME) {
  await runRetime();
} else {
  await main();
}
