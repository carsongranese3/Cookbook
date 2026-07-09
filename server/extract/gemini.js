/**
 * server/extract/gemini.js
 *
 * Upload a video to the Gemini Files API and run the extraction prompt.
 * Returns a validated draft recipe object (not persisted).
 *
 * Environment variables consumed:
 *   GEMINI_API_KEY  (required)
 *   GEMINI_MODEL    (optional) — Gemini model ID; defaults to gemini-2.0-flash
 *
 * Throws ExtractError with codes:
 *   CONFIG       — GEMINI_API_KEY is absent
 *   FETCH_FAILED — Gemini Files API upload failure
 *   TIMEOUT      — request exceeded GEMINI_TIMEOUT_MS (default 120 s)
 *   PARSE_FAILED — could not parse / coerce valid JSON after one retry
 *   NO_RECIPE    — parsed object has no ingredients and no steps
 */

import { stat }              from 'node:fs/promises';
import { ExtractError, CODES } from './errors.js';

// We import the Gemini SDK lazily inside the function so that missing deps
// surface as a clear CONFIG error rather than a module-load crash.

const DEFAULT_MODEL   = 'gemini-2.0-flash';
const TIMEOUT_MS      = parseInt(process.env.GEMINI_TIMEOUT_MS ?? '', 10) || 120_000;
const MAX_FILE_BYTES  = 200 * 1024 * 1024; // 200 MB guard

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * Build the extraction prompt. The caption is injected verbatim so the model
 * can recover exact quantities that are not spoken in the video.
 *
 * @param {string} caption  Raw caption / description text (may be empty).
 * @returns {string}
 */
function buildPrompt(caption) {
  const captionSection = caption
    ? `\n\nVIDEO CAPTION / DESCRIPTION (use for exact quantities):\n"""\n${caption.slice(0, 4000)}\n"""`
    : '';

  return `You are a recipe extraction assistant. Watch the cooking video and extract a complete recipe.${captionSection}

Return ONLY valid JSON — no prose, no markdown code fences (no \`\`\`json), no commentary before or after. The JSON must match this exact shape:

{
  "title": "string",
  "description": "string — one enticing sentence about the dish",
  "minutes": 0,
  "servings": 0,
  "cuisine": "string — e.g. Italian, Mexican, American",
  "category": "string — one of Dinner, Breakfast, Dessert, or another category",
  "ingredients": [{ "name": "string", "qty": "string" }],
  "steps": ["string"]
}

Rules you must follow:
1. CONVERT ALL MEASUREMENTS TO IMPERIAL. Weights → oz or lb. Volumes → cups, tbsp, tsp, or fl oz. Oven temperatures → °F. Lengths → inches. For dry goods given in grams, use standard culinary volume equivalents (e.g. 120 g flour ≈ 1 cup; 15 g butter ≈ 1 tbsp). For liquids given in ml, convert directly (240 ml ≈ 1 cup; 15 ml ≈ 1 tbsp; 5 ml ≈ 1 tsp). Amounts should be estimates the user can correct.
2. Use the caption text (if provided above) for exact ingredient quantities the video does not state clearly.
3. Do NOT invent ingredients. Only include what is shown, said, or written in the caption. If something is unclear, omit it rather than guess. If no recipe can be identified, return {"title":"","description":"","minutes":0,"servings":0,"cuisine":"","category":"","ingredients":[],"steps":[]}.
4. Target 5–9 ingredients and 4–7 concise imperative steps (e.g. "Mix flour and butter until crumbly.").
5. "qty" is a display string like "2 cups", "1 tbsp", "1 lb", "350°F", or "" if unknown.
6. "minutes" and "servings" must be integers (not strings, not null). Default to 0 if unknown.
7. Return nothing outside the JSON object.`;
}

const RETRY_PROMPT =
  'Your previous response was not valid JSON. Return ONLY the JSON object, ' +
  'with no code fences, no prose, no trailing text. Start with { and end with }.';

// ---------------------------------------------------------------------------
// JSON extraction + coercion
// ---------------------------------------------------------------------------

