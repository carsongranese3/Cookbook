/**
 * server/extract/price.js
 *
 * Ask Gemini for a typical current shelf price for a batch of grocery-list
 * items at a named store (optionally near a ZIP). Text-only, no video/image
 * input — this is the cheapest possible Gemini call shape.
 *
 * These are AI ESTIMATES, never real quotes. The caller (server/index.js)
 * is responsible for caching results in the price_book table so repeat
 * presses cost zero Gemini calls; this module has no knowledge of the cache.
 *
 * Environment variables consumed:
 *   GEMINI_API_KEY    (required)
 *   GEMINI_MODEL(S)   (optional) — same model chain as video extraction
 *
 * Throws ExtractError with codes:
 *   CONFIG       — GEMINI_API_KEY is absent, or the SDK is not installed
 *   FETCH_FAILED — Gemini call failed for a reason other than rate limiting
 *   TIMEOUT      — request exceeded GEMINI_TIMEOUT_MS
 *   PARSE_FAILED — could not parse valid JSON after one retry
 *   RATE_LIMITED — every model in the chain is rate-limited or unavailable
 *
 * Never throws NO_RECIPE — a batch that Gemini could not price at all still
 * comes back as a (possibly all-null) priced list; there is nothing for the
 * user to fix about their own shopping list.
 */

import { ExtractError, CODES } from './errors.js';
import {
  TIMEOUT_MS,
  parseModelJson,
  withTimeout,
  classifyGeminiError,
  resolveModelChain,
} from './gemini.js';

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * Build the pricing prompt for one batch of items.
 * @param {{ i: number, name: string, qty: string }[]} entries
 * @param {string} store
 * @param {string} zip
 * @returns {string}
 */
function buildPricePrompt(entries, store, zip) {
  const locationClause = zip ? ` near ZIP ${zip}` : '';
  return `You estimate typical current grocery shelf prices at ${store}${locationClause}.

Here is a list of grocery items to price, as JSON:
${JSON.stringify(entries)}

Return ONLY valid JSON — no prose, no markdown code fences (no \`\`\`json), no commentary before or after. The JSON must match this exact shape:

{
  "items": [
    { "i": 0, "qty": "string", "price": 4.29 }
  ]
}

Rules you must follow:
1. Return one entry per input item, matched by its "i" index — do not renumber or reorder.
2. "price" is a plain number in USD — no currency symbol, no range, no text, no quotes around it.
3. Price the WHOLE quantity given in "qty", not a per-unit rate. For example "1 gal" means the price of one gallon, not a per-ounce price.
4. When an item's "qty" is empty (""), assume a typical single store purchase of that item, and set the response "qty" to what you assumed (e.g. "1 loaf", "1 dozen"). Otherwise echo the input "qty" back unchanged.
5. Give a typical current shelf price at ${store}${locationClause}. This is an approximation — do not refuse to answer just because you cannot know the exact price.
6. Use "price": null for anything you genuinely cannot price at all (e.g. the name is not a real grocery item). Do not guess wildly, and do not omit the entry — still include it with "price": null.
7. All quantities are already imperial (house rule) — do not convert units.
8. Return nothing outside the JSON object.`;
}

const RETRY_PROMPT =
  'Your previous response was not valid JSON. Return ONLY the JSON object, ' +
  'with no code fences, no prose, no trailing text. Start with { and end with }.';

/**
 * `TIMEOUT` and `FETCH_FAILED` are thrown by the shared helpers in
 * `gemini.js` (`withTimeout`, `classifyGeminiError`) with a video-extraction
 * flavored default message ("...upload the file instead"), which makes no
 * sense to someone who just pressed "Estimate cost". Reword those two codes
 * with a price-appropriate message without touching the shared
 * DEFAULT_MESSAGES map other callers (video/receipt extraction) still rely on.
 * @param {unknown} err
 * @returns {unknown} the same error, or a re-worded ExtractError
 */
