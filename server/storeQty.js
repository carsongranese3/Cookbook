/**
 * storeQty — convert a recipe's cooking quantity into a "typical to buy at the
 * store" quantity, using deterministic rules (no AI). Anything we don't have a
 * rule for keeps its original recipe quantity, so a transfer never loses info.
 *
 * Used by POST /api/shopping-list/from-recipe/:recipeId.
 *
 * Design: parse the leading amount (handles "1/2", "1 1/2", "2.5", "2"), then
 * match on the ingredient NAME first (most reliable) and fall back to unit-based
 * rules. Ingredient-name guards keep "onion powder" out of the produce rule,
 * "garlic salt" out of the garlic-head rule, etc.
 */

// ── Amount parsing ────────────────────────────────────────────────────────────
function parseFraction(f) {
  const [a, b] = f.split('/').map(Number);
  return b ? a / b : NaN;
}

/** Parse a leading numeric amount: "2", "2.5", "1/2", "1 1/2" → Number (or null). */
function parseAmount(str) {
  const s = str.trim();
  if (!s) return null;
  if (/\s/.test(s)) {
    // mixed number "1 1/2"
    const [whole, frac] = s.split(/\s+/);
    const w = Number(whole);
    const fr = frac.includes('/') ? parseFraction(frac) : Number(frac);
    return Number.isFinite(w) && Number.isFinite(fr) ? w + fr : null;
  }
  if (s.includes('/')) {
    const v = parseFraction(s);
    return Number.isFinite(v) ? v : null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Split "3 cloves" → { amount: 3, unit: 'cloves' }; "1/2" → { amount: 0.5, unit: '' }. */
function parseQty(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  const m = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*(.*)$/);
  if (!m) return { amount: null, unit: s };
  return { amount: parseAmount(m[1]), unit: (m[2] || '').trim() };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const has = (name, ...words) => words.some((w) => name.includes(w));

// Guard words that mean a produce/aromatic name is really a spice or seasoning.
const isSeasoningForm = (name) =>
  has(name, 'powder', 'salt', 'flake', 'dried', 'ground', 'granulated');

/** Store units that are already shopping-friendly — leave the qty untouched. */
const STORE_UNITS = [
  'bottle', 'bag', 'can', 'jar', 'package', 'pack', 'box', 'bunch', 'head',
  'dozen', 'carton', 'container', 'loaf', 'stick', 'block', 'knob', 'clove ',
];

/** Produce sold as whole countable units. */
const COUNTABLE = [
  'onion', 'shallot', 'bell pepper', 'red pepper', 'green pepper',
  'jalapeno', 'jalapeño', 'serrano', 'chili', 'chile',
  'lemon', 'lime', 'orange', 'apple', 'pear', 'peach', 'avocado', 'banana',
  'carrot', 'potato', 'tomato', 'cucumber', 'zucchini', 'squash', 'eggplant',
  'mango', 'kiwi', 'beet', 'turnip', 'radish',
];

// A processed/liquid form of a produce item — must not be treated as whole
// countable produce (e.g. "chili sauce", "tomato paste", "lemon juice").
const isProcessedForm = (name) =>
  has(name, 'juice', 'sauce', 'paste', 'puree', 'oil', 'extract');

/**
 * @param {string} name  ingredient name, e.g. "garlic", "olive oil"
 * @param {string} qty   recipe quantity, e.g. "3 cloves", "2 tbsp", "1/2"
 * @returns {string} store-purchase quantity, e.g. "1 head", "1 bottle", "1"
 */
export function toStoreQuantity(name, qty) {
  const n = String(name ?? '').toLowerCase().trim();
  const original = String(qty ?? '').trim();
  const q = original.toLowerCase();
  const { amount, unit } = parseQty(original);

  // Already expressed in a store unit (e.g. "1 can", "2 bottles") — keep as-is.
  if (STORE_UNITS.some((u) => q.includes(u))) return original;

  // ── Aromatics & fresh produce sold by a fixed unit ──────────────────────────
  if (has(n, 'garlic') && !isSeasoningForm(n) && /clove/.test(q)) {
    return (amount ?? 0) > 8 ? '2 heads' : '1 head';
  }
  if (has(n, 'ginger') && !isSeasoningForm(n)) return '1 knob';
  if (has(n, 'scallion', 'green onion', 'spring onion')) return '1 bunch';
  if (has(n, 'celery')) return '1 bunch';
  if (has(n, 'cabbage', 'lettuce')) return '1 head';
  // Fresh soft herbs (skip dried forms, which are spices)
  if (!isSeasoningForm(n) && has(n, 'cilantro', 'parsley', 'basil', 'mint', 'dill', 'chives', 'rosemary', 'thyme', 'sage')) {
    // Only treat as fresh when it isn't clearly a dried spice measured in tsp/tbsp
    if (!/tsp|teaspoon|tbsp|tablespoon/.test(unit)) return '1 bunch';
  }

  // ── Juices — buy the bottled/carton product, not whole fruit ─────────────────
  if (has(n, 'juice')) {
    if (has(n, 'lemon', 'lime')) return '1 bottle';
    if (has(n, 'orange', 'apple', 'cranberry', 'tomato', 'pineapple')) return '1 carton';
    // otherwise fall through and keep the recipe qty
  }

  // ── Eggs — sold by the dozen ─────────────────────────────────────────────────
  if (has(n, 'egg') && !has(n, 'eggplant')) return '1 dozen';

  // ── Countable produce — round the count up to whole units ────────────────────
  if (!isSeasoningForm(n) && !isProcessedForm(n) && COUNTABLE.some((p) => n.includes(p))) {
    const count = amount != null ? Math.max(1, Math.ceil(amount)) : 1;
    return String(count);
  }

  // ── Oils, vinegars, liquid condiments → 1 bottle ─────────────────────────────
  if (has(n, 'oil', 'vinegar', 'soy sauce', 'fish sauce', 'worcestershire',
          'hot sauce', 'honey', 'syrup', 'vanilla', 'wine', 'mirin', 'sesame oil',
          'mayo', 'mayonnaise', 'ketchup', 'mustard')) {
    return '1 bottle';
  }

  // ── Wrapped breads (checked before flour so "flour tortilla" → a pack) ───────
  if (has(n, 'tortilla', 'pita', 'naan', 'bun', 'bagel', 'english muffin')) return '1 pack';

  // ── Dry pantry staples measured loose → 1 bag ────────────────────────────────
  if (has(n, 'flour', 'sugar', 'rice', 'oats', 'cornmeal', 'cornstarch',
          'corn starch', 'breadcrumb', 'bread crumb', 'quinoa', 'couscous',
          'lentil', 'dried bean')) {
    return '1 bag';
  }

  // ── Loaf breads (breadcrumbs/bread-flour handled above, so this is real bread) ─
  if (has(n, 'bread', 'baguette', 'ciabatta', 'sourdough', 'brioche')) return '1 loaf';

  // ── Nut butters → 1 jar (checked before dairy butter) ────────────────────────
  if (has(n, 'peanut butter', 'almond butter', 'nut butter', 'cashew butter')) return '1 jar';

  // ── Dairy ────────────────────────────────────────────────────────────────────
  if (has(n, 'butter')) return '1 pack';
  if (has(n, 'buttermilk', 'heavy cream', 'half and half', 'half-and-half')) return '1 carton';
  if (/\bmilk\b/.test(n)) return '1 carton';
  if (has(n, 'cream') && !has(n, 'ice cream', 'cream cheese')) return '1 carton';
  if (has(n, 'sour cream', 'yogurt', 'cream cheese', 'cottage cheese')) return '1 container';
  if (has(n, 'cheese')) return '1 block';

  // ── Broth / stock → 1 carton ─────────────────────────────────────────────────
  if (has(n, 'broth', 'stock')) return '1 carton';

  // ── Spices & seasonings measured in tsp/tbsp → 1 jar ─────────────────────────
  const SPICES = [
    'cumin', 'paprika', 'oregano', 'cinnamon', 'chili powder', 'garlic powder',
    'onion powder', 'cayenne', 'turmeric', 'coriander', 'nutmeg', 'clove',
    'cardamom', 'allspice', 'pepper flake', 'red pepper flake', 'bay leaf',
    'curry powder', 'garam masala', 'italian seasoning', 'black pepper',
  ];
  if (SPICES.some((s) => n.includes(s))) return '1 jar';
  if (/\bsalt\b/.test(n)) return '1 container';

  // ── No rule — keep the recipe quantity (may be empty) ────────────────────────
  return original;
}

// ============================================================================
// Accumulated required-amount tracking
// ----------------------------------------------------------------------------
// Each shopping item hides a running "required" total (how much the recipes so
// far actually call for). When more of the same item is added, we sum the
// required amount and, for items whose store unit has a sensible capacity
// (a bottle of oil, a head of garlic, whole produce, a carton, weight), bump
// the visible buy amount once the total outgrows what's in the cart.
//
// Only same-dimension amounts combine (you can't add "2 tbsp" to "1 lb"), and
// items whose recipe unit and store unit don't share a dimension (flour is
// measured in cups but bought by the bag) are left "fixed" — never bumped.
// ============================================================================

// Canonical bases: volume → fluid ounces, weight → ounces, count/clove → each.
const VOLUME_UNITS = {
  tsp: 1 / 6, teaspoon: 1 / 6, teaspoons: 1 / 6,
  tbsp: 0.5, tablespoon: 0.5, tablespoons: 0.5,
  cup: 8, cups: 8, pint: 16, pints: 16, quart: 32, quarts: 32,
  gallon: 128, gallons: 128, ml: 0.033814, milliliter: 0.033814, milliliters: 0.033814,
  l: 33.814, liter: 33.814, liters: 33.814, litre: 33.814,
};
const WEIGHT_UNITS = {
  oz: 1, ounce: 1, ounces: 1, lb: 16, lbs: 16, pound: 16, pounds: 16,
  g: 0.035274, gram: 0.035274, grams: 0.035274, kg: 35.274, kilogram: 35.274, kilograms: 35.274,
};

/**
 * Parse a recipe quantity into a canonical magnitude + dimension.
 * @returns {{ base: number, dim: 'volume'|'weight'|'clove'|'count' }}
 *   base is fl oz (volume), oz (weight), or a plain count (count/clove).
 *   A missing/blank amount yields base 0.
 */
export function parseRequired(qty) {
  const { amount, unit } = parseQty(qty);
  const amt = amount ?? 0;
  const u = unit.trim();

  if (/^cloves?\b/.test(u)) return { base: amt, dim: 'clove' };
  if (/fl\.?\s?oz|fluid ounce/.test(u)) return { base: amt, dim: 'volume' };

  const firstWord = u.split(/[\s,.]/)[0];
  if (firstWord in VOLUME_UNITS) return { base: amt * VOLUME_UNITS[firstWord], dim: 'volume' };
  if (firstWord in WEIGHT_UNITS) return { base: amt * WEIGHT_UNITS[firstWord], dim: 'weight' };

  // No recognizable unit (or a size word like "large") → treat as a count.
  return { base: amt, dim: 'count' };
}

/**
 * The store unit an ingredient is bought in, with the capacity of one unit in
 * the matching canonical base. Returns null for "fixed" items we never bump.
 */
function storeProfile(name) {
  const n = String(name ?? '').toLowerCase().trim();

  if (has(n, 'garlic') && !isSeasoningForm(n)) {
    return { dim: 'clove', capacity: 10, unit: 'head', plural: 'heads' };
  }
  if (has(n, 'egg') && !has(n, 'eggplant')) {
    return { dim: 'count', capacity: 12, unit: 'dozen', plural: 'dozen' };
  }
  if (!isSeasoningForm(n) && !isProcessedForm(n) && COUNTABLE.some((p) => n.includes(p))) {
    return { dim: 'count', capacity: 1, unit: '', plural: '' };
  }
  // Liquids bought in a bottle (~16 fl oz).
  if (has(n, 'oil', 'vinegar', 'soy sauce', 'fish sauce', 'worcestershire',
          'hot sauce', 'honey', 'syrup', 'vanilla', 'wine', 'mirin',
          'mayo', 'mayonnaise', 'ketchup', 'mustard')) {
    return { dim: 'volume', capacity: 16, unit: 'bottle', plural: 'bottles' };
  }
  // Liquids bought in a carton (~1 quart).
  if (has(n, 'broth', 'stock', 'buttermilk', 'heavy cream', 'half and half', 'half-and-half')
      || /\bmilk\b/.test(n)
      || (has(n, 'cream') && !has(n, 'ice cream', 'cream cheese'))) {
    return { dim: 'volume', capacity: 32, unit: 'carton', plural: 'cartons' };
  }
  return null; // fixed — bag/jar/pack/loaf/etc. never auto-bump
}

/**
 * Whether an ingredient's buy amount should grow with its required total.
 * Weight-measured items always are; others only when the store unit shares the
 * required amount's dimension (a bottle for a volume, a head for cloves, …).
 */
export function isBumpable(name, dim) {
  if (dim === 'weight') return true;
  const p = storeProfile(name);
  return !!p && p.dim === dim;
}

/** Pluralize a whole count against a store unit ("1 head", "2 heads", "3"). */
function unitString(count, profile) {
  if (!profile.unit) return String(count); // countable produce → bare number
  return `${count} ${count === 1 ? profile.unit : profile.plural}`;
}

/**
 * The buy amount for an ingredient given its accumulated required total.
 * Bumpable items are computed from the total; weight items become a rounded
 * pound figure; everything else falls back to the plain store quantity.
 *
 * @param {string} name
 * @param {number} reqBase   accumulated required magnitude
 * @param {string} reqDim    'volume' | 'weight' | 'clove' | 'count'
 * @param {string} fallbackQty  original recipe qty, used for fixed items
 * @returns {string}
 */
export function computeBuyAmount(name, reqBase, reqDim, fallbackQty) {
  // Weight-measured items (meat, produce by the pound): buy the rounded weight.
  if (reqDim === 'weight' && reqBase > 0) {
    const lb = Math.max(0.5, Math.round((reqBase / 16) * 2) / 2); // nearest 1/2 lb
    return `${Number.isInteger(lb) ? lb : lb.toFixed(1)} lb`;
  }

  const profile = storeProfile(name);
  if (profile && profile.dim === reqDim && reqBase > 0) {
    const count = Math.max(1, Math.ceil(reqBase / profile.capacity));
    return unitString(count, profile);
  }

  // Fixed item, dimension mismatch, or no usable amount → plain store qty.
  return toStoreQuantity(name, fallbackQty);
}

export default toStoreQuantity;