/**
 * Strip markdown fences and any surrounding prose, then try JSON.parse.
 * Falls back to slicing from first `{` to last `}`.
 *
 * @param {string} raw
 * @returns {unknown}  Throws SyntaxError if unparseable.
 */
function parseModelJson(raw) {
  // 1. Strip ```json … ``` or ``` … ``` fences.
  let cleaned = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();

  // 2. Try direct parse.
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // 3. Fallback: slice from first { to last }.
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new SyntaxError('No JSON object found in model response');
  }
}

/**
 * Validate and coerce a raw parsed object into the draft recipe shape.
 * Missing fields are defaulted; wrong types are coerced.
 *
 * @param {unknown} raw
 * @returns {import('./index.js').DraftRecipe}
 */
function coerceDraft(raw) {
  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

  const str  = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
  const int  = (v, fallback = 0)  => {
    const n = parseInt(String(v ?? ''), 10);
    return isFinite(n) && n >= 0 ? n : fallback;
  };

  // Normalize ingredients: each item must be { name: string, qty: string }.
  const rawIngredients = Array.isArray(obj.ingredients) ? obj.ingredients : [];
  const ingredients = rawIngredients
    .map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return {
          name: str(item.name),
          qty:  str(item.qty),
        };
      }
      if (typeof item === 'string') {
        // Tolerate a plain string ("2 cups flour") — put it all in name.
        return { name: item.trim(), qty: '' };
      }
      return null;
    })
    .filter((item) => item !== null && item.name.length > 0);

  // Normalize steps: each item must be a non-empty string.
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  const steps = rawSteps
    .map((s) => (typeof s === 'string' ? s.trim() : String(s ?? '').trim()))
    .filter(Boolean);

  return {
    title:       str(obj.title),
    description: str(obj.description),
    minutes:     int(obj.minutes),
    servings:    int(obj.servings),
    cuisine:     str(obj.cuisine),
    category:    str(obj.category),
    ingredients,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new ExtractError(CODES.TIMEOUT, `Gemini request exceeded ${ms} ms`)),
        ms,
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload a video file to the Gemini Files API, run the extraction prompt,
 * and return a coerced draft recipe.
 *
 * @param {string} filePath   Absolute path to the video file.
 * @param {string} mimeType   MIME type, e.g. 'video/mp4'.
 * @param {string} [caption]  Optional caption/description text from yt-dlp.
 * @returns {Promise<import('./index.js').DraftRecipe>}
 */
