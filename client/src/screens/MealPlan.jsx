import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { shortDayName, formatDayDate, todayISO } from '../utils/week.js';
import RecipeImage from '../components/RecipeImage.jsx';

export default function MealPlan({ onOpenRecipe, isOffline }) {
  const [planData, setPlanData]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [picker, setPicker]         = useState(null); // { day: ISO }
  const [recipes, setRecipes]       = useState([]);
  const [pickerSearch, setPickerSearch] = useState('');

  const today = todayISO();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [plan, allRecipes] = await Promise.all([
        api.mealPlan.get(),
        api.list(),
      ]);
      setPlanData(plan);
      setRecipes(allRecipes);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addMeal(day, recipeId) {
    if (isOffline) return;
    try {
      await api.mealPlan.add(day, recipeId);
      await load();
    } catch (e) {
      // ignore
    }
  }

  async function removeMeal(entryId) {
    if (isOffline) return;
    try {
      await api.mealPlan.remove(entryId);
      await load();
    } catch (e) {
      // ignore
    }
  }

  function openPicker(day) {
    setPickerSearch('');
    setPicker({ day });
  }

  function closePicker() {
    setPicker(null);
    setPickerSearch('');
  }

  async function pickRecipe(recipeId) {
    if (!picker) return;
    const day = picker.day;
    closePicker();
    await addMeal(day, recipeId);
  }

  const filteredPickerRecipes = recipes.filter((r) =>
    !pickerSearch || r.title.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="page-pad">
        <div className="state-center">
          <div className="spinner" aria-label="Loading meal plan" />
          <span>Loading meal plan…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-pad">
        <div className="state-center">
          <p style={{ color: 'var(--accent-dark)', margin: 0 }}>{error}</p>
          <button className="btn btn-secondary" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const week = planData?.week || [];
  const plan = planData?.plan || {};

  return (
    <>
      {/* Plan picker modal */}
      {picker && (
        <div
          className="modal-scrim"
          onClick={closePicker}
          role="dialog"
          aria-modal="true"
          aria-label={`Add to ${shortDayName(picker.day)}`}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              Add to {shortDayName(picker.day)}
              {picker.day === today ? ' (Today)' : ''}
            </div>
            <div style={{ padding: '8px 12px 0', borderBottom: '1px solid var(--border-light)' }}>
              <input
                className="form-input"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search recipes…"
                autoFocus
                style={{ marginBottom: 8 }}
              />
            </div>
            <div className="modal-body">
              {filteredPickerRecipes.length === 0 && (
                <p style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', font: '400 13px Onest' }}>
                  {recipes.length === 0 ? 'No recipes yet.' : 'No recipes match.'}
                </p>
              )}
              {filteredPickerRecipes.map((r) => (
                <div
                  key={r.id}
                  className="picker-recipe-row"
                  onClick={() => pickRecipe(r.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && pickRecipe(r.id)}
                  aria-label={`Add ${r.title}`}
                >
                  <RecipeImage
                    image={r.image}
                    title={r.title}
                    style={{ width: 44, height: 44, borderRadius: 8, flex: 'none' }}
                  />
                  <div>
                    <div className="picker-recipe-title">{r.title}</div>
                    <div className="picker-recipe-meta">
                      {r.minutes != null && `${r.minutes} min`}
                      {r.minutes != null && r.cuisine && ' · '}
                      {r.cuisine}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="page-pad">
        <div className="eyebrow">This week</div>
        <h1 className="page-title">Meal Plan</h1>

        {/* Desktop 7-col grid */}
        <div className="week-grid" id="meal-plan-desktop" style={{ display: 'none' }}>
          <style>{`@media (min-width:768px){#meal-plan-desktop{display:grid}}`}</style>
          {week.map((day) => {
            const entries = plan[day] || [];
            const isToday = day === today;
            return (
              <div key={day} className={`day-col ${isToday ? 'today' : ''}`}>
                <div className="day-name">{shortDayName(day)}</div>
                <div className="day-date">{formatDayDate(day)}</div>
                {entries.map((entry) => {
                  if (!entry.recipe) {
                    return (
                      <div key={entry.id} className="meal-thumb-card" style={{ opacity: 0.5 }}>
                        <div style={{ height: 60, background: 'var(--fill)' }} />
                        <div className="meal-thumb-title" style={{ color: 'var(--muted)' }}>Removed</div>
                      </div>
                    );
                  }
                  return (
                    <div key={entry.id} className="meal-thumb-card" onClick={() => onOpenRecipe(entry.recipe.id)}>
                      <RecipeImage
                        image={entry.recipe.image}
                        title={entry.recipe.title}
                        style={{ height: 60 }}
                      />
                      <div className="meal-thumb-title">{entry.recipe.title}</div>
                      <button
                        className="meal-thumb-remove"
                        onClick={(e) => { e.stopPropagation(); removeMeal(entry.id); }}
                        aria-label={`Remove ${entry.recipe.title}`}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
                <button className="day-add-btn" onClick={() => openPicker(day)} aria-label={`Add meal to ${shortDayName(day)}`}>
                  +
                </button>
              </div>
            );
          })}
        </div>

        {/* Phone vertical day list */}
        <div id="meal-plan-phone" style={{ display: 'none', marginTop: 16 }}>
          <style>{`@media (max-width:767px){#meal-plan-phone{display:block}}`}</style>
          {week.map((day) => {
            const entries = plan[day] || [];
            const isToday = day === today;
            return (
              <div key={day} className="plan-day-row">
                <div className="plan-day-header" style={isToday ? { color: 'var(--accent)' } : {}}>
                  <span className="plan-day-name" style={isToday ? { color: 'var(--accent)' } : {}}>
                    {shortDayName(day)} {isToday ? '· Today' : ''}
                  </span>
                  <span className="plan-day-date">{formatDayDate(day)}</span>
                </div>
                {entries.map((entry) => {
                  if (!entry.recipe) {
                    return (
                      <div key={entry.id} className="plan-meal-ph" style={{ opacity: 0.5 }}>
                        <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--fill)' }} />
                        <div className="plan-meal-title" style={{ color: 'var(--muted)' }}>Removed</div>
                      </div>
                    );
                  }
                  return (
                    <div key={entry.id} className="plan-meal-ph" onClick={() => onOpenRecipe(entry.recipe.id)}>
                      <RecipeImage
                        image={entry.recipe.image}
                        title={entry.recipe.title}
                        style={{ width: 44, height: 44, borderRadius: 8, flex: 'none' }}
                      />
                      <div className="plan-meal-title">{entry.recipe.title}</div>
                      <button
                        className="ph-remove"
                        onClick={(e) => { e.stopPropagation(); removeMeal(entry.id); }}
                        aria-label={`Remove ${entry.recipe.title}`}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
                <button className="ph-add-meal-btn" onClick={() => openPicker(day)} aria-label={`Add meal to ${shortDayName(day)}`}>
                  + Add meal
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
