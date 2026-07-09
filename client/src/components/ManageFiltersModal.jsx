/**
 * ManageFiltersModal
 *
 * Modal for managing user-defined filters:
 * - Search input filters the visible list by label (case-insensitive substring)
 * - List is displayed in alphabetical order (case-insensitive)
 * - Create new filters
 * - Inline rename (pencil button or double-click label) / delete per row
 * - "Re-run AI on all recipes" button
 *
 * No drag-and-drop — order is always alphabetical.
 *
 * Props:
 *   filters:         [{id, label, position}]  current server list
 *   onClose:         () => void
 *   onFiltersChange: (updatedList) => void    called after any mutation
 *   onRecipesChange: () => void               called after assign-all to refresh recipe list
 */
import { useState } from 'react';
import { api } from '../api.js';

// ── A single filter row (rename / delete) ─────────────────────────────────────
function FilterRow({ filter, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState(filter.label);
  const [saving, setSaving]   = useState(false);

  async function commitRename() {
    const trimmed = val.trim();
    if (!trimmed || trimmed === filter.label) {
      setVal(filter.label);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.filters.rename(filter.id, trimmed);
      onRename(filter.id, updated.label);
    } catch {
      setVal(filter.label); // revert on error
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  return (
    <div className="mf-row">
      {editing ? (
        <input
          className="mf-rename-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter')  { e.preventDefault(); commitRename(); }
            if (e.key === 'Escape') { setVal(filter.label); setEditing(false); }
          }}
          autoFocus
          disabled={saving}
          aria-label="Rename filter"
        />
      ) : (
        <span
          className="mf-label"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
        >
          {filter.label}
        </span>
      )}

      <div className="mf-row-actions">
        {!editing && (
          <button
            className="mf-action-btn"
            onClick={() => setEditing(true)}
            aria-label={`Rename ${filter.label}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
        <button
          className="mf-action-btn mf-delete-btn"
          onClick={() => onDelete(filter.id)}
          aria-label={`Delete ${filter.label}`}
          disabled={saving}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function ManageFiltersModal({ filters, onClose, onFiltersChange, onRecipesChange }) {
  const [list, setList]         = useState(filters);
  const [search, setSearch]     = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding]     = useState(false);
  const [addError, setAddError] = useState('');
  const [aiState, setAiState]   = useState('idle'); // idle | running | done | error
  const [aiMsg, setAiMsg]       = useState('');

  // Alphabetical sort (case-insensitive), then filter by search query
  const sortedList = [...list].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  );
  const searchLower   = search.trim().toLowerCase();
  const visibleList   = searchLower
    ? sortedList.filter((f) => f.label.toLowerCase().includes(searchLower))
    : sortedList;

  // ── Create ────────────────────────────────────────────────────────────────
  async function handleAdd(e) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    setAdding(true);
    setAddError('');
    try {
      const created = await api.filters.create(label);
      const updated = [...list, created];
      setList(updated);
      onFiltersChange(updated);
      setNewLabel('');
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  // ── Rename ────────────────────────────────────────────────────────────────
  function handleRename(id, newLabelValue) {
    const updated = list.map((f) => f.id === id ? { ...f, label: newLabelValue } : f);
    setList(updated);
    onFiltersChange(updated);
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete(id) {
    try {
      await api.filters.remove(id);
      const updated = list.filter((f) => f.id !== id);
      setList(updated);
      onFiltersChange(updated);
    } catch {
      // silent — stays as-is if the server call fails
    }
  }

  // ── Re-run AI on all recipes ──────────────────────────────────────────────
  async function handleAssignAll() {
    setAiState('running');
    setAiMsg('');
    try {
      const result = await api.assignAll();
      setAiMsg(`Assigned filters to ${result.updated ?? 0} recipe${result.updated !== 1 ? 's' : ''}.`);
      setAiState('done');
      onRecipesChange();
    } catch (err) {
      if (err.status === 503) {
        setAiMsg('AI not configured on the server (missing API key).');
      } else {
        setAiMsg(err.message || 'Something went wrong.');
      }
      setAiState('error');
    }
  }

  return (
    <div
      className="modal-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Manage filters"
    >
      <div className="modal-box mf-modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header mf-header">
          <span>Manage filters</span>
          <button
            className="mf-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div className="modal-body mf-body">
          {/* Add new filter */}
          <form className="mf-add-row" onSubmit={handleAdd}>
            <input
              className="mf-add-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="New filter label…"
              aria-label="New filter name"
              disabled={adding}
            />
            <button
              type="submit"
              className="btn btn-primary mf-add-btn"
              disabled={adding || !newLabel.trim()}
            >
              {adding ? '…' : 'Add'}
            </button>
          </form>
          {addError && <p className="mf-add-error">{addError}</p>}

          {/* Search */}
          {list.length > 0 && (
            <div className="mf-search-row">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.4 }}>
                <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
              </svg>
              <input
                className="mf-search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search filters…"
                aria-label="Search filters"
              />
              {search && (
                <button
                  className="mf-search-clear"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M1 1l12 12M13 1L1 13"/>
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Filter list */}
          {list.length === 0 ? (
            <p className="mf-empty">No filters yet. Add one above.</p>
          ) : visibleList.length === 0 ? (
            <p className="mf-empty">No filters match &ldquo;{search}&rdquo;.</p>
          ) : (
            <div className="mf-list">
              {visibleList.map((f) => (
                <FilterRow
                  key={f.id}
                  filter={f}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {/* AI re-assign section */}
          <div className="mf-ai-section">
            <div className="mf-ai-label">AI filter assignment</div>
            <p className="mf-ai-hint">
              Have the AI re-read all your recipes and assign the current filters automatically.
            </p>
            <button
              className="btn btn-secondary mf-ai-btn"
              onClick={handleAssignAll}
              disabled={aiState === 'running'}
            >
              {aiState === 'running' ? (
                <>
                  <span className="spinner spinner-sm" role="status" aria-label="Running" />
                  Running…
                </>
              ) : 'Re-run AI on all recipes'}
            </button>
            {aiMsg && (
              <p className={`mf-ai-msg${aiState === 'error' ? ' mf-ai-msg--error' : ''}`}>
                {aiMsg}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
