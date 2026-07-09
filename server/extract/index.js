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
 * Both functions resolve to a DraftRecipe on success, or throw an ExtractError
 * on failure. The ExtractError carries:
 *   err.code        ∈ { UNSUPPORTED_URL, FETCH_FAILED, NO_RECIPE, PARSE_FAILED, TIMEOUT, CONFIG }
 *   err.userMessage — a safe, friendly string for the UI error banner.
 *
 * Re-exports ExtractError and CODES so route handlers can switch on err.code.
 *
 * @module server/extract
 */

import { downloadVideo }        from './ytdlp.js';
import { extractWithGemini }    from './gemini.js';
import { pickHeroFrameDataUri } from './frame.js';
export { ExtractError, CODES } from './errors.js';

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
 * @property {number}           minutes     Integer total time; 0 if unknown.
 * @property {number}           servings    Integer; 0 if unknown.
 * @property {string}           cuisine     e.g. "Italian"; empty string if unknown.
 * @property {string}           category    e.g. "Dinner", "Breakfast", "Dessert"; empty if unknown.
 * @property {IngredientItem[]} ingredients Normalized, imperial units.
 * @property {string[]}         steps       Ordered imperative step text.
 * @property {string|null}      image       AI-picked hero frame as a JPEG data URI, or null.
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
export async function extractFromUrl(url) {
  const { filePath, mimeType, caption, cleanup } = await downloadVideo(url);

  try {
    const draft = await extractWithGemini(filePath, mimeType, caption);
    // AI-picked hero frame → recipe photo (best-effort; null falls back to a gradient).
    draft.image = await pickHeroFrameDataUri(filePath, draft.heroSeconds);
    delete draft.heroSeconds;
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
export async function extractFromFile(filePath, mimeType) {
  const draft = await extractWithGemini(filePath, mimeType, '');
  draft.image = await pickHeroFrameDataUri(filePath, draft.heroSeconds);
  delete draft.heroSeconds;
  return draft;
}
