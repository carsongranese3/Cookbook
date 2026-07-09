/**
 * PantryScreen — ingredient inventory grouped by category.
 *
 * Self-contained: fetches its own data, manages its own add/edit modal.
 *
 * Props:
 *   isOffline — boolean
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

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
          {lowMsg ? (
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

  // Build ordered category groups (only categories with ≥1 item)
  const groups = PANTRY_CATEGORIES.map((cat) => ({
    category: cat,
    items: filtered.filter((it) => it.category === cat),
  })).filter((g) => g.items.length > 0);

  // Items whose category doesn't match any known category (shouldn't happen but be safe)
  const orphanItems = filtered.filter(
    (it) => !PANTRY_CATEGORIES.includes(it.category)
  );
  if (orphanItems.length > 0) {
    groups.push({ category: 'Other', items: orphanItems });
  }

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

        {/* Phone: search + add */}
        <div className="phone-block" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
            style={{ width: '100%' }}
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

        {/* No search results */}
        {!loading && !error && items.length > 0 && groups.length === 0 && (
          <div className="state-center">
            <p style={{ margin: 0 }}>No items match &ldquo;{search}&rdquo;.</p>
          </div>
        )}

        {/* Category groups */}
        {!loading && !error && groups.length > 0 && (
          <div className="pantry-list">
            {groups.map((group) => (
              <div key={group.category} className="pantry-section">
                <div className="pantry-section-header">{group.category}</div>
                <div className="pantry-section-items">
                  {group.items.map((item) => (
                    <PantryRow
                      key={item.id}
                      item={item}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                      onRunningLow={handleRunningLow}
                      isOffline={isOffline}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
