/**
 * Filter bar helpers for the Library screen.
 *
 * Filters are now a USER-DEFINED list fetched from GET /api/filters.
 * Recipes carry `filters: string[]` (assigned filter labels).
 *
 * Filter id format used in the bar:
 *   "all"       — always present; clears selection
 *   "favorites" — present when ≥1 recipe is favorited
 *   <label>     — one per user-defined filter (id IS the label)
 */

// ── Build available filter objects for the bar ────────────────────────────────

/**
 * Build the bar's available filters from the server's filter list + recipes.
 *
 * @param {Array<{id, label}>} userFilters  from GET /api/filters
 * @param {Array}              recipes      current recipe list
 * @returns {Array<{id: string, label: string, group: string}>}
 */
export function buildAvailableFilters(userFilters, recipes) {
  const out = [{ id: 'all', label: 'All', group: 'core' }];

  if (recipes.some((r) => r.favorite === true)) {
    out.push({ id: 'favorites', label: 'Favorites', group: 'core' });
  }

  for (const f of userFilters) {
    const label = (f.label || '').trim();
    if (label) out.push({ id: label, label, group: 'filter' });
  }

  return out;
}

// ── Single-filter matching ────────────────────────────────────────────────────

/**
 * Does this recipe match the given filter id?
 *   'all'       → true
 *   'favorites' → recipe.favorite === true
 *   <label>     → recipe.filters[] includes that label
 */
export function matchesFilter(recipe, filterId) {
  if (filterId === 'all')       return true;
  if (filterId === 'favorites') return recipe.favorite === true;
  return (recipe.filters || []).includes(filterId);
}

// ── Multi-select active-set matching ─────────────────────────────────────────

/**
 * matchesActiveSet(recipe, activeIds: string[]) → boolean
 *
 * Pure AND: a recipe must match EVERY active filter id.
 * Empty activeIds (or only 'all') → show everything.
 */
export function matchesActiveSet(recipe, activeIds) {
  const meaningful = activeIds.filter((id) => id !== 'all');
  if (meaningful.length === 0) return true;
  return meaningful.every((id) => matchesFilter(recipe, id));
}

// ── localStorage persistence for pinned ids ───────────────────────────────────

const STORAGE_KEY = 'cookbook.filterLayout';

/** Load pinned filter ids from localStorage. Returns null if nothing saved. */
export function loadPinnedIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the pinned filter ids to localStorage. */
export function savePinnedIds(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // quota exceeded or private mode — fail silently
  }
}

/**
 * Reconcile saved pinned ids with currently available filters.
 *
 * - Keep saved pins that still exist, in saved order.
 * - Drop saved pins that no longer exist (old protein/carb/category ids disappear).
 * - Newly-available filters go to the "rest" (not auto-pinned).
 * - Default (nothing saved): pin 'all' + up to 5 user-defined filters.
 */
export function reconcilePins(availableFilters, savedIds) {
  const availableSet = new Set(availableFilters.map((f) => f.id));

  if (savedIds === null) {
    const defaults = availableFilters
      .filter((f) => f.id === 'all' || f.group === 'filter')
      .slice(0, 6) // 'all' + up to 5 user filters
      .map((f) => f.id);
    return defaults.length > 0 ? defaults : ['all'];
  }

  const kept = savedIds.filter((id) => availableSet.has(id));
  if (kept.length === 0) return availableSet.has('all') ? ['all'] : [];
  return kept;
}