export async function extractWithGemini(filePath, mimeType, caption = '') {
  // ── Guard: API key ────────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ExtractError(
      CODES.CONFIG,
      'GEMINI_API_KEY environment variable is not set',
      'The server is not configured for AI extraction. Set GEMINI_API_KEY in server/.env.',
    );
  }

  const modelId = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  // ── Guard: file size ──────────────────────────────────────────────────────
  try {
    const info = await stat(filePath);
    if (info.size > MAX_FILE_BYTES) {
      throw new ExtractError(
        CODES.FETCH_FAILED,
        `Video file is too large: ${info.size} bytes (limit ${MAX_FILE_BYTES})`,
        'That video is too large to process. Try a shorter clip or upload a smaller file.',
      );
    }
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(CODES.FETCH_FAILED, `Cannot stat file: ${err.message}`);
  }

  // ── Lazy-import Gemini SDK ────────────────────────────────────────────────
  // We import dynamically so a missing package surfaces as CONFIG rather than
  // a module-load crash that kills the whole server.
  let GoogleGenerativeAI, FileManager, FileState;
  try {
    const sdk = await import('@google/generative-ai');
    GoogleGenerativeAI = sdk.GoogleGenerativeAI;
    FileState = sdk.FileState ?? { ACTIVE: 'ACTIVE', FAILED: 'FAILED' };

    // GoogleAIFileManager moved to @google/generative-ai/server in SDK v0.12,
    // then back to the main package in v0.21+. Try main first, then sub-path.
    if (sdk.GoogleAIFileManager) {
      FileManager = sdk.GoogleAIFileManager;
    } else {
      const serverSdk = await import('@google/generative-ai/server');
      FileManager = serverSdk.GoogleAIFileManager;
    }
  } catch (err) {
    throw new ExtractError(
      CODES.CONFIG,
      `Failed to import @google/generative-ai: ${err.message}`,
      'The AI library is not installed on the server. Run npm install in server/.',
    );
  }

  // ── Upload video to Gemini Files API ──────────────────────────────────────
  let uploadedFile;
  try {
    const fileManager = new FileManager(apiKey);
    const uploadResult = await withTimeout(
      fileManager.uploadFile(filePath, { mimeType, displayName: 'recipe-video' }),
      TIMEOUT_MS,
    );
    uploadedFile = uploadResult.file;
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(
      CODES.FETCH_FAILED,
      `Gemini file upload failed: ${err.message}`,
    );
  }

  // ── Poll until the file is ACTIVE (Gemini processes it async) ────────────
  try {
    const fileManager = new FileManager(apiKey);
    const pollDeadline = Date.now() + TIMEOUT_MS;

    while (uploadedFile.state === 'PROCESSING' || uploadedFile.state === FileState.PROCESSING) {
      if (Date.now() > pollDeadline) {
        throw new ExtractError(CODES.TIMEOUT, 'Gemini file processing timed out');
      }
      await new Promise((r) => setTimeout(r, 3000));
      const refreshed = await fileManager.getFile(uploadedFile.name);
      uploadedFile = refreshed;
    }

    const failedState = FileState.FAILED ?? 'FAILED';
    if (uploadedFile.state === failedState) {
      throw new ExtractError(
        CODES.FETCH_FAILED,
        `Gemini file processing failed: ${uploadedFile.name}`,
        'The AI could not process that video file. Try a different format or upload the file instead.',
      );
    }
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(CODES.FETCH_FAILED, `Gemini file polling failed: ${err.message}`);
  }

  // ── Run the extraction prompt ─────────────────────────────────────────────
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId });

  const filePart = {
    fileData: {
      mimeType:  uploadedFile.mimeType,
      fileUri:   uploadedFile.uri,
    },
  };

  /**
   * Call the model once and return the raw text response.
   * @param {string} promptText
   * @returns {Promise<string>}
   */
  async function callModel(promptText) {
    const result = await withTimeout(
      model.generateContent([promptText, filePart]),
      TIMEOUT_MS,
    );
    return result.response.text();
  }

  // ── First attempt ─────────────────────────────────────────────────────────
  let rawText;
  try {
    rawText = await callModel(buildPrompt(caption));
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(
      CODES.FETCH_FAILED,
      `Gemini generateContent failed: ${err.message}`,
    );
  }

  // ── Parse first attempt ───────────────────────────────────────────────────
  let parsed;
  try {
    parsed = parseModelJson(rawText);
  } catch (_parseErr) {
    // ── Retry once with a JSON-only prompt ────────────────────────────────
    console.warn('[gemini] First parse failed; retrying with JSON-only prompt.');
    let retryText;
    try {
      retryText = await callModel(RETRY_PROMPT);
    } catch (err) {
      if (err instanceof ExtractError) throw err;
      throw new ExtractError(
        CODES.PARSE_FAILED,
        `Gemini retry generateContent failed: ${err.message}`,
      );
    }

    try {
      parsed = parseModelJson(retryText);
    } catch (err2) {
      throw new ExtractError(
        CODES.PARSE_FAILED,
        `Could not parse Gemini JSON after retry: ${err2.message}`,
      );
    }
  }

  // ── Coerce into draft shape ───────────────────────────────────────────────
  const draft = coerceDraft(parsed);

  // ── Guard: no recipe detected ─────────────────────────────────────────────
  if (draft.ingredients.length === 0 && draft.steps.length === 0) {
    throw new ExtractError(CODES.NO_RECIPE, 'Model returned no ingredients and no steps');
  }

  return draft;
}
