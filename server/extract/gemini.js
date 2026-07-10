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
import { probeDuration }     from './frame.js';

// ---------------------------------------------------------------------------
// assignFilters — lightweight text-only Gemini call
// ---------------------------------------------------------------------------

/**
 * Given a recipe object and a list of user-defined filter labels, ask Gemini
 * which of those labels clearly apply to the recipe.
 *
 * @param {{ title?: string, description?: string, ingredients?: {name:string,qty:string}[], steps?: string[] }} recipe
 * @param {string[]} filterLabels  The user's flat filter label list.
 * @returns {Promise<string[]>}  Subset of filterLabels that apply; [] on any parse error.
 */
export async function assignFilters(recipe, filterLabels) {
  if (!filterLabels || filterLabels.length === 0) return [];

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ExtractError(
      CODES.CONFIG,
      'GEMINI_API_KEY environment variable is not set',
      'The server is not configured for AI extraction. Set GEMINI_API_KEY in server/.env.',
    );
  }

  const modelId = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  // Build a compact recipe summary for the prompt.
  const title = recipe.title ?? '';
  const description = recipe.description ?? '';
  const ingredientLines = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((i) => `${i.qty ? i.qty + ' ' : ''}${i.name}`).join(', ')
    : '';
  const stepLines = Array.isArray(recipe.steps) ? recipe.steps.join(' ') : '';
  const recipeSummary = [
    title && `Title: ${title}`,
    description && `Description: ${description}`,
    ingredientLines && `Ingredients: ${ingredientLines}`,
    stepLines && `Steps: ${stepLines}`,
  ]
    .filter(Boolean)
    .join('\n');

  const prompt =
    `You tag a recipe with filters from a FIXED list.\n\n` +
    `Recipe:\n${recipeSummary}\n\n` +
    `Available filters: ${JSON.stringify(filterLabels)}\n\n` +
    `Return ONLY a JSON array (no code fences, no prose, no explanation) of the filters ` +
    `from the list that clearly apply to this recipe. Use ONLY exact strings from the list; ` +
    `do not invent, rename, or add new ones. Return [] if none apply.`;

  // Lazy-import Gemini SDK (same pattern as extractWithGemini).
  let GoogleGenerativeAI;
  try {
    const sdk = await import('@google/generative-ai');
    GoogleGenerativeAI = sdk.GoogleGenerativeAI;
  } catch (err) {
    throw new ExtractError(
      CODES.CONFIG,
      `Failed to import @google/generative-ai: ${err.message}`,
      'The AI library is not installed on the server. Run npm install in server/.',
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId });

  let rawText;
  try {
    const result = await withTimeout(
      model.generateContent(prompt),
      TIMEOUT_MS,
    );
    rawText = result.response.text();
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    // Best-effort: network/timeout failures return [] rather than crashing.
    console.warn('[assignFilters] Gemini call failed:', err.message);
    return [];
  }

  // Defensive parse: strip fences, find [...], JSON.parse, then filter to
  // only canonical labels (case-insensitive check, return the canonical form).
  try {
    let cleaned = rawText
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```\s*$/im, '')
      .trim();

    // Slice from first [ to last ] to handle any surrounding prose.
    const start = cleaned.indexOf('[');
    const end   = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    cleaned = cleaned.slice(start, end + 1);

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return canonicalizeLabels(parsed, filterLabels);
  } catch {
    console.warn('[assignFilters] Could not parse Gemini response; returning []');
    return [];
  }
}

// We import the Gemini SDK lazily inside the function so that missing deps
// surface as a clear CONFIG error rather than a module-load crash.

const DEFAULT_MODEL   = 'gemini-3.1-flash-lite';
const TIMEOUT_MS      = parseInt(process.env.GEMINI_TIMEOUT_MS ?? '', 10) || 120_000;
const MAX_FILE_BYTES  = 200 * 1024 * 1024; // 200 MB guard

/** Map raw model-returned labels to the canonical user labels (case-insensitive, de-duped). */
function canonicalizeLabels(rawLabels, allowed) {
  if (!Array.isArray(rawLabels) || !Array.isArray(allowed) || allowed.length === 0) return [];
  const map = new Map(allowed.map((l) => [String(l).toLowerCase(), l]));
  const seen = new Set();
  const out = [];
  for (const item of rawLabels) {
    if (typeof item !== 'string') continue;
    const canon = map.get(item.toLowerCase().trim());
    if (canon && !seen.has(canon)) { seen.add(canon); out.push(canon); }
  }
  return out;
}

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
function buildPrompt(caption, filterLabels = []) {
  const captionSection = caption
    ? `\n\nVIDEO CAPTION / DESCRIPTION AND AUTHOR COMMENTS (creators often post the full written recipe here — treat this as a primary source):\n"""\n${caption.slice(0, 6000)}\n"""`
    : '';

  const hasFilters = Array.isArray(filterLabels) && filterLabels.length > 0;
  const filtersSection = hasFilters
    ? `\n\nAVAILABLE FILTERS (a fixed list the user maintains): ${JSON.stringify(filterLabels)}`
    : '';
  const filtersShapeLine = hasFilters
    ? '\n  "filters": ["string — labels chosen ONLY from AVAILABLE FILTERS"],'
    : '';
  const filtersRule = hasFilters
    ? '\n\nAlso set "filters": an array of labels chosen ONLY from the AVAILABLE FILTERS list above that clearly apply to this dish. Use exact strings from that list; do not invent, rename, or add. Empty array if none apply.'
    : '';

  return `You are a recipe extraction assistant. Watch the cooking video and extract a complete recipe.${captionSection}${filtersSection}

Return ONLY valid JSON — no prose, no markdown code fences (no \`\`\`json), no commentary before or after. The JSON must match this exact shape:

{
  "title": "string",
  "description": "string — one enticing sentence about the dish",
  "minutes": 0,
  "servings": 0,
  "cuisine": "string — e.g. Italian, Mexican, American",
  "category": "string — one of Dinner, Breakfast, Dessert, or another category",
  "protein": ["string — main protein(s); usually one, but list multiple for e.g. surf & turf"],
  "carb": ["string — main carb(s); usually one, list multiple if the dish genuinely has more"],
  "hero_seconds": 0,${filtersShapeLine}
  "ingredients": [{ "name": "string", "qty": "string" }],
  "steps": [{ "text": "string", "t": 0 }]
}

Rules you must follow:
1. CONVERT ALL MEASUREMENTS TO IMPERIAL. Weights → oz or lb. Volumes → cups, tbsp, tsp, or fl oz. Oven temperatures → °F. Lengths → inches. For dry goods given in grams, use standard culinary volume equivalents (e.g. 120 g flour ≈ 1 cup; 15 g butter ≈ 1 tbsp). For liquids given in ml, convert directly (240 ml ≈ 1 cup; 15 ml ≈ 1 tbsp; 5 ml ≈ 1 tsp). Amounts should be estimates the user can correct.
2. The caption/description and author comments above OFTEN contain the full written recipe. Treat them as a PRIMARY source: if ingredients, quantities, or steps are written there, use them (reconciled with what the video shows) rather than guessing. Prefer written amounts over estimating from the video.
3. Do NOT invent ingredients. Only include what is shown, said, or written in the caption. If something is unclear, omit it rather than guess. If no recipe can be identified, return {"title":"","description":"","minutes":0,"servings":0,"cuisine":"","category":"","protein":[],"carb":[],"hero_seconds":0,"ingredients":[],"steps":[]}.
4. Target 5–9 ingredients and 4–7 concise imperative steps (e.g. "Mix flour and butter until crumbly."). Each step is an object { "text": "...", "t": 0 } — "text" is the imperative instruction.
5. "qty" is a display string like "2 cups", "1 tbsp", "1 lb", "350°F", or "" if unknown.
6. "protein" and "carb" are ARRAYS of the dish's MAIN protein(s) and MAIN carb(s) — the defining ingredients, not incidental ones (an omelette's protein is ["Egg"]; banana bread's protein is [] even though it contains eggs). USUALLY ONE each, but include multiple when the dish genuinely centers on more than one (surf & turf → ["Beef","Shrimp"]; a bowl served over both rice and noodles → ["Rice","Noodles"]). Use short canonical words (Chicken, Beef, Pork, Turkey, Lamb, Shrimp, Fish, Tofu, Egg, Beans; Rice, Noodles, Pasta, Bread, Potato, Quinoa, Couscous). Empty array [] if the dish has no main protein or no main carb.
7. "minutes" and "servings" must be integers (not strings, not null). Default to 0 if unknown.
8. "hero_seconds": the timestamp in SECONDS (decimals allowed) of the frame showing the FINISHED, fully PLATED final dish — the completed result, NOT a cooking step, raw ingredients, or a mid-process shot. In cooking videos this is almost always near the END (the final reveal / beauty shot of the plated food). Choose the clearest, most appetizing frame of the completed dish. Use 0 only if the video truly never shows a finished plated result.
9. Each step's "t" is the START of that step's segment in the video — the timestamp in SECONDS (decimals allowed) where the ingredients or actions for THAT step FIRST begin to appear on screen, such that starting playback at "t" shows the entire step performed from its beginning. Do NOT use the moment the step's main action peaks or a single verb happens (e.g. for "Whisk together lemon juice, zest, honey and garlic," "t" is when those ingredients first start going into the bowl, NOT when whisking starts). Timestamps must be non-decreasing across steps (each step's "t" >= the previous step's "t"). Use 0 only if the step's segment truly isn't shown in the video.
10. Return nothing outside the JSON object.${filtersRule}`;
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
  const num  = (v, fallback = null) => {
    const n = parseFloat(String(v ?? ''));
    return isFinite(n) && n >= 0 ? n : fallback;
  };
  // Main protein(s)/carb(s): accept an array or a single string.
  const strArr = (v) =>
    Array.isArray(v)
      ? v.map((x) => str(x)).filter(Boolean)
      : (typeof v === 'string' && v.trim() ? [v.trim()] : []);

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

  // Normalize steps: accept EITHER the new { text, t } object shape OR a
  // legacy plain string (fallback models in the chain may not comply).
  // steps/stepTimes are built in lockstep so they stay the same length.
  const stepTime = (v) => {
    const n = parseFloat(String(v ?? ''));
    return isFinite(n) && n >= 0 ? n : 0;
  };
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  const steps = [];
  const stepTimes = [];
  for (const item of rawSteps) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const text = str(item.text);
      if (!text) continue;
      steps.push(text);
      stepTimes.push(stepTime(item.t));
    } else if (typeof item === 'string') {
      const text = item.trim();
      if (!text) continue;
      steps.push(text);
      stepTimes.push(0);
    }
  }

  return {
    title:       str(obj.title),
    description: str(obj.description),
    minutes:     int(obj.minutes),
    servings:    int(obj.servings),
    cuisine:     str(obj.cuisine),
    category:    str(obj.category),
    protein:     strArr(obj.protein),
    carb:        strArr(obj.carb),
    heroSeconds: num(obj.hero_seconds),
    filters: strArr(obj.filters),
    ingredients,
    steps,
    stepTimes,
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

/**
 * Classify a raw Gemini SDK error. 429/quota and 503/overload become
 * RATE_LIMITED (with a truthful message); anything else is a generic FETCH_FAILED.
 */
function classifyGeminiError(err) {
  const msg = String(err?.message || '');
  if (/\b429\b|quota|too many requests|resource[_ ]?exhausted/i.test(msg)) {
    return new ExtractError(CODES.RATE_LIMITED, `Gemini quota/rate limit: ${msg}`);
  }
  if (/\b503\b|overloaded|high demand|unavailable/i.test(msg)) {
    return new ExtractError(
      CODES.RATE_LIMITED, `Gemini overloaded: ${msg}`,
      'The AI model is busy right now (high demand). Try again in a moment.',
    );
  }
  return new ExtractError(CODES.FETCH_FAILED, `Gemini generateContent failed: ${msg}`);
}

/**
 * Ordered list of models to try. Each free-tier model has its OWN daily quota
 * bucket, so on a 429/503 we fall through to the next — maximizing free-tier
 * throughput without billing. Override with GEMINI_MODELS (comma-separated),
 * or set the primary with GEMINI_MODEL.
 */
function resolveModelChain() {
  if (process.env.GEMINI_MODELS) {
    return process.env.GEMINI_MODELS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallbacks = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  return [...new Set([primary, ...fallbacks])];
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
export async function extractWithGemini(filePath, mimeType, caption = '', filterLabels = []) {
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
  const modelChain = resolveModelChain();

  const filePart = {
    fileData: {
      mimeType:  uploadedFile.mimeType,
      fileUri:   uploadedFile.uri,
    },
  };

  /**
   * Call the model with fallback: try each model in the chain; on a 429/503
   * (RATE_LIMITED) fall through to the next free-tier model (separate quota
   * buckets). Non-rate-limit errors stop immediately.
   * @param {string} promptText
   * @returns {Promise<string>}
   */
  async function callModel(promptText) {
    let lastRateErr;
    for (const id of modelChain) {
      try {
        const model = genAI.getGenerativeModel({ model: id });
        const result = await withTimeout(
          model.generateContent([promptText, filePart]),
          TIMEOUT_MS,
        );
        return result.response.text();
      } catch (err) {
        const e = err instanceof ExtractError ? err : classifyGeminiError(err);
        // Skip to the next model on a rate-limit/overload OR a model-specific issue
        // (unknown model, or one that can't handle this input) — try another one.
        const skippable = e.code === CODES.RATE_LIMITED ||
          (!(err instanceof ExtractError) &&
            /\b(400|404)\b|not found|not supported|does not support|invalid argument/i.test(String(err?.message || '')));
        if (skippable) { lastRateErr = e; continue; }
        throw e;
      }
    }
    throw lastRateErr ?? new ExtractError(CODES.RATE_LIMITED, 'All Gemini models are rate-limited or unavailable.');
  }

  // ── First attempt ─────────────────────────────────────────────────────────
  let rawText;
  try {
    rawText = await callModel(buildPrompt(caption, filterLabels));
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw classifyGeminiError(err);
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
  // Fold filter assignment into this single call: keep only labels from the user's list.
  draft.filters = canonicalizeLabels(draft.filters, filterLabels);

  // Clamp step timestamps to the video's actual duration when known (ffprobe
  // only — no extra Gemini call). Non-finite/negative values are already
  // coerced to 0 by coerceDraft; this just bounds the upper end.
  try {
    const duration = await probeDuration(filePath);
    if (duration != null) {
      draft.stepTimes = draft.stepTimes.map((t) => Math.min(t, duration));
    }
  } catch {
    // probeDuration never rejects, but stay defensive — clamping is best-effort.
  }

  // ── Guard: no recipe detected ─────────────────────────────────────────────
  if (draft.ingredients.length === 0 && draft.steps.length === 0) {
    throw new ExtractError(CODES.NO_RECIPE, 'Model returned no ingredients and no steps');
  }

  return draft;
}
