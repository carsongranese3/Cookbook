/**
 * Text formatting helpers.
 */

/**
 * Capitalize the first letter of every word, for display.
 *
 * Only ever *upper*-cases a word-initial letter — the rest of each word is left
 * exactly as stored, so existing capitalization survives: "BBQ sauce" becomes
 * "BBQ Sauce", not "Bbq Sauce". Hyphens, slashes and opening parens count as
 * word boundaries ("extra-virgin" → "Extra-Virgin").
 *
 * Display-only: recipe ingredients are stored however they were typed or
 * extracted, and this formats them at render time.
 */
export function titleCase(str) {
  if (!str) return str;
  return String(str).replace(
    /(^|[\s\-/([])(\p{Ll})/gu,
    (_, boundary, ch) => boundary + ch.toUpperCase()
  );
}
