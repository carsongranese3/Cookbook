/**
 * server/extract/index.js
 *
 * Public interface for the AI video→recipe extraction layer.
 *
 * Exports two functions that the backend route handlers call:
 *
 *   extractFromUrl(url)
 *     Path B — paste an Instagram or TikTok link.
 *     1. Validates the URL (throws UNSUPPORTED_URL for anything else).
 *     2. Uses yt-dlp to download the video + caption to a temp file.
 *     3. Uploads the video to Gemini Files API and runs the extraction prompt.
 *     4. Returns a draft recipe object (not persisted).
 *     5. Cleans up the temp file in all cases.
 *
 *   extractFromFile(filePath, mimeType)
 *     Path A — an uploaded video file (already on disk, managed by the caller).
 *     1. Uploads the file to Gemini Files API and runs the extraction prompt.
 *     2. Returns a draft recipe object (not persisted).
 *     The caller owns the temp file's lifecycle (multer, etc.).
 *
 * Plus one function for the Pantry's receipt import:
 *
 *   extractReceipt(filePath, mimeType, categories)
 *     A photo of a grocery receipt in, a list of grocery items out (not
 *     persisted). Sends the image inline rather than via the Files API.
 *     The caller owns the temp file's lifecycle.
 *
 * Both functions resolve to a DraftRecipe on success, or throw an ExtractError
 * on failure. The ExtractError carries:
 *   err.code        ∈ { UNSUPPORTED_URL, FETCH_FAILED, NO_RECIPE, PARSE_FAILED, TIMEOUT, CONFIG }
 *   err.userMessage — a safe, friendly string for the UI error banner.
 *
 * Re-exports ExtractError and CODES so route handlers can switch on err.code.
 *
 * @module server/extract
 */

import { randomUUID }                                             from 'node:crypto';
import { copyFile, mkdir }                                        from 'node:fs/promises';
import { dirname, join }                                          from 'node:path';
import { fileURLToPath }                                          from 'node:url';
import { downloadVideo }                                          from './ytdlp.js';
import { extractWithGemini }                                     from './gemini.js';
import { extractCandidateFrames, getCandidateFramesFromUrl }     from './frame.js';
export { ExtractError, CODES }                                   from './errors.js';
export { assignFilters }                                         from './gemini.js';
export { extractReceipt }                                        from './receipt.js';
export { extractCandidateFrames, getCandidateFramesFromUrl }     from './frame.js';

// ---------------------------------------------------------------------------
// Draft video persistence — Cook Mode needs the source video after extraction,
// but the yt-dlp temp file is always cleaned up. Stash a copy under
// server/media/drafts/<token>.mp4 so POST /api/recipes can claim it later.
// ---------------------------------------------------------------------------

const DRAFTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'media', 'drafts');

/**
 * Copy the just-downloaded/uploaded video into server/media/drafts/ under a
 * fresh token, so it survives the temp-file cleanup that always follows
 * extraction. Never throws — extraction must succeed even if this fails.
 * @param {string} filePath
 * @returns {Promise<string|null>} the token, or null if the copy failed.
 */
async function stashDraftVideo(filePath) {
  try {
    await mkdir(DRAFTS_DIR, { recursive: true });
    const token = randomUUID();
    await copyFile(filePath, join(DRAFTS_DIR, `${token}.mp4`));
    return token;
  } catch (err) {
    console.warn('[extract] Could not stash draft video for Cook Mode:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// JSDoc type (informational — this is plain JS, no TypeScript compiler)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} IngredientItem
 * @property {string} name  Ingredient name in imperial context, e.g. "all-purpose flour".
 * @property {string} qty   Imperial quantity display string, e.g. "2 cups" or "" if unknown.
 */

/**
 * @typedef {Object} DraftRecipe
 * @property {string}           title
 * @property {string}           description
 * @property {number}           minutes          Integer total time; 0 if unknown.
 * @property {number}           servings         Integer; 0 if unknown.
 * @property {string}           cuisine          e.g. "Italian"; empty string if unknown.
 * @property {string}           category         e.g. "Dinner", "Breakfast", "Dessert"; empty if unknown.
 * @property {IngredientItem[]} ingredients      Normalized, imperial units.
 * @property {string[]}         steps            Ordered imperative step text.
 * @property {number[]}         stepTimes        Seconds, positionally parallel to `steps`; same
 *                                               length as `steps`. `0` for any step whose moment
 *                                               isn't visible in the video (never fabricated).
 * @property {string|null}      image            Best-guess candidate frame as a JPEG data URI, or null
 *                                               (equals imageCandidates[0] when candidates is non-empty).
 * @property {string[]}         imageCandidates  Ordered array of JPEG data URI candidate frames (≤6),
 *                                               best-guess first. Transient — not persisted to DB.
 *                                               Empty array when no frames could be extracted.
 * @property {string|null}      videoToken       Token referencing the stashed draft video at
 *                                               server/media/drafts/<videoToken>.mp4, or null if
 *                                               the video could not be stashed. Send back as
 *                                               `video_token` on POST /api/recipes to attach it.
 */

// ---------------------------------------------------------------------------
// Path B — URL
// ---------------------------------------------------------------------------

/**
 * Extract a recipe from an Instagram or TikTok URL.
 *
 * @param {string} url  An Instagram Reel or TikTok video URL.
 * @returns {Promise<DraftRecipe>}
 * @throws {import('./errors.js').ExtractError}
 */
export async function extractFromUrl(url, filterLabels = []) {
  const { filePath, mimeType, caption, cleanup } = await downloadVideo(url);

  try {
    const draft = await extractWithGemini(filePath, mimeType, caption, filterLabels);
    // Grab multiple candidate frames so the user can choose the best cover photo.
    const candidates = await extractCandidateFrames(filePath, draft.heroSeconds);
    draft.imageCandidates = candidates;
    draft.image = candidates[0] ?? null;
    delete draft.heroSeconds;
    // Stash a copy of the video (before cleanup below deletes the temp file)
    // so Cook Mode has something to play once the recipe is saved.
    draft.videoToken = await stashDraftVideo(filePath);
    return draft;
  } finally {
    // Always clean up the temp file, even if extraction fails.
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// Path A — uploaded file
// ---------------------------------------------------------------------------

/**
 * Extract a recipe from a video file already on disk.
 * The caller (typically a multer middleware in the route handler) owns the
 * file's lifecycle and is responsible for deleting it after this resolves or rejects.
 *
 * @param {string} filePath   Absolute path to the video file.
 * @param {string} mimeType   MIME type string, e.g. 'video/mp4' or 'video/webm'.
 * @returns {Promise<DraftRecipe>}
 * @throws {import('./errors.js').ExtractError}
 */
export async function extractFromFile(filePath, mimeType, filterLabels = []) {
  const draft = await extractWithGemini(filePath, mimeType, '', filterLabels);
  // Grab multiple candidate frames so the user can choose the best cover photo.
  const candidates = await extractCandidateFrames(filePath, draft.heroSeconds);
  draft.imageCandidates = candidates;
  draft.image = candidates[0] ?? null;
  delete draft.heroSeconds;
  // Stash a copy (the caller still owns and deletes the original temp file).
  draft.videoToken = await stashDraftVideo(filePath);
  return draft;
}
