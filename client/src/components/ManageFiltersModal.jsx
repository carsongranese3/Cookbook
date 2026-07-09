/**
 * ManageFiltersModal
 *
 * Modal for managing user-defined filters:
 * - Create new filters
 * - Inline rename / delete
 * - Drag-to-reorder (calls PUT /api/filters/order on drop)
 * - "Re-run AI on all recipes" button
 *
 * Neighbor-shift during drag:
 * - FilterRow applies both CSS.Transform and transition from useSortable,
 *   so every non-dragged row animates into its new slot as the pointer moves.
 * - onDragOver fires on every item-crossing and calls arrayMove + setList
 *   so SortableContext items updates in real time → live gap animation.
 * - onDragEnd persists the already-settled order to the server.
 * - DragOverlay renders a floating ghost of the dragged row under the pointer.
 *
 * Props:
 *   filters:         [{id, label, position}]  current server list
 *   onClose:         () => void
 *   onFiltersChange: (updatedList) => void    called after any mutation
 *   onRecipesChange: () => void               called after assign-all to refresh recipe list
 */
import { useState, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';

// ── Grip icon ─────────────────────────────────────────────────────────────────
function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" style={{ opacity: 0.35, flexShrink: 0 }}>
      <circle cx="3" cy="2.5" r="1.1" /><circle cx="9" cy="2.5" r="1.1" />
      <circle cx="3" cy="6"   r="1.1" /><circle cx="9" cy="6"   r="1.1" />
      <circle cx="3" cy="9.5" r="1.1" /><circle cx="9" cy="9.5" r="1.1" />
    </svg>
  );
}

// ── A single sortable filter row ──────────────────────────────────────────────
function FilterRow({ filter, onRename, onDelete, isDragOverlay = false }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState(filter.label);
  const [saving, setSaving]   = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: filter.id });

  // Apply transform + transition so neighbors animate as the active row passes them.
  // Original slot goes invisible (opacity 0) while the DragOverlay ghost is shown.
  const style = isDragOverlay ? {} : {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

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
      setVal(filter.label); // revert
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={style}
      className={`mf-row${isDragOverlay ? ' mf-row--overlay' : ''}`}
    >
      <span
        className="mf-grip"
        {...(isDragOverlay ? {} : { ...attributes, ...listeners })}
        aria-label="Drag to reorder"
      >
        <GripIcon />
      </span>

      {editing ? (
        <input
          className="mf-rename-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
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
  const listRef                 = useRef(list); // mirror of list for sync access in handlers
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding]     = useState(false);
  const [addError, setAddError] = useState('');
  const [aiState, setAiState]   = useState('idle'); // idle | running | done | error
  const [aiMsg, setAiMsg]       = useState('');

  // The filter being dragged (for the DragOverlay ghost)
  const [draggedFilter, setDraggedFilter] = useState(null);

  // Keep ref in sync whenever list changes
  function updateList(next) {
    listRef.current = next;
    setList(next);
  }

  const sensors = useSensors(
    useSensor(PointerSensor,  { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,    { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      updateList(updated);
      onFiltersChange(updated);
      setNewLabel('');
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  // ── Rename (from row callback) ────────────────────────────────────────────
  function handleRename(id, newLabelValue) {
    const updated = list.map((f) => f.id === id ? { ...f, label: newLabelValue } : f);
    updateList(updated);
    onFiltersChange(updated);
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete(id) {
    try {
      await api.filters.remove(id);
      const updated = list.filter((f) => f.id !== id);
      updateList(updated);
      onFiltersChange(updated);
    } catch {
      // silent — list stays as-is
    }
  }

  // ── Drag start — record which filter is being dragged ─────────────────────
  function handleDragStart({ active }) {
    const f = list.find((item) => item.id === active.id);
    setDraggedFilter(f || null);
  }

  /**
   * onDragOver: update list order live as the pointer crosses each row.
   * This makes SortableContext items change mid-drag, which drives the
   * CSS transform/transition on every neighbor row → visible gap animation.
   */
  function handleDragOver({ active, over }) {
    if (!over || active.id === over.id) return;
    const prev = listRef.current;
    const oldIndex = prev.findIndex((f) => f.id === active.id);
    const newIndex = prev.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(prev, oldIndex, newIndex);
    updateList(next);
  }

  /**
   * onDragEnd: list is already in the correct visual order from onDragOver
   * (listRef.current holds the settled order). Just persist to the server.
   */
  async function handleDragEnd() {
    setDraggedFilter(null);
    const current = listRef.current;
    onFiltersChange(current);
    const ids = current.map((f) => f.id);
    try {
      await api.filters.reorder(ids);
    } catch {
      // On network error, revert to the original committed order
      updateList(filters);
      onFiltersChange(filters);
    }
  }

  function handleDragCancel() {
    setDraggedFilter(null);
    // Revert live reorder — onDragOver may have partially shifted things
    updateList(filters);
    onFiltersChange(filters);
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

          {/* Filter list */}
          {list.length === 0 ? (
            <p className="mf-empty">No filters yet. Add one above.</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext
                items={list.map((f) => f.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="mf-list">
                  {list.map((f) => (
                    <FilterRow
                      key={f.id}
                      filter={f}
                      onRename={handleRename}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </SortableContext>

              {/* Floating ghost row that follows the pointer during drag */}
              <DragOverlay dropAnimation={null}>
                {draggedFilter ? (
                  <FilterRow
                    filter={draggedFilter}
                    onRename={() => {}}
                    onDelete={() => {}}
                    isDragOverlay
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
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
