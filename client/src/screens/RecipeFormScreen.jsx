import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function RecipeFormScreen({ recipe, onSave, onCancel, embedded }) {
  const isEdit = Boolean(recipe);

  const [title, setTitle]             = useState(recipe?.title || '');
  const [description, setDescription] = useState(recipe?.description || '');
  const [cuisine, setCuisine]         = useState(recipe?.cuisine || '');
  const [category, setCategory]       = useState(recipe?.category || '');
  const [minutes, setMinutes]         = useState(recipe?.minutes != null ? String(recipe.minutes) : '');
  const [servings, setServings]       = useState(recipe?.servings != null ? String(recipe.servings) : '');
  const [rating, setRating]           = useState(recipe?.rating != null ? String(recipe.rating) : '');
  const [image, setImage]             = useState(recipe?.image || '');
  const [sourceUrl, setSourceUrl]     = useState(recipe?.source_url || '');

  // Ingredients: array of {name, qty}
  const [ingredients, setIngredients] = useState(
    (recipe?.ingredients && recipe.ingredients.length > 0)
      ? recipe.ingredients.map((ing) =>
          typeof ing === 'string' ? { name: ing, qty: '' } : { name: ing.name || '', qty: ing.qty || '' }
        )
      : [{ name: '', qty: '' }]
  );

  // Steps: array of strings
  const [steps, setSteps] = useState(
    (recipe?.steps && recipe.steps.length > 0) ? [...recipe.steps] : ['']
  );

  // Step video times: array of strings (seconds), index-aligned with steps
  const [stepTimes, setStepTimes] = useState(
    (recipe?.steps && recipe.steps.length > 0)
      ? recipe.steps.map((_, i) => {
          const t = recipe?.step_times?.[i];
          return (typeof t === 'number' && Number.isFinite(t)) ? String(t) : '';
        })
      : ['']
  );

  // Tags
  const [tags, setTags]         = useState(recipe?.tags || []);
  const [tagInput, setTagInput] = useState('');

  // Filters — user-defined list from server; checked = assigned to this recipe
  const [userFilters, setUserFilters]   = useState([]);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [checkedFilters, setCheckedFilters] = useState(
    () => new Set(Array.isArray(recipe?.filters) ? recipe.filters : [])
  );

  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // Fetch user-defined filter list
  useEffect(() => {
    let cancelled = false;
    api.filters.list()
      .then((data) => { if (!cancelled) setUserFilters(data || []); })
      .catch(() => { if (!cancelled) setUserFilters([]); })
      .finally(() => { if (!cancelled) setFiltersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Ingredient helpers ──────────────────────────────────────────────────
  function updateIng(i, field, val) {
    setIngredients((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: val };
      return next;
    });
  }

  function addIng() {
    setIngredients((prev) => [...prev, { name: '', qty: '' }]);
  }

  function removeIng(i) {
    setIngredients((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ── Step helpers ────────────────────────────────────────────────────────
  function updateStep(i, val) {
    setSteps((prev) => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  }

  function addStep() {
    setSteps((prev) => [...prev, '']);
    setStepTimes((prev) => [...prev, '']);
  }

  function removeStep(i) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
    setStepTimes((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateStepTime(i, val) {
    setStepTimes((prev) => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  }

  // ── Tag helpers ─────────────────────────────────────────────────────────
  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags((prev) => [...prev, t]);
    }
    setTagInput('');
  }

  function removeTag(t) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  function handleTagKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  // ── Filter toggle ───────────────────────────────────────────────────────
  function toggleFilter(label) {
    setCheckedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please give the recipe a title.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const cleanSteps = [];
      const cleanStepTimes = [];
      steps.forEach((s, i) => {
        if (s.trim()) {
          cleanSteps.push(s);
          const t = parseFloat(stepTimes[i]);
          cleanStepTimes.push(Number.isFinite(t) && t >= 0 ? t : 0);
        }
      });

      const data = {
        title:        title.trim(),
        description:  description.trim(),
        cuisine:      cuisine.trim(),
        category:     category.trim(),
        minutes:      minutes ? parseInt(minutes, 10) : null,
        servings:     servings ? parseInt(servings, 10) : null,
        rating:       rating ? parseFloat(rating) : null,
        image:        image.trim() || null,
        source_url:   sourceUrl.trim() || null,
        ingredients:  ingredients.filter((i) => i.name.trim()),
        steps:        cleanSteps,
        step_times:   cleanStepTimes,
        tags,
        filters:      [...checkedFilters],
      };
      await onSave(data);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className={embedded ? '' : 'page-pad'}>
      <form className="recipe-form" onSubmit={handleSubmit}>
        {!embedded && <h1 className="form-title">{isEdit ? 'Edit recipe' : 'New recipe'}</h1>}

        {error && (
          <div className="error-banner">{error}</div>
        )}

        {/* Title */}
        <div className="form-group">
          <label htmlFor="rf-title" className="form-label">Title <span aria-hidden>*</span></label>
          <input
            id="rf-title"
            className="form-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Garlic butter pasta"
            required
            autoFocus
          />
        </div>

        {/* Description */}
        <div className="form-group">
          <label htmlFor="rf-desc" className="form-label">Description <span className="form-hint">(one sentence)</span></label>
          <textarea id="rf-desc" className="form-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A quick and delicious…" />
        </div>

        {/* Meta row */}
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="rf-cuisine" className="form-label">Cuisine</label>
            <input id="rf-cuisine" className="form-input" value={cuisine} onChange={(e) => setCuisine(e.target.value)} placeholder="e.g. Italian" />
          </div>
          <div className="form-group">
            <label htmlFor="rf-category" className="form-label">Category</label>
            <select id="rf-category" className="form-input form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">— select —</option>
              <option value="Dinner">Dinner</option>
              <option value="Breakfast">Breakfast</option>
              <option value="Dessert">Dessert</option>
              <option value="Snack">Snack</option>
              <option value="Lunch">Lunch</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="rf-minutes" className="form-label">Total time (min)</label>
            <input id="rf-minutes" className="form-input" type="number" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="e.g. 30" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="rf-servings" className="form-label">Servings</label>
            <input id="rf-servings" className="form-input" type="number" min="1" value={servings} onChange={(e) => setServings(e.target.value)} placeholder="e.g. 4" />
          </div>
          <div className="form-group">
            <label htmlFor="rf-rating" className="form-label">Rating <span className="form-hint">(0–5)</span></label>
            <input id="rf-rating" className="form-input" type="number" step="0.1" min="0" max="5" value={rating} onChange={(e) => setRating(e.target.value)} placeholder="e.g. 4.5" />
          </div>
          <div className="form-group">
            <label htmlFor="rf-image" className="form-label">Image URL <span className="form-hint">(optional)</span></label>
            <input id="rf-image" className="form-input" type="url" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
          </div>
        </div>

        {/* Tags */}
        <div className="form-group">
          <label className="form-label">Tags <span className="form-hint">(press Enter to add)</span></label>
          <div className="tags-input-area" onClick={() => document.getElementById('rf-tag-input')?.focus()}>
            {tags.map((t) => (
              <span key={t} className="tag-pill">
                {t}
                <button type="button" onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`}>&times;</button>
              </span>
            ))}
            <input
              id="rf-tag-input"
              className="tags-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={addTag}
              placeholder={tags.length === 0 ? 'e.g. Vegetarian, Quick, Spicy' : ''}
            />
          </div>
        </div>

        {/* Filters checklist */}
        <div className="form-group">
          <div className="form-label">
            Filters
            <span className="form-hint"> (select all that apply)</span>
          </div>
          {filtersLoading ? (
            <p className="form-hint" style={{ margin: 0 }}>Loading filters…</p>
          ) : userFilters.length === 0 ? (
            <p className="form-hint" style={{ margin: 0 }}>
              No filters defined yet. Add them from the Library screen.
            </p>
          ) : (
            <div className="rf-filter-checklist" role="group" aria-label="Filters">
              {userFilters.map((f) => {
                const checked = checkedFilters.has(f.label);
                return (
                  <label key={f.id} className="rf-filter-chip">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFilter(f.label)}
                      aria-label={f.label}
                    />
                    <span className={`rf-filter-chip-label${checked ? ' checked' : ''}`}>
                      {f.label}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Ingredients */}
        <div className="form-group">
          <div className="form-label">Ingredients <span className="form-hint">(imperial units)</span></div>
          <div>
            {ingredients.map((ing, i) => (
              <div key={i} className="ing-edit-row">
                <input
                  className="ing-edit-input"
                  value={ing.name}
                  onChange={(e) => updateIng(i, 'name', e.target.value)}
                  placeholder="Ingredient name"
                  aria-label={`Ingredient ${i + 1} name`}
                />
                <input
                  className="ing-edit-input"
                  value={ing.qty}
                  onChange={(e) => updateIng(i, 'qty', e.target.value)}
                  placeholder="e.g. 2 cups"
                  aria-label={`Ingredient ${i + 1} quantity`}
                />
                <button
                  type="button"
                  className="ing-remove-btn"
                  onClick={() => removeIng(i)}
                  aria-label={`Remove ingredient ${i + 1}`}
                  disabled={ingredients.length === 1}
                >
                  &times;
                </button>
              </div>
            ))}
            <button type="button" className="btn-add-row" onClick={addIng}>+ Add ingredient</button>
          </div>
        </div>

        {/* Steps */}
        <div className="form-group">
          <div className="form-label">Method</div>
          {recipe?.has_video && (
            <p className="form-hint" style={{ margin: '0 0 8px' }}>
              Video time (seconds) each step starts — tune if the AI's timing is off.
            </p>
          )}
          <div className="steps-edit-area">
            {steps.map((step, i) => (
              <div key={i} className={`step-edit-row${recipe?.has_video ? ' has-time' : ''}`}>
                <div className="step-edit-num">{i + 1}</div>
                <textarea
                  className="form-textarea"
                  rows={2}
                  value={step}
                  onChange={(e) => updateStep(i, e.target.value)}
                  placeholder={`Step ${i + 1}…`}
                  aria-label={`Step ${i + 1}`}
                  style={{ resize: 'none' }}
                />
                {recipe?.has_video && (
                  <div className="step-time-field">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      className="step-time-input"
                      value={stepTimes[i] ?? ''}
                      onChange={(e) => updateStepTime(i, e.target.value)}
                      placeholder="0.0"
                      aria-label={`Step ${i + 1} video time in seconds`}
                    />
                    <span className="step-time-suffix">sec</span>
                  </div>
                )}
                <button
                  type="button"
                  className="ing-remove-btn"
                  onClick={() => removeStep(i)}
                  aria-label={`Remove step ${i + 1}`}
                  disabled={steps.length === 1}
                >
                  &times;
                </button>
              </div>
            ))}
            <button type="button" className="btn-add-row" onClick={addStep}>+ Add step</button>
          </div>
        </div>

        {/* Source URL */}
        <div className="form-group">
          <label htmlFor="rf-src" className="form-label">Source URL <span className="form-hint">(optional)</span></label>
          <input id="rf-src" className="form-input" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save recipe'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
