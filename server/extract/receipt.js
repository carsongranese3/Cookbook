/**
 * server/extract/receipt.js
 *
 * Read a photo of a grocery receipt with Gemini and return the list of grocery
 * items on it, ready to be reviewed and bulk-added to the Pantry.
 *
 * Unlike video extraction this uses INLINE image data rather than the Files
 * API — receipt photos are a few MB at most, so a single request is faster and
 * avoids the upload/poll round-trip.
 *
 * Environment variables consumed:
 *   GEMINI_API_KEY    (required)
 *   GEMINI_MODEL(S)   (optional) — same model chain as video extraction
 *
 * Throws ExtractError with codes:
 *   CONFIG       — GEMINI_API_KEY is absent, or the SDK is not installed
 *   FETCH_FAILED — image unreadable / too large / Gemini call failed
 *   TIMEOUT      — request exceeded GEMINI_TIMEOUT_MS
 *   PARSE_FAILED — could not parse valid JSON after one retry
 *   NO_RECIPE    — the image parsed fine but held no grocery lines
 */

import { readFile }            from 'node:fs/promises';
import { ExtractError, CODES } from './errors.js';
import {
  TIMEOUT_MS,
  parseModelJson,
  withTimeout,
  classifyGeminiError,
  resolveModelChain,
} from './gemini.js';

// Inline request data is base64-encoded (~1.37x) and Gemini caps a non-Files
// request near 20 MB, so hold the raw image well under that.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * Build the receipt-reading prompt.
 * @param {string[]} categories  The pantry's fixed category list.
 * @returns {string}
 */
function buildReceiptPrompt(categories) {
  return `You read a photo of a grocery store receipt and list the groceries on it.

Return ONLY valid JSON — no prose, no markdown code fences (no \`\`\`json), no commentary before or after. The JSON must match this exact shape:

{
  "store": "string — the store name printed on the receipt, or \\"\\" if unreadable",
  "items": [
    { "name": "string", "qty": "string", "category": "string" }
  ]
}

Rules you must follow:
1. EXPAND ABBREVIATIONS into plain, recognisable grocery names. Receipts compress names heavily — "GV WHL MLK GAL" is "Whole milk", "BNLS SKNLS CHKN BRST" is "Boneless skinless chicken breast", "SHRP CHDR" is "Sharp cheddar". Use title case. Never output the raw receipt code as the name.
2. INCLUDE ONLY FOOD, DRINK, AND COOKING INGREDIENTS. Skip non-grocery lines entirely: subtotal, tax, total, change due, card/payment lines, loyalty and coupon lines, bag fees, deposits, store hours, phone numbers, barcodes, and non-food goods such as cleaning supplies, paper goods, toiletries, pet supplies, and pharmacy items.
3. "qty" is the amount PURCHASED, as a short display string: a count ("2"), a weight ("1.5 lb", "12 oz"), or a volume ("1 gal", "2 qt"). A receipt line like "3 @ 1.99" means qty "3"; a weighed line like "1.34 lb @ 4.99/lb" means qty "1.34 lb". Use "" only when the amount is genuinely unreadable — do not guess a number that is not on the receipt.
4. ALL MEASUREMENTS MUST BE IMPERIAL. Convert any metric amount: grams/kilograms → oz or lb, millilitres/litres → fl oz, cups, quarts, or gallons.
5. "category" must be EXACTLY one of these strings: ${JSON.stringify(categories)}. Choose the best fit for the food itself; use "Other" only when nothing else fits.
6. Do NOT invent items. Only list lines that actually appear on the receipt. If a line is too blurry to read, omit it rather than guess.
7. If the image is not a receipt, or contains no grocery lines at all, return {"store":"","items":[]}.
8. Return nothing outside the JSON object.`;
}

const RETRY_PROMPT =
  'Your previous response was not valid JSON. Return ONLY the JSON object, ' +
  'with no code fences, no prose, no trailing text. Start with { and end with }.';

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * Validate and coerce the model's raw output into receipt-item shape.
 * Unparseable entries are dropped rather than defaulted, so the review list
 * never shows a blank row.
 *
 * @param {unknown} raw
 * @param {string[]} categories  Allowed category strings.
 * @returns {{ store: string, items: {name: string, qty: string, category: string}[] }}
 */
