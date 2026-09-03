// Thin wrapper around the backend REST API. Uses relative /api URLs so the
// Vite dev proxy (and, in production, same-origin hosting) handles routing.

// Multipart POST — used by the uploads (video extraction, receipt scan), which
// send a File rather than JSON. Mirrors `request`'s error shape.
async function upload(path, field, file) {
  const fd = new FormData();
  fd.append(field, file);
  const res = await fetch(`/api${path}`, { method: 'POST', body: fd });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.error || `Upload failed (${res.status})`);
    err.code = body?.code || null;
    err.status = res.status;
    throw err;
  }
  return body;
}

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`);
    err.code = body?.code || null;
    err.status = res.status;
    throw err;
  }
  return body;
}

// ── Recipes ────────────────────────────────────────────────────────────────
export const api = {
  // Recipes
  list: () => request('/recipes'),
  get: (id) => request(`/recipes/${id}`),
  create: (recipe) => request('/recipes', { method: 'POST', body: JSON.stringify(recipe) }),
  update: (id, recipe) => request(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(recipe) }),
  remove: (id) => request(`/recipes/${id}`, { method: 'DELETE' }),
  favorite: (id, value) =>
    request(`/recipes/${id}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify(value !== undefined ? { favorite: value } : {}),
    }),

  // Meal Plan
  mealPlan: {
    get: (start, end) =>
      request(`/meal-plan${start && end ? `?start=${start}&end=${end}` : ''}`),
    add: (day, recipe_id) =>
      request('/meal-plan', { method: 'POST', body: JSON.stringify({ day, recipe_id }) }),
    remove: (id) => request(`/meal-plan/${id}`, { method: 'DELETE' }),
  },

  // Shopping List
  shopping: {
    get: () => request('/shopping-list'),
    add: (name, qty = '', category) =>
      request('/shopping-list', {
        method: 'POST',
        body: JSON.stringify({ name, qty, ...(category ? { category } : {}) }),
      }),
    fromRecipe: (recipeId) =>
      request(`/shopping-list/from-recipe/${recipeId}`, { method: 'POST' }),
    toggle: (id) =>
      request(`/shopping-list/${id}`, { method: 'PATCH', body: JSON.stringify({}) }),
    update: (id, fields) =>
      request(`/shopping-list/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
    remove: (id) => request(`/shopping-list/${id}`, { method: 'DELETE' }),
    clearChecked:  () => request('/shopping-list/clear-checked', { method: 'POST' }),
    moveToPantry:  () => request('/shopping-list/move-to-pantry', { method: 'POST' }),
    // Price estimation: store choice is server-persisted (shared across devices).
    // A price is a property of an item, not a snapshot of a press — see
    // docs/decisions.md "2026-09-02 — Prices persist per item, not per estimate".
    getStore: () => request('/shopping-list/store'),
    setStore: (store, zip = '') =>
      request('/shopping-list/store', {
        method: 'PUT',
        body: JSON.stringify({ store, zip }),
      }),
    // Read-only hydration from the price cache — never calls Gemini, ignores the
    // 30-day staleness window (a price must never silently vanish on reload).
    getPrices: () => request('/shopping-list/prices'),
    // Mutating: fills in unpriced items and refreshes anything older than 30 days.
    estimate: (refresh = false) =>
      request('/shopping-list/estimate', {
        method: 'POST',
        body: JSON.stringify(refresh ? { refresh: true } : {}),
      }),
    // Manual price edit. { price: number } sets it; { price: null } clears it back
    // to unpriced. Returns the same payload as getPrices() (docs: whole-list prices
    // + totals) so callers should replace price state wholesale, not patch one row.
    // 400 NO_STORE when no store is set — a price is keyed per store+ZIP.
    setPrice: (id, price) =>
      request(`/shopping-list/${id}/price`, {
        method: 'PUT',
        body: JSON.stringify({ price }),
      }),
  },

  // Pantry
  pantry: {
    list:       ()         => request('/pantry'),
    create:     (body)     => request('/pantry', { method: 'POST', body: JSON.stringify(body) }),
    update:     (id, body) => request(`/pantry/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove:     (id)       => request(`/pantry/${id}`, { method: 'DELETE' }),
    toShopping: (id)       => request(`/pantry/${id}/to-shopping`, { method: 'POST' }),
    // Receipt import: scan returns a DRAFT ({ store, items }) — nothing is saved
    // until the reviewed items come back through bulkAdd.
    scanReceipt: (file)    => upload('/pantry/receipt', 'receipt', file),
    bulkAdd:     (items)   => request('/pantry/bulk', { method: 'POST', body: JSON.stringify({ items }) }),
  },

  // Filters (user-defined)
  filters: {
    list:    ()           => request('/filters'),
    create:  (label)      => request('/filters', { method: 'POST', body: JSON.stringify({ label }) }),
    rename:  (id, label)  => request(`/filters/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
    remove:  (id)         => request(`/filters/${id}`, { method: 'DELETE' }),
    reorder: (ids)        => request('/filters/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },

  // Cook History
  history: {
    list:   ()        => request('/history'),
    create: (body)    => request('/history', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/history/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id)      => request(`/history/${id}`, { method: 'DELETE' }),
  },

  // Per-recipe AI filter assignment
  assignFilters: (id) => request(`/recipes/${id}/assign-filters`, { method: 'POST' }),
  assignAll:     ()   => request('/recipes/assign-all', { method: 'POST' }),

  // Video frame picker — returns { candidates: string[] } of JPEG data URIs
  recipeFrames: (id) => request(`/recipes/${id}/frames`, { method: 'POST' }),

  // AI Extract
  extract: {
    fromUrl: (url) =>
      request('/extract', { method: 'POST', body: JSON.stringify({ url }) }),
    fromFile: (file) => upload('/extract/upload', 'video', file),
  },
};
