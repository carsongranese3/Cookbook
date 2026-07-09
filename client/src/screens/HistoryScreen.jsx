/**
 * HistoryScreen — lists cooking history entries and manages an add/edit form.
 *
 * Self-contained: fetches its own data, manages its own modal form.
 *
 * Props:
 *   onOpenRecipe(recipeId) — navigate to recipe detail
 *   prefill                — { recipe_id, recipe, date } to pre-open add form
 *   onPrefillHandled()     — call after consuming prefill so it doesn't reopen
 *   isOffline              — boolean
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';
import RecipeImage from '../components/RecipeImage.jsx';
import { todayISO } from '../utils/week.js';
import { fileToDownscaledDataUrl } from '../utils/image.js';

// ── Format a YYYY-MM-DD date string for display ──────────────────────────────
function formatHistoryDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Star rating display (read-only) ─────────────────────────────────────────
function StarDisplay({ rating }) {
  if (rating == null) return null;
  return (
    <span className="hist-stars-display" aria-label={`Rated ${rating} out of 5`}>
      {[1,2,3,4,5].map((n) => (
        <span key={n} className={n <= rating ? 'hist-star filled' : 'hist-star'}>★</span>
      ))}
    </span>
  );
}

// ── Interactive star picker ───────────────────────────────────────────────────
function StarPicker({ value, onChange }) {
  const [hovered, setHovered] = useState(null);
  const display = hovered ?? value;

  return (
    <div className="hist-star-picker" role="group" aria-label="Rating">
      {[1,2,3,4,5].map((n) => (
        <button
          key={n}
          type="button"
          className={`hist-star-btn${display != null && n <= display ? ' on' : ''}`}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onChange(value === n ? null : n)}
          aria-label={`${n} star${n !== 1 ? 's' : ''}`}
          aria-pressed={value === n}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Entry form (add / edit) in a modal ───────────────────────────────────────
function EntryFormModal({ entry, prefill, recipes, onSave, onClose }) {
  const isEdit = Boolean(entry);

  // Recipe picker state
  const [selectedRecipe, setSelectedRecipe] = useState(
    entry?.recipe ?? prefill?.recipe ?? null
  );
  const [recipeSearch, setRecipeSearch]     = useState('');
  const [pickerOpen, setPickerOpen]         = useState(!isEdit && !prefill?.recipe);

  // Form fields
  const [date, setDate]               = useState(entry?.date ?? prefill?.date ?? todayISO());
  const [rating, setRating]           = useState(entry?.rating ?? null);
  const [description, setDescription] = useState(entry?.description ?? '');
  const [image, setImage]             = useState(entry?.image ?? null);
  const [imagePreview, setImagePreview] = useState(entry?.image ?? null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const fileRef                       = useRef(null);

  const filteredRecipes = recipes.filter((r) =>
    !recipeSearch || r.title.toLowerCase().includes(recipeSearch.toLowerCase())
  );

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    try {
      const dataUrl = await fileToDownscaledDataUrl(file, 800);
      setImage(dataUrl);
      setImagePreview(dataUrl);
    } catch {
      // ignore; keep existing image
    } finally {
      setPhotoLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removePhoto() {
    setImage(null);
    setImagePreview(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedRecipe) {
      setError('Please select a recipe.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        recipe_id:   selectedRecipe.id,
        date:        date || todayISO(),
        rating:      rating,
        image:       image,
        description: description.trim(),
      };
      if (isEdit) {
        await onSave(entry.id, body);
      } else {
        await onSave(null, body);
      }
    } catch (err) {
      setError(err.message || 'Could not save entry.');
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit cook log' : 'Log a cook'}
    >
      <div className="modal-box hist-form-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header mf-header">
          <span>{isEdit ? 'Edit cook log' : 'Log a cook'}</span>
          <button className="mf-close-btn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13"/>
            </svg>
          </button>
        </div>

        <div className="modal-body" style={{ padding: '16px 20px 20px' }}>
          <form onSubmit={handleSubmit}>
            {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

            {/* Recipe picker */}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <div className="form-label">Recipe <span aria-hidden>*</span></div>
              {selectedRecipe ? (
                <div className="hist-selected-recipe">
                  <RecipeImage
                    image={selectedRecipe.image}
                    title={selectedRecipe.title}
                    style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0 }}
                  />
                  <span className="hist-selected-title">{selectedRecipe.title}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                    onClick={() => { setPickerOpen(true); setRecipeSearch(''); }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 13 }}
                  onClick={() => { setPickerOpen(true); setRecipeSearch(''); }}
                >
                  Choose a recipe…
                </button>
              )}

              {/* Inline recipe picker */}
              {pickerOpen && (
                <div className="hist-picker-panel">
                  <input
                    className="form-input"
                    value={recipeSearch}
                    onChange={(e) => setRecipeSearch(e.target.value)}
                    placeholder="Search recipes…"
                    autoFocus
                    style={{ marginBottom: 6 }}
                  />
                  <div className="hist-picker-list">
                    {filteredRecipes.length === 0 && (
                      <p style={{ padding: '12px', textAlign: 'center', color: 'var(--muted)', font: '400 13px Onest', margin: 0 }}>
                        {recipes.length === 0 ? 'No recipes yet.' : 'No recipes match.'}
                      </p>
                    )}
                    {filteredRecipes.map((r) => (
                      <div
                        key={r.id}
                        className="picker-recipe-row"
                        onClick={() => { setSelectedRecipe(r); setPickerOpen(false); setError(''); }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && (() => { setSelectedRecipe(r); setPickerOpen(false); })()}
                        aria-label={`Select ${r.title}`}
                      >
                        <RecipeImage
                          image={r.image}
                          title={r.title}
                          style={{ width: 36, height: 36, borderRadius: 7, flex: 'none' }}
                        />
                        <div>
                          <div className="picker-recipe-title">{r.title}</div>
                          {(r.minutes || r.cuisine) && (
                            <div className="picker-recipe-meta">
                              {r.minutes != null && `${r.minutes} min`}
                              {r.minutes != null && r.cuisine && ' · '}
                              {r.cuisine}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Date */}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label htmlFor="hist-date" className="form-label">Date</label>
              <input
                id="hist-date"
                type="date"
                className="form-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                max={todayISO()}
              />
            </div>

            {/* Rating */}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <div className="form-label">Rating <span className="form-hint">(tap to set, tap again to clear)</span></div>
              <StarPicker value={rating} onChange={setRating} />
            </div>

            {/* Photo */}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <div className="form-label">Your photo <span className="form-hint">(optional)</span></div>
              {imagePreview ? (
                <div className="hist-photo-preview">
                  <img src={imagePreview} alt="Cook photo preview" className="hist-photo-img" />
                  <button
                    type="button"
                    className="hist-photo-remove"
                    onClick={removePhoto}
                    aria-label="Remove photo"
                  >
                    Remove photo
                  </button>
                </div>
              ) : (
                <label className="hist-photo-upload-btn">
                  {photoLoading ? 'Processing…' : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      Add photo
                    </>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handlePhotoChange}
                    disabled={photoLoading}
                  />
                </label>
              )}
            </div>

            {/* Description */}
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label htmlFor="hist-desc" className="form-label">Notes <span className="form-hint">(optional)</span></label>
              <textarea
                id="hist-desc"
                className="form-textarea"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="How did it go? Any tweaks?"
              />
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── A single history entry card ───────────────────────────────────────────────
function HistoryCard({ entry, onEdit, onDelete, onOpenRecipe }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const displayImage = entry.image || entry.recipe?.image || null;
  const displayTitle = entry.recipe?.title ?? null;

  return (
    <div className="hist-card">
      {/* Photo / thumbnail */}
      <div className="hist-card-img-wrap">
        <RecipeImage
          image={displayImage}
          title={displayTitle || 'Removed'}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Content */}
      <div className="hist-card-body">
        <div className="hist-card-top">
          {displayTitle ? (
            <button
              className="hist-card-title"
              onClick={() => onOpenRecipe(entry.recipe_id)}
            >
              {displayTitle}
            </button>
          ) : (
            <span className="hist-card-title hist-card-title--removed">Recipe removed</span>
          )}
          <div className="hist-card-actions">
            <button
              className="hist-icon-btn"
              onClick={() => onEdit(entry)}
              aria-label="Edit entry"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button
              className="hist-icon-btn hist-icon-btn--danger"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete entry"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="hist-card-meta">
          <span className="hist-card-date">{formatHistoryDate(entry.date)}</span>
          {entry.rating != null && <StarDisplay rating={entry.rating} />}
        </div>

        {entry.description && (
          <p className="hist-card-desc">{entry.description}</p>
        )}
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="confirm-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-box">
            <p className="confirm-title">Delete log entry?</p>
            <p className="confirm-msg">This will permanently remove this cook log.</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={() => { setConfirmDelete(false); onDelete(entry.id); }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main HistoryScreen ────────────────────────────────────────────────────────
export default function HistoryScreen({ onOpenRecipe, prefill, onPrefillHandled, isOffline }) {
  const [entries, setEntries]   = useState([]);
  const [recipes, setRecipes]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [formEntry, setFormEntry] = useState(null);  // null=closed, {}=new, entry=edit
  const [formOpen, setFormOpen]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [hist, allRecipes] = await Promise.all([
        api.history.list(),
        api.list(),
      ]);
      setEntries(hist || []);
      setRecipes(allRecipes || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Handle prefill from Cook Mode finish
  useEffect(() => {
    if (prefill && !loading) {
      setFormEntry(null);   // new entry
      setFormOpen(true);
      onPrefillHandled?.();
    }
  }, [prefill, loading, onPrefillHandled]);

  function openAdd() {
    setFormEntry(null);
    setFormOpen(true);
  }

  function openEdit(entry) {
    setFormEntry(entry);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setFormEntry(null);
  }

  async function handleSave(id, body) {
    if (id) {
      await api.history.update(id, body);
    } else {
      await api.history.create(body);
    }
    await load();
    closeForm();
  }

  async function handleDelete(id) {
    try {
      await api.history.remove(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // silent
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Entry form modal */}
      {formOpen && (
        <EntryFormModal
          entry={formEntry}
          prefill={formEntry ? null : prefill}
          recipes={recipes}
          onSave={handleSave}
          onClose={closeForm}
        />
      )}

      <div className="page-pad">
        {/* Header */}
        <div className="library-header">
          <div>
            <div className="eyebrow">My Kitchen</div>
            <h1 className="page-title" style={{ margin: 0 }}>History</h1>
          </div>
          <div className="desktop-flex" style={{ alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={openAdd} disabled={isOffline}>
              + Log a cook
            </button>
          </div>
        </div>

        {/* Phone: add button */}
        <div className="phone-block" style={{ marginTop: 14 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={openAdd}
            disabled={isOffline}
          >
            + Log a cook
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="state-center">
            <div className="spinner" aria-label="Loading history" role="status" />
            <span>Loading history…</span>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="state-center">
            <p style={{ color: 'var(--accent-dark)', margin: 0 }}>{error}</p>
            <button className="btn btn-secondary" onClick={load}>Try again</button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && entries.length === 0 && (
          <div className="state-center">
            <p style={{ margin: 0, fontSize: 15 }}>No cooking history yet.</p>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Finish cooking a recipe or log a cook manually.
            </p>
            <button className="btn btn-primary" onClick={openAdd}>Log a cook</button>
          </div>
        )}

        {/* Entry list */}
        {!loading && !error && entries.length > 0 && (
          <div className="hist-list">
            {entries.map((entry) => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                onEdit={openEdit}
                onDelete={handleDelete}
                onOpenRecipe={(recipeId) => { onOpenRecipe?.(recipeId); }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
