// Thin wrapper around the backend REST API. Uses relative /api URLs so the
// Vite dev proxy (and, in production, same-origin hosting) handles routing.

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
    add: (name, qty = '') =>
      request('/shopping-list', { method: 'POST', body: JSON.stringify({ name, qty }) }),
    fromRecipe: (recipeId) =>
      request(`/shopping-list/from-recipe/${recipeId}`, { method: 'POST' }),
    toggle: (id) =>
      request(`/shopping-list/${id}`, { method: 'PATCH', body: JSON.stringify({}) }),
    update: (id, fields) =>
      request(`/shopping-list/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
    remove: (id) => request(`/shopping-list/${id}`, { method: 'DELETE' }),
    clearChecked: () => request('/shopping-list/clear-checked', { method: 'POST' }),
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

  // AI Extract
  extract: {
    fromUrl: (url) =>
      request('/extract', { method: 'POST', body: JSON.stringify({ url }) }),
    fromFile: (file) => {
      const fd = new FormData();
      fd.append('video', file);
      return fetch('/api/extract/upload', { method: 'POST', body: fd }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const err = new Error(body?.error || `Upload failed (${res.status})`);
          err.code = body?.code || null;
          err.status = res.status;
          throw err;
        }
        return body;
      });
    },
  },
};
