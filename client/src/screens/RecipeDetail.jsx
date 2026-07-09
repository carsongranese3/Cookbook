import { useState } from 'react';
import RecipeImage from '../components/RecipeImage.jsx';
import { HeartIcon } from './Library.jsx';
import { api } from '../api.js';
import { shortDayName, formatDayDate } from '../utils/week.js';

export default function RecipeDetail({
  recipe,
  loading,
  error,
  onBack,
  onEdit,
  onDelete,
  onFavorite,
  onAddToList,
  onStartCooking,
  weekDays,
  onAddToPlan,
  onRecipeChange,
}) {
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);
  const [addingToList, setAddingToList]   = useState(false);
  const [listMsg, setListMsg]             = useState('');
  const [assigningFilters, setAssigningFilters] = useState(false);
  const [assignMsg, setAssignMsg]               = useState('');
  const [localFilters, setLocalFilters]         = useState(null); // optimistic override

  const today = new Date().toISOString().slice(0, 10);

  async function handleAddToList() {
    setAddingToList(true);
    setListMsg('');
    try {
      const result = await onAddToList();
      const added   = result?.added?.length ?? 0;
      const skipped = result?.skipped ?? 0;
      setListMsg(
        skipped > 0
          ? `Added ${added} item${added !== 1 ? 's' : ''} (${skipped} already on list).`
          : `Added ${added} item${added !== 1 ? 's' : ''} to your shopping list.`
      );
      setTimeout(() => setListMsg(''), 3500);
    } catch (e) {
      setListMsg('Failed to add to list.');
      setTimeout(() => setListMsg(''), 3500);
    } finally {
      setAddingToList(false);
    }
  }

  async function handlePickDay(day) {
    setShowDayPicker(false);
    try {
      await onAddToPlan(day, recipe.id);
    } catch (e) {
      // silent — plan will update on next visit
    }
  }

  async function handleAssignFilters() {
    if (!recipe?.id) return;
    setAssigningFilters(true);
    setAssignMsg('');
    try {
      const updated = await api.assignFilters(recipe.id);
      // updated is the refreshed recipe object
      const assigned = Array.isArray(updated?.filters) ? updated.filters : [];
      setLocalFilters(assigned);
      setAssignMsg(
        assigned.length > 0
          ? `Assigned: ${assigned.join(', ')}`
          : 'No filters matched this recipe.'
      );
      if (onRecipeChange) onRecipeChange(updated);
      setTimeout(() => setAssignMsg(''), 5000);
    } catch (err) {
      if (err.status === 503) {
        setAssignMsg('AI not configured on the server.');
      } else {
        setAssignMsg(err.message || 'Could not assign filters.');
      }
      setTimeout(() => setAssignMsg(''), 5000);
    } finally {
      setAssigningFilters(false);
    }
  }

  if (loading) {
    return (
      <div className="page-pad">
        <div className="state-center">
          <div className="spinner" aria-label="Loading recipe" role="status" />
          <span>Loading recipe…</span>
        </div>
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="page-pad">
        <div className="state-center">
          <p style={{ margin: 0, color: 'var(--secondary)' }}>
            {error || 'Recipe not found.'}
          </p>
          <button className="btn btn-secondary" onClick={onBack}>← All recipes</button>
        </div>
      </div>
    );
  }

  const {
    id, title, description, cuisine, category, minutes, servings, rating,
    favorite, image, ingredients, steps,
  } = recipe;

  // Show locally-updated filters (after assign-filters), else the recipe's own array
  const displayFilters = localFilters ?? (Array.isArray(recipe.filters) ? recipe.filters : []);

  const ratingDisplay = rating != null ? `★ ${rating}` : 'New';
  const hasSteps      = steps && steps.length > 0;
  const favLabel      = favorite ? 'Saved' : 'Save';
  const eyebrow       = [cuisine, category].filter(Boolean).join(' · ');

  return (
    <>
      {/* Confirm delete */}
      {showConfirm && (
        <div className="confirm-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-box">
            <p className="confirm-title">Delete recipe?</p>
            <p className="confirm-msg">
              This will permanently remove &ldquo;{title}&rdquo; from your library.
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={() => { setShowConfirm(false); onDelete(); }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Day picker modal (desktop "Add to plan") */}
      {showDayPicker && weekDays && (
        <div
          className="modal-scrim"
          onClick={() => setShowDayPicker(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Choose a day"
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Add to plan</div>
            <div className="modal-body">
              {weekDays.map((day) => (
                <div
                  key={day}
                  className={`day-chooser-row ${day === today ? 'today-row' : ''}`}
                  onClick={() => handlePickDay(day)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handlePickDay(day)}
                >
                  <div className="day-chooser-name">
                    {shortDayName(day)}
                    {day === today ? ' · Today' : ''}
                  </div>
                  <div className="day-chooser-date">{formatDayDate(day)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── DESKTOP layout ── */}
      <div className="page-pad desktop-block">
        <button className="detail-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          All recipes
        </button>

        <div className="detail-hero">
          <RecipeImage image={image} title={title} style={{ width: '100%', height: '100%' }} />
        </div>

        <div className="detail-main">
          <div className="detail-info">
            {eyebrow && <div className="detail-eyebrow">{eyebrow}</div>}
            <h1 className="detail-title">{title}</h1>
            {displayFilters.length > 0 && (
              <div className="detail-assigned-filters">
                {displayFilters.map((label) => (
                  <span key={label} className="detail-filter-chip">{label}</span>
                ))}
              </div>
            )}
            {description && <p className="detail-desc">{description}</p>}
            <div className="detail-stats">
              <div className="stat-item">
                <div className="stat-value">
                  {minutes ?? '—'}<span> min</span>
                </div>
                <div className="stat-label">Total time</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{servings ?? '—'}</div>
                <div className="stat-label">Servings</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{ratingDisplay}</div>
                <div className="stat-label">Rating</div>
              </div>
            </div>
            <div className="detail-mgmt-row">
              <button
                className="btn btn-ghost"
                onClick={onEdit}
                style={{ height: 34, fontSize: 12 }}
              >
                Edit
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setShowConfirm(true)}
                style={{ height: 34, fontSize: 12, color: 'var(--danger)', borderColor: '#e6c4c1' }}
              >
                Delete
              </button>
            </div>
          </div>

          <div className="detail-actions">
            <button
              className="btn btn-primary"
              onClick={onStartCooking}
              disabled={!hasSteps}
              title={!hasSteps ? 'No steps yet' : undefined}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
                <path d="M5 3l14 9-14 9V3z"/>
              </svg>
              Start cooking
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleAddToList}
              disabled={addingToList}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" aria-hidden="true">
                <circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>
                <path d="M2 3h3l2.6 12.6a1 1 0 001 .8h8.8a1 1 0 001-.8L21 7H6"/>
              </svg>
              {addingToList ? 'Adding…' : 'Add to list'}
            </button>
            {recipe.source_url && (
              <a
                className="btn btn-secondary"
                href={recipe.source_url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the original video"
                style={{ textDecoration: 'none' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                  <path d="M15 3h6v6"/><path d="M10 14L21 3"/>
                </svg>
                Open original
              </a>
            )}
            {weekDays && (
              <button
                className="btn btn-secondary"
                onClick={() => setShowDayPicker(true)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>
                </svg>
                Add to plan
              </button>
            )}
            <button
              className={`btn-fav ${favorite ? 'saved' : ''}`}
              onClick={() => onFavorite(id)}
              aria-label={favorite ? 'Remove from saved' : 'Save recipe'}
            >
              <HeartIcon filled={favorite} size={15} />
              {favLabel}
            </button>
            <button
              className="btn btn-secondary detail-assign-btn"
              onClick={handleAssignFilters}
              disabled={assigningFilters}
              title="Let the AI assign filters based on this recipe's content"
            >
              {assigningFilters ? (
                <>
                  <span className="spinner spinner-sm" role="status" aria-label="Assigning" />
                  Assigning…
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
                  </svg>
                  Assign filters (AI)
                </>
              )}
            </button>
          </div>
        </div>

        {listMsg && (
          <p style={{ margin: '10px 0 0', font: '400 12px Onest', color: 'var(--secondary)' }}>
            {listMsg}
          </p>
        )}

        {assignMsg && (
          <p style={{ margin: '10px 0 0', font: '400 12px Onest', color: 'var(--secondary)' }}>
            {assignMsg}
          </p>
        )}

        <div className="detail-columns">
          <div>
            <div className="section-title">Ingredients</div>
            <div className="ingredients-list">
              {(ingredients || []).map((ing, i) => (
                <div key={i} className="ingredient-row">
                  <span className="ing-name">{ing.name}</span>
                  <span className="ing-qty">{ing.qty}</span>
                </div>
              ))}
              {(!ingredients || ingredients.length === 0) && (
                <p style={{ color: 'var(--muted)', font: '400 13px Onest', margin: '10px 0 0' }}>
                  No ingredients listed.
                </p>
              )}
            </div>
          </div>
          <div>
            <div className="section-title">Method</div>
            <div className="method-list">
              {(steps || []).map((step, i) => (
                <div key={i} className="method-step">
                  <div className="step-num">{i + 1}</div>
                  <div className="step-text">{step}</div>
                </div>
              ))}
              {(!steps || steps.length === 0) && (
                <p style={{ color: 'var(--muted)', font: '400 13px Onest', margin: '10px 0 0' }}>
                  No steps yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── PHONE layout ── */}
      <div className="phone-block">
        <div className="ph-detail-hero">
          <RecipeImage image={image} title={title} style={{ width: '100%', height: '100%' }} />
          <button className="ph-hero-back" onClick={onBack} aria-label="Back to all recipes">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <button
            className="ph-hero-fav"
            onClick={() => onFavorite(id)}
            aria-label={favorite ? 'Remove from saved' : 'Save recipe'}
          >
            <HeartIcon filled={favorite} size={17} />
          </button>
        </div>

        <div style={{ padding: '18px 20px 20px' }}>
          {eyebrow && (
            <div
              className="detail-eyebrow"
              style={{ letterSpacing: '1.5px' }}
            >
              {eyebrow}
            </div>
          )}
          <h1 style={{ font: '600 22px/1.15 Onest,system-ui', color: 'var(--text)', letterSpacing: '-0.02em', margin: '5px 0 0' }}>
            {title}
          </h1>

          <div className="ph-stats-strip">
            <div>
              <div className="ph-stat-value">{minutes ?? '—'}m</div>
              <div className="ph-stat-label">time</div>
            </div>
            <div>
              <div className="ph-stat-value">{servings ?? '—'}</div>
              <div className="ph-stat-label">serves</div>
            </div>
            <div>
              <div className="ph-stat-value">
                {rating != null ? `★${rating}` : 'New'}
              </div>
              <div className="ph-stat-label">rating</div>
            </div>
          </div>

          <div style={{ font: '600 14px Onest', color: 'var(--text)', marginTop: 16 }}>Ingredients</div>
          <div className="ingredients-list" style={{ marginTop: 8 }}>
            {(ingredients || []).map((ing, i) => (
              <div key={i} className="ingredient-row">
                <span className="ing-name" style={{ fontSize: 13 }}>{ing.name}</span>
                <span className="ing-qty" style={{ fontSize: 13 }}>{ing.qty}</span>
              </div>
            ))}
          </div>

          <div style={{ font: '600 14px Onest', color: 'var(--text)', marginTop: 18 }}>Method</div>
          <div className="method-list" style={{ marginTop: 10, gap: 13 }}>
            {(steps || []).map((step, i) => (
              <div key={i} className="method-step">
                <div className="step-num" style={{ width: 22, height: 22, fontSize: 11 }}>{i + 1}</div>
                <div className="step-text" style={{ fontSize: 13 }}>{step}</div>
              </div>
            ))}
          </div>

          {listMsg && (
            <p style={{ margin: '10px 0 0', font: '400 12px Onest', color: 'var(--secondary)' }}>
              {listMsg}
            </p>
          )}

          <div className="ph-action-row">
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={onStartCooking}
              disabled={!hasSteps}
              title={!hasSteps ? 'No steps yet' : undefined}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
                <path d="M5 3l14 9-14 9V3z"/>
              </svg>
              Cook
            </button>
            <button
              className="btn btn-icon"
              onClick={handleAddToList}
              disabled={addingToList}
              aria-label="Add to shopping list"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" aria-hidden="true">
                <circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>
                <path d="M2 3h3l2.6 12.6a1 1 0 001 .8h8.8a1 1 0 001-.8L21 7H6"/>
              </svg>
            </button>
          </div>

          {recipe.source_url && (
            <a
              className="btn btn-secondary"
              href={recipe.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginTop: 12, width: '100%', textDecoration: 'none' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" aria-hidden="true">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <path d="M15 3h6v6"/><path d="M10 14L21 3"/>
              </svg>
              Open original video
            </a>
          )}

          {/* Assign filters (AI) — phone */}
          <button
            className="btn btn-secondary detail-assign-btn"
            onClick={handleAssignFilters}
            disabled={assigningFilters}
            style={{ marginTop: 12, width: '100%' }}
          >
            {assigningFilters ? (
              <>
                <span className="spinner spinner-sm" role="status" aria-label="Assigning" />
                Assigning…
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
                </svg>
                Assign filters (AI)
              </>
            )}
          </button>

          {/* Assigned filter chips — phone */}
          {displayFilters.length > 0 && (
            <div className="detail-assigned-filters" style={{ marginTop: 8 }}>
              {displayFilters.map((label) => (
                <span key={label} className="detail-filter-chip">{label}</span>
              ))}
            </div>
          )}

          {assignMsg && (
            <p style={{ margin: '8px 0 0', font: '400 12px Onest', color: 'var(--secondary)' }}>
              {assignMsg}
            </p>
          )}

          <div className="detail-mgmt-row" style={{ marginTop: 12 }}>
            <button
              className="btn btn-ghost"
              onClick={onEdit}
              style={{ height: 34, fontSize: 12, flex: 1 }}
            >
              Edit
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setShowConfirm(true)}
              style={{ height: 34, fontSize: 12, flex: 1, color: 'var(--danger)', borderColor: '#e6c4c1' }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
