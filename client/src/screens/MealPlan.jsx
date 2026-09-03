import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../api.js';
import { titleCase } from '../utils/text.js';
import { todayISO } from '../utils/week.js';
import {
  WEEKDAY_LABELS,
  getCurrentYearMonth,
  addMonths,
  getMonthLabel,
  getMonthGridDates,
  isSameMonth,
  dayNumber,
  formatSheetDate,
} from '../utils/month.js';
import RecipeImage from '../components/RecipeImage.jsx';

const MAX_VISIBLE_THUMBS = 2;

export default function MealPlan({ onOpenRecipe, isOffline }) {
  const [{ year: viewYear, month: viewMonth }, setViewed] = useState(getCurrentYearMonth());
  const [planData, setPlanData]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [picker, setPicker]         = useState(null); // { day: ISO, returnToDaySheet: bool }
  const [daySheet, setDaySheet]     = useState(null);  // ISO date, phone day-sheet
  const [recipes, setRecipes]       = useState([]);
  const [pickerSearch, setPickerSearch] = useState('');

  const today = todayISO();
  const { year: curYear, month: curMonth } = getCurrentYearMonth();
  const isCurrentMonth = viewYear === curYear && viewMonth === curMonth;

  const gridDates = useMemo(() => getMonthGridDates(viewYear, viewMonth), [viewYear, viewMonth]);
  const rangeStart = gridDates[0];
  const rangeEnd = gridDates[gridDates.length - 1];

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [plan, allRecipes] = await Promise.all([
        api.mealPlan.get(rangeStart, rangeEnd),
        api.list(),
      ]);
      setPlanData(plan);
      setRecipes(allRecipes);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => { load(); }, [load]);

  function prevMonth() {
    setViewed(addMonths(viewYear, viewMonth, -1));
  }

  function nextMonth() {
    setViewed(addMonths(viewYear, viewMonth, 1));
  }

  function goToday() {
    setViewed(getCurrentYearMonth());
  }

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

  function openPicker(day, returnToDaySheet = false) {
    setPickerSearch('');
    setPicker({ day, returnToDaySheet });
    if (returnToDaySheet) setDaySheet(null);
  }

  function closePicker() {
    setPicker(null);
    setPickerSearch('');
  }

  async function pickRecipe(recipeId) {
    if (!picker) return;
    const { day, returnToDaySheet } = picker;
    closePicker();
    await addMeal(day, recipeId);
    if (returnToDaySheet) setDaySheet(day);
  }

  function openDaySheet(day) {
    setDaySheet(day);
  }

  function closeDaySheet() {
    setDaySheet(null);
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

  const plan = planData?.plan || {};
  const daySheetEntries = daySheet ? (plan[daySheet] || []) : [];

  return (
    <>
      {/* Recipe picker modal — used for both the desktop "+" and the phone day sheet's "+ Add meal" */}
      {picker && (
        <div
          className="modal-scrim"
          onClick={closePicker}
          role="dialog"
          aria-modal="true"
          aria-label={`Add to ${formatSheetDate(picker.day)}`}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              Add to {formatSheetDate(picker.day)}
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
                    <div className="picker-recipe-title">{titleCase(r.title)}</div>
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

      {/* Phone day sheet — lists a single day's meals with add/remove */}
      {daySheet && (
        <div
          className="modal-scrim"
          onClick={closeDaySheet}
          role="dialog"
          aria-modal="true"
          aria-label={`Meals for ${formatSheetDate(daySheet)}`}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              {formatSheetDate(daySheet)}
              {daySheet === today ? ' · Today' : ''}
            </div>
            <div className="modal-body">
              {daySheetEntries.length === 0 && (
                <p style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', font: '400 13px Onest' }}>
                  No meals planned.
                </p>
              )}
              {daySheetEntries.map((entry) => {
                if (!entry.recipe) {
                  return (
                    <div key={entry.id} className="plan-meal-ph" style={{ opacity: 0.5 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--fill)' }} />
                      <div className="plan-meal-title" style={{ color: 'var(--muted)' }}>Removed</div>
                      <button
                        className="ph-remove"
                        onClick={() => removeMeal(entry.id)}
                        aria-label="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={entry.id} className="plan-meal-ph" onClick={() => { closeDaySheet(); onOpenRecipe(entry.recipe.id); }}>
                    <RecipeImage
                      image={entry.recipe.image}
                      title={entry.recipe.title}
                      style={{ width: 44, height: 44, borderRadius: 8, flex: 'none' }}
                    />
                    <div className="plan-meal-title">{titleCase(entry.recipe.title)}</div>
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
            </div>
            <div style={{ padding: '10px 12px 14px', flex: 'none' }}>
              <button className="ph-add-meal-btn" onClick={() => openPicker(daySheet, true)}>
                + Add meal
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-pad">
        <div className="plan-month-nav">
          <button className="plan-nav-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
          <div className="eyebrow" aria-live="polite" style={{ minWidth: 110, textAlign: 'center' }}>
            {getMonthLabel(viewYear, viewMonth)}
          </div>
          <button className="plan-nav-btn" onClick={nextMonth} aria-label="Next month">›</button>
          {!isCurrentMonth && (
            <button className="plan-today-btn" onClick={goToday}>Today</button>
          )}
        </div>
        <h1 className="page-title">Meal Plan</h1>

        <div className="cal-weekday-row">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="cal-weekday">{label}</div>
          ))}
        </div>

        {/* Desktop: full month grid with meal thumbnails */}
        <div className="cal-grid" id="meal-plan-desktop">
          {gridDates.map((day) => {
            const entries = plan[day] || [];
            const isToday = day === today;
            const inMonth = isSameMonth(day, viewYear, viewMonth);
            const visible = entries.slice(0, MAX_VISIBLE_THUMBS);
            const overflow = entries.length - visible.length;
            return (
              <div
                key={day}
                className={`cal-cell ${isToday ? 'today' : ''} ${inMonth ? '' : 'other-month'}`}
              >
                <div className="cal-date-num">{dayNumber(day)}</div>
                {visible.map((entry) => {
                  if (!entry.recipe) {
                    return (
                      <div key={entry.id} className="meal-thumb-card cal-thumb" style={{ opacity: 0.5 }}>
                        <div style={{ height: 26, background: 'var(--fill)' }} />
                        <div className="meal-thumb-title" style={{ color: 'var(--muted)' }}>Removed</div>
                        <button
                          className="meal-thumb-remove"
                          onClick={() => removeMeal(entry.id)}
                          aria-label="Remove"
                        >
                          &times;
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={entry.id} className="meal-thumb-card cal-thumb" onClick={() => onOpenRecipe(entry.recipe.id)}>
                      <RecipeImage
                        image={entry.recipe.image}
                        title={entry.recipe.title}
                        style={{ height: 26 }}
                      />
                      <div className="meal-thumb-title">{titleCase(entry.recipe.title)}</div>
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
                {overflow > 0 && (
                  <button
                    className="cal-more-btn"
                    onClick={() => openDaySheet(day)}
                    aria-label={`View all ${entries.length} meals on ${formatSheetDate(day)}`}
                  >
                    +{overflow} more
                  </button>
                )}
                <button
                  className="cal-add-btn"
                  onClick={() => openPicker(day)}
                  aria-label={`Add meal to ${formatSheetDate(day)}`}
                >
                  +
                </button>
              </div>
            );
          })}
        </div>

        {/* Phone: compact month grid, tap a day to open the day sheet */}
        <div className="cal-grid-phone" id="meal-plan-phone">
          {gridDates.map((day) => {
            const entries = plan[day] || [];
            const isToday = day === today;
            const inMonth = isSameMonth(day, viewYear, viewMonth);
            return (
              <div
                key={day}
                className={`cal-cell-phone ${isToday ? 'today' : ''} ${inMonth ? '' : 'other-month'}`}
                role="button"
                tabIndex={0}
                onClick={() => openDaySheet(day)}
                onKeyDown={(e) => e.key === 'Enter' && openDaySheet(day)}
                aria-label={`${formatSheetDate(day)}${entries.length ? `, ${entries.length} meal${entries.length > 1 ? 's' : ''} planned` : ', no meals planned'}`}
              >
                <div className="cal-date-num">{dayNumber(day)}</div>
                {entries.length > 0 && (
                  <div className="cal-dot-count" aria-hidden="true">{entries.length}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