function coerceReceipt(raw, categories) {
  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  // Case-insensitive lookup so a model returning "produce" still maps cleanly.
  const catMap = new Map(categories.map((c) => [c.toLowerCase(), c]));

  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const seen = new Set();
  const items = [];

  for (const entry of rawItems) {
    let name = '', qty = '', category = '';

    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      name     = str(entry.name);
      qty      = str(entry.qty);
      category = str(entry.category);
    } else if (typeof entry === 'string') {
      // Tolerate a plain string line — treat it all as the name.
      name = entry.trim();
    }

    if (!name) continue;

    // De-dupe within the receipt itself (the same item can be rung up twice).
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      name,
      qty,
      // null signals "the model gave us nothing usable" — the caller falls back
      // to the server's own keyword guess rather than dumping it in "Other".
      category: catMap.get(category.toLowerCase()) ?? null,
    });
  }

  return { store: str(obj.store), items };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a receipt image and return the grocery items on it.
 *
 * @param {string} filePath    Absolute path to the receipt image.
 * @param {string} mimeType    Image MIME type, e.g. 'image/jpeg'.
 * @param {string[]} categories Pantry category list the model must choose from.
 * @returns {Promise<{ store: string, items: {name: string, qty: string, category: string|null}[] }>}
 */
export async function extractReceipt(filePath, mimeType, categories = []) {
  // ── Guard: API key ────────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ExtractError(
      CODES.CONFIG,
      'GEMINI_API_KEY environment variable is not set',
      'The server is not configured for AI extraction. Set GEMINI_API_KEY in server/.env.',
    );
  }

  // ── Read the image ────────────────────────────────────────────────────────
  let base64;
  try {
    const buf = await readFile(filePath);
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new ExtractError(
        CODES.FETCH_FAILED,
        `Receipt image too large: ${buf.length} bytes (limit ${MAX_IMAGE_BYTES})`,
        'That photo is too large. Try a smaller image.',
      );
    }
    base64 = buf.toString('base64');
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(
      CODES.FETCH_FAILED,
      `Cannot read receipt file: ${err.message}`,
      'Could not read that image. Try taking the photo again.',
    );
  }

  // ── Lazy-import Gemini SDK ────────────────────────────────────────────────
  // Dynamic so a missing package surfaces as CONFIG rather than a load crash.
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

  const genAI      = new GoogleGenerativeAI(apiKey);
  const modelChain = resolveModelChain();
  const imagePart  = { inlineData: { data: base64, mimeType } };

  /**
   * Call the model with fallback: on a 429/503 (or a model that can't take
   * this input) fall through to the next model in the chain — each free-tier
   * model has its own quota bucket.
   * @param {string} promptText
   * @returns {Promise<string>}
   */
  async function callModel(promptText) {
    let lastRateErr;
    for (const id of modelChain) {
      try {
        const model = genAI.getGenerativeModel({ model: id });
        const result = await withTimeout(
          model.generateContent([promptText, imagePart]),
          TIMEOUT_MS,
        );
        return result.response.text();
      } catch (err) {
        const e = err instanceof ExtractError ? err : classifyGeminiError(err);
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
    rawText = await callModel(buildReceiptPrompt(categories));
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw classifyGeminiError(err);
  }

  // ── Parse, retrying once with a JSON-only prompt ──────────────────────────
  let parsed;
  try {
    parsed = parseModelJson(rawText);
  } catch (_parseErr) {
    console.warn('[receipt] First parse failed; retrying with JSON-only prompt.');
    let retryText;
    try {
      retryText = await callModel(RETRY_PROMPT);
    } catch (err) {
      if (err instanceof ExtractError) throw err;
      throw new ExtractError(CODES.PARSE_FAILED, `Gemini retry failed: ${err.message}`);
    }
    try {
      parsed = parseModelJson(retryText);
    } catch (err2) {
      throw new ExtractError(
        CODES.PARSE_FAILED,
        `Could not parse Gemini JSON after retry: ${err2.message}`,
        'The AI returned an unreadable response. Try again, or add the items by hand.',
      );
    }
  }

  const receipt = coerceReceipt(parsed, categories);

  // ── Guard: nothing found ──────────────────────────────────────────────────
  if (receipt.items.length === 0) {
    throw new ExtractError(
      CODES.NO_RECIPE,
      'Model returned no receipt items',
      "Couldn't find any groceries on that image. Make sure the whole receipt is in frame and in focus.",
    );
  }

  return receipt;
}
