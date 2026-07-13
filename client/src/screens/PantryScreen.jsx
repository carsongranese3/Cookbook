/**
 * PantryScreen — ingredient inventory grouped by category.
 *
 * Self-contained: fetches its own data, manages its own add/edit modal.
 *
 * Props:
 *   isOffline — boolean
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';

// Feature flag: the "Running low" action (adds a pantry item to the shopping
// list) is disabled for now. Flip to `true` to bring it back — all its code
// (handleRunningLow, the button, the pantry-low-* styles) is left intact.
const RUNNING_LOW_ENABLED = false;

// Fixed category order — must match the backend exactly.
export const PANTRY_CATEGORIES = [
  'Produce',
  'Dairy & Eggs',
  'Meat & Seafood',
  'Bakery',
  'Frozen',
  'Pantry staples',
  'Beverages',
  'Condiments & Spices',
  'Other',
];

// Map an item to a known category, folding unknowns into "Other".
const catOf = (it) =>
  PANTRY_CATEGORIES.includes(it.category) ? it.category : 'Other';

// ── Add / Edit form modal ──────────────────────────────────────────────────────
function PantryFormModal({ item, onSave, onClose }) {
  const isEdit = Boolean(item);
  const [name, setName]         = useState(item?.name ?? '');
  const [qty, setQty]           = useState(item?.qty ?? '');
  const [category, setCategory] = useState(item?.category ?? 'Other');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(item?.id ?? null, { name: trimmed, qty: qty.trim(), category });
    } catch (err) {
      setError(err.message || 'Could not save item.');
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit pantry item' : 'Add pantry item'}
    >
      <div className="modal-box pantry-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header mf-header">
          <span>{isEdit ? 'Edit item' : 'Add to pantry'}</span>
          <button className="mf-close-btn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13"/>
            </svg>
          </button>
        </div>
        <div className="modal-body" style={{ padding: '16px 20px 20px' }}>
          <form onSubmit={handleSubmit}>
            {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label htmlFor="pantry-name" className="form-label">Name <span aria-hidden>*</span></label>
              <input
                id="pantry-name"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Olive oil"
                autoFocus
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label htmlFor="pantry-qty" className="form-label">Quantity <span className="form-hint">(optional)</span></label>
              <input
                id="pantry-qty"
                className="form-input"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 1 bottle, half-full"
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label htmlFor="pantry-cat" className="form-label">Category</label>
              <select
                id="pantry-cat"
                className="form-input form-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={saving}
              >
                {PANTRY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to pantry'}
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

// ── Single pantry item row ────────────────────────────────────────────────────
function PantryRow({ item, onEdit, onDelete, onRunningLow, isOffline }) {
  const [lowMsg, setLowMsg]         = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sendingLow, setSendingLow] = useState(false);

  async function handleRunningLow() {
    if (isOffline) return;
    setSendingLow(true);
    try {
      const result = await onRunningLow(item.id);
      if (result?.skipped) {
        setLowMsg('Already on your list');
      } else {
        setLowMsg('Added to shopping list');
      }
      setTimeout(() => setLowMsg(''), 3000);
    } catch {
      setLowMsg('Could not add');
      setTimeout(() => setLowMsg(''), 3000);
    } finally {
      setSendingLow(false);
    }
  }

  return (
    <>
      <div className="pantry-row">
        <span className="pantry-row-name">{item.name}</span>
        {item.qty && <span className="pantry-row-qty">{item.qty}</span>}

        <div className="pantry-row-actions">
          {RUNNING_LOW_ENABLED && (
            lowMsg ? (
              <span className="pantry-low-msg">{lowMsg}</span>
            ) : (
              <button
                className="pantry-low-btn"
                onClick={handleRunningLow}
                disabled={sendingLow || isOffline}
                title="Add to shopping list"
                aria-label={`Mark ${item.name} as running low — add to shopping list`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                  <path d="M3 6h18M16 10a4 4 0 01-8 0"/>
                </svg>
                Running low
              </button>
            )
          )}
          <button
            className="hist-icon-btn"
            onClick={() => onEdit(item)}
            aria-label={`Edit ${item.name}`}
            disabled={isOffline}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button
            className="hist-icon-btn hist-icon-btn--danger"
            onClick={() => setConfirmDelete(true)}
            aria-label={`Delete ${item.name}`}
            disabled={isOffline}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="confirm-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-box">
            <p className="confirm-title">Remove from pantry?</p>
            <p className="confirm-msg">
              &ldquo;{item.name}&rdquo; will be removed from your pantry.
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={() => { setConfirmDelete(false); onDelete(item.id); }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main PantryScreen ─────────────────────────────────────────────────────────
export default function PantryScreen({ isOffline }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [formItem, setFormItem] = useState(undefined); // undefined=closed, null=new, item=edit
  const [formOpen, setFormOpen] = useState(false);

  // Category toggle bar: which category sections are shown. Initialized once
  // from content — categories that have items start ON, empty ones start OFF.
  const [activeCats, setActiveCats] = useState(() => new Set());
  const catsInitialized = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.pantry.list();
      setItems(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Seed the category toggles the first time items arrive: on where there are
  // items, off where empty. After this, toggles are the user's to control.
  useEffect(() => {
    if (catsInitialized.current || loading || items.length === 0) return;
    setActiveCats(
      new Set(PANTRY_CATEGORIES.filter((cat) => items.some((it) => catOf(it) === cat)))
    );
    catsInitialized.current = true;
  }, [items, loading]);

  function toggleCat(cat) {
    setActiveCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function openAdd() {
    setFormItem(null);
    setFormOpen(true);
  }

  function openEdit(item) {
    setFormItem(item);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setFormItem(undefined);
  }

  async function handleSave(id, body) {
    if (id) {
      await api.pantry.update(id, body);
    } else {
      await api.pantry.create(body);
    }
    await load();
    // Make sure the item's category is visible (e.g. adding to an empty,
    // toggled-off category should reveal it rather than hide the new item).
    if (body?.category) {
      setActiveCats((prev) => new Set(prev).add(body.category));
    }
    closeForm();
  }

  async function handleDelete(id) {
    try {
      await api.pantry.remove(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch {
      await load();
    }
  }

  async function handleRunningLow(id) {
    return api.pantry.toShopping(id);
  }

  // Filter by search, then group by FIXED category order
  const searchLower = search.trim().toLowerCase();
  const filtered = searchLower
    ? items.filter((it) => it.name.toLowerCase().includes(searchLower))
    : items;

  // Total item count per category (unfiltered) — drives chip labels + initial state.
  const countByCat = Object.fromEntries(PANTRY_CATEGORIES.map((c) => [c, 0]));
  for (const it of items) countByCat[catOf(it)] += 1;

  // Sections to render: the active (toggled-on) categories, in fixed order.
  // While searching, drop active-but-empty sections to cut noise.
  const sections = PANTRY_CATEGORIES
    .filter((cat) => activeCats.has(cat))
    .map((cat) => ({
      category: cat,
      items: filtered.filter((it) => catOf(it) === cat),
    }))
    .filter((g) => (searchLower ? g.items.length > 0 : true));

  return (
    <>
      {formOpen && (
        <PantryFormModal
          item={formItem}
          onSave={handleSave}
          onClose={closeForm}
        />
      )}

      <div className="page-pad">
        {/* Header */}
        <div className="library-header">
          <div>
            <div className="eyebrow">My Kitchen</div>
            <h1 className="page-title" style={{ margin: 0 }}>Pantry</h1>
          </div>
          <div className="desktop-flex" style={{ alignItems: 'center', gap: 10 }}>
            <div className="search-box" style={{ width: 240 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a8a29a" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pantry…"
                aria-label="Search pantry items"
              />
            </div>
            <button className="btn btn-primary" onClick={openAdd} disabled={isOffline}>
              + Add item
            </button>
          </div>
        </div>

        {/* Phone: search + add (hidden on desktop, where the header controls show) */}
        <div className="phone-block" style={{ marginTop: 14 }}>
          <div className="search-box" style={{ borderRadius: 12, height: 42 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a8a29a" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pantry…"
              aria-label="Search pantry items"
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 10 }}
            onClick={openAdd}
            disabled={isOffline}
          >
            + Add item
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="state-center">
            <div className="spinner" aria-label="Loading pantry" role="status"/>
            <span>Loading pantry…</span>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="state-center">
            <p style={{ color: 'var(--accent-dark)', margin: 0 }}>{error}</p>
            <button className="btn btn-secondary" onClick={load}>Try again</button>
          </div>
        )}

        {/* Empty (no items at all) */}
        {!loading && !error && items.length === 0 && (
          <div className="state-center">
            <p style={{ margin: 0, fontSize: 15 }}>Your pantry is empty.</p>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Add ingredients you have on hand.
            </p>
            <button className="btn btn-primary" onClick={openAdd}>Add item</button>
          </div>
        )}

        {/* Category toggle bar — one button per section */}
        {!loading && !error && items.length > 0 && (
          <div className="chip-row" role="group" aria-label="Show or hide categories">
            {PANTRY_CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`chip ${activeCats.has(cat) ? 'active' : ''}`}
                onClick={() => toggleCat(cat)}
                aria-pressed={activeCats.has(cat)}
              >
                {cat}{countByCat[cat] > 0 ? ` · ${countByCat[cat]}` : ''}
              </button>
            ))}
          </div>
        )}

        {/* Sections for the active categories */}
        {!loading && !error && items.length > 0 && (
          sections.length === 0 ? (
            <div className="state-center">
              <p style={{ margin: 0 }}>
                {searchLower
                  ? <>No items match &ldquo;{search}&rdquo;.</>
                  : 'No categories shown — turn one on above.'}
              </p>
            </div>
          ) : (
            <div className="pantry-list">
              {sections.map((group) => (
                <div key={group.category} className="pantry-section">
                  <div className="pantry-section-header">{group.category}</div>
                  <div className="pantry-section-items">
                    {group.items.length > 0 ? (
                      group.items.map((item) => (
                        <PantryRow
                          key={item.id}
                          item={item}
                          onEdit={openEdit}
                          onDelete={handleDelete}
                          onRunningLow={handleRunningLow}
                          isOffline={isOffline}
                        />
                      ))
                    ) : (
                      <div className="pantry-empty-hint">Nothing here yet.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>
  );
}