function repriceMessage(err) {
  if (!(err instanceof ExtractError)) return err;
  if (err.code === CODES.TIMEOUT) {
    return new ExtractError(
      err.code, err.message,
      'The price check took too long. Try again in a moment.',
    );
  }
  if (err.code === CODES.FETCH_FAILED) {
    return new ExtractError(
      err.code, err.message,
      'Could not reach the AI service to estimate prices. Try again in a moment.',
    );
  }
  return err;
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

// Sanity limits shared with the caller's cache-write logic (see §5.4 of the
// spec): a price is only usable when finite, non-negative, and plausible.
export const MAX_SANE_PRICE = 999;

/**
 * Validate and coerce a raw price value.
 *
 * Deliberately rejects anything that isn't already a number or a non-empty
 * numeric-looking string BEFORE calling `Number()` on it — `Number(null)`,
 * `Number(false)`, `Number([])`, and `Number('')` are all `0`, which is
 * finite and in-range, so a naive `Number(raw)` would silently turn the
 * model's documented "I can't price this" signal (`null`, or an omitted/
 * blank price) into a real $0.00 that then gets cached for 30 days.
 *
 * A price of exactly `0` is, by default, also treated as unpriced — free
 * groceries don't exist for the AI path, so `0` only ever means "the model
 * didn't give us a real number." A human typing a manual price is a
 * different signal, though: `0` can genuinely mean "free / already have
 * this / not paying for it," so the manual price entry route
 * (`PUT /api/shopping-list/:id/price`) passes `{ allowZero: true }` to let
 * it through. Negative values and anything over `MAX_SANE_PRICE` are always
 * rejected regardless of `allowZero`.
 *
 * @param {unknown} raw
 * @param {{ allowZero?: boolean }} [opts]
 * @returns {number|null}
 */
export function coercePrice(raw, opts = {}) {
  const { allowZero = false } = opts;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'boolean') return null;
  if (typeof raw === 'object') return null; // arrays, plain objects, etc.
  if (typeof raw === 'string' && raw.trim() === '') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > MAX_SANE_PRICE) return null;
  if (n === 0 && !allowZero) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Validate and coerce the model's raw output into a map of index -> priced
 * entry. Unparseable / out-of-range entries are dropped (treated as unpriced
 * by the caller) rather than defaulted, matching the receipt module's
 * "drop, don't default" convention.
 *
 * @param {unknown} raw
 * @returns {Map<number, { qty: string, price: number|null }>}
 */
function coercePriceResponse(raw) {
  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 24) : '');

  const out = new Map();
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const i = Number(entry.i);
    if (!Number.isInteger(i) || i < 0) continue;
    // Extra/duplicate indices: last one wins (still never crashes).
    out.set(i, {
      qty:   str(entry.qty),
      price: coercePrice(entry.price),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Price a batch of grocery items at a named store.
 *
 * @param {{ i: number, name: string, qty: string }[]} entries  Stable-indexed
 *   items to price. Never send `checked` — it has no bearing on price.
 * @param {string} store  Display store string, e.g. "Trader Joe's".
 * @param {string} zip    "" or a 5-digit ZIP.
 * @returns {Promise<Map<number, { qty: string, price: number|null }>>}
 *   Keyed by the input "i". Missing indices (dropped by the model or by
 *   coercion) are simply absent from the map — the caller treats an absent
 *   index as unpriced.
 */
export async function estimatePrices(entries, store, zip) {
  if (!Array.isArray(entries) || entries.length === 0) return new Map();

  // ── Guard: API key ────────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ExtractError(
      CODES.CONFIG,
      'GEMINI_API_KEY environment variable is not set',
      'The server is not configured for AI extraction. Set GEMINI_API_KEY in server/.env.',
    );
  }

  // ── Lazy-import Gemini SDK ────────────────────────────────────────────────
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

  /**
   * Call the model with fallback: on a 429/503 (or a model that can't take
   * this input) fall through to the next model in the chain.
   * @param {string} promptText
   * @returns {Promise<string>}
   */
  async function callModel(promptText) {
    let lastRateErr;
    for (const id of modelChain) {
      try {
        const model = genAI.getGenerativeModel({ model: id });
        const result = await withTimeout(
          model.generateContent(promptText),
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

  const prompt = buildPricePrompt(entries, store, zip);

  // ── First attempt ─────────────────────────────────────────────────────────
  let rawText;
  try {
    rawText = await callModel(prompt);
  } catch (err) {
    if (err instanceof ExtractError) throw repriceMessage(err);
    throw repriceMessage(classifyGeminiError(err));
  }

  // ── Parse, retrying once with a JSON-only prompt ──────────────────────────
  let parsed;
  try {
    parsed = parseModelJson(rawText);
  } catch (_parseErr) {
    console.warn('[price] First parse failed; retrying with JSON-only prompt.');
    let retryText;
    try {
      retryText = await callModel(RETRY_PROMPT);
    } catch (err) {
      if (err instanceof ExtractError) throw repriceMessage(err);
      throw new ExtractError(CODES.PARSE_FAILED, `Gemini retry failed: ${err.message}`);
    }
    try {
      parsed = parseModelJson(retryText);
    } catch (err2) {
      throw new ExtractError(
        CODES.PARSE_FAILED,
        `Could not parse Gemini JSON after retry: ${err2.message}`,
        'The AI returned an unreadable response. Try again in a moment.',
      );
    }
  }

  return coercePriceResponse(parsed);
}
