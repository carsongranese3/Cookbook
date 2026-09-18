/**
 * FilterBar — chip row with inline drag-to-reorder/pin and chevron expand.
 *
 * Collapsed: pinned chips in user order + a chevron toggle. Chips are tap-only
 *            here — dragging is DISABLED until the chevron is opened, so a
 *            stray long-press while browsing can't silently reorder the bar.
 * Expanded:  pinned chips (draggable, reorderable) + unpinned chips below
 *            (alphabetical, draggable into the pinned row).
 *
 * Tap  → selects/deselects the filter (calls onChipClick). Always available.
 * Drag → reorders pinned OR moves a chip between pinned ↔ rest (pin/unpin).
 *        Only while expanded — see the `draggable` prop on SortableChip.
 *
 * Neighbor-shift behavior:
 * - onDragOver: arrayMove the live working-order so SortableContext items update
 *   mid-drag → @dnd-kit applies the transform/transition on every neighbor chip.
 * - onDragEnd: commit (persist) the final order.
 * - DragOverlay: ghost chip follows the pointer; original slot dims to 0 opacity.
 *
 * Two-container DnD via @dnd-kit/core + @dnd-kit/sortable.
 * Activation constraints prevent tap from starting a drag.
 */
import { useState } from 'react';
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
  horizontalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Chevron icon ──────────────────────────────────────────────────────────────
export function ChevronIcon({ open }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        display: 'block',
        transition: 'transform 0.18s ease',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
    >
      <path d="M2 4l4 4 4-4" />
    </svg>
  );
}

// ── A single draggable chip button ────────────────────────────────────────────
function SortableChip({
  filter,
  isActive,
  onChipClick,
  containerId,
  isDragOverlay = false,
  draggable = true,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: filter.id, data: { containerId }, disabled: !draggable });

  // Apply both transform AND transition so neighbors animate to fill/open gaps.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,  // hide original slot; overlay is the ghost
    // touch-action: none hands every touch to the drag sensor, so it must only
    // apply while the chip is actually draggable — otherwise a collapsed chip
    // swallows scrolling. Undefined lets it inherit the page default.
    touchAction: draggable ? 'none' : undefined,
  };

  return (
    <button
      ref={isDragOverlay ? undefined : setNodeRef}
      style={isDragOverlay ? { cursor: 'grabbing' } : style}
      className={`chip${draggable ? ' chip--draggable' : ''}${isActive ? ' active' : ''}`}
      aria-pressed={isActive}
      onClick={() => !isDragOverlay && onChipClick(filter.id)}
      {...(isDragOverlay || !draggable ? {} : { ...attributes, ...listeners })}
    >
      {filter.label}
    </button>
  );
}

// ── Container ID constants ────────────────────────────────────────────────────
const PINNED_CONTAINER = 'pinned';
const REST_CONTAINER   = 'rest';

// ── Main FilterBar component ──────────────────────────────────────────────────
export default function FilterBar({
  availableFilters,   // all filters derived from recipes
  pinnedIds,          // string[] — pinned ids in user order
  onPinnedIdsChange,  // (newIds: string[]) => void
  activeIds,          // string[] — currently selected filter ids
  onChipClick,        // (filterId: string) => void
}) {
  const [expanded, setExpanded]     = useState(false);
  const [activeItem, setActiveItem] = useState(null); // the item being dragged

  // Live working order for the pinned row — updated every onDragOver crossing
  // so SortableContext sees the new positions mid-drag and neighbors shift.
  const [livePinnedIds, setLivePinnedIds] = useState(null); // null = use prop

  const currentPinnedIds = livePinnedIds ?? pinnedIds;
  const pinnedSet = new Set(currentPinnedIds);

  // Pinned filters in user order (live during drag)
  const pinnedFilters = currentPinnedIds
    .map((id) => availableFilters.find((f) => f.id === id))
    .filter(Boolean);

  // Rest: unpinned, sorted alphabetically
  const restFilters = availableFilters
    .filter((f) => !pinnedSet.has(f.id))
    .sort((a, b) => a.label.localeCompare(b.label));

  const hasRest = restFilters.length > 0;

  // ── Sensors ──────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor,  { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,    { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── DnD handlers ─────────────────────────────────────────────────────────
  function handleDragStart({ active }) {
    const filter = availableFilters.find((f) => f.id === active.id);
    setActiveItem(filter || null);
    // Snapshot the committed pinnedIds into live state for the drag session
    setLivePinnedIds([...pinnedIds]);
  }

  /**
   * onDragOver fires as the pointer crosses each item boundary.
   * We arrayMove the live working list here so the SortableContext `items`
   * array reflects the new order in real time → neighbors animate into place.
   * We do NOT persist here — that happens in onDragEnd.
   */
  function handleDragOver({ active, over }) {
    if (!over || active.id === over.id) return;

    const fromPinned = new Set(livePinnedIds ?? pinnedIds).has(active.id);
    const toPinned   = new Set(livePinnedIds ?? pinnedIds).has(over.id);

    if (fromPinned && toPinned) {
      // Reorder within pinned — shift neighbors live
      setLivePinnedIds((prev) => {
        const ids = prev ?? pinnedIds;
        const oldIndex = ids.indexOf(active.id);
        const newIndex = ids.indexOf(over.id);
        if (oldIndex === -1 || newIndex === -1) return ids;
        return arrayMove(ids, oldIndex, newIndex);
      });
    } else if (!fromPinned && toPinned) {
      // rest chip dragged over a pinned chip — insert it live into pinned row
      setLivePinnedIds((prev) => {
        const ids = [...(prev ?? pinnedIds)];
        // Don't add twice
        if (ids.includes(active.id)) {
          // Already in live pinned (shouldn't happen if ids are disjoint, but guard it)
          const oldIndex = ids.indexOf(active.id);
          const newIndex = ids.indexOf(over.id);
          if (oldIndex === -1 || newIndex === -1) return ids;
          return arrayMove(ids, oldIndex, newIndex);
        }
        const insertAt = ids.indexOf(over.id);
        const next = [...ids];
        next.splice(insertAt >= 0 ? insertAt : next.length, 0, active.id);
        return next;
      });
    } else if (fromPinned && !toPinned) {
      // pinned chip dragged into rest — remove from live pinned (keep ≥1)
      setLivePinnedIds((prev) => {
        const ids = prev ?? pinnedIds;
        if (ids.length <= 1) return ids;
        return ids.filter((id) => id !== active.id);
      });
    }
    // rest → rest: no-op
  }

  /**
   * onDragEnd commits the live order to the parent (persists to localStorage).
   */
  function handleDragEnd({ active, over }) {
    const final = livePinnedIds ?? pinnedIds;
    setActiveItem(null);
    setLivePinnedIds(null); // clear live state; parent becomes source of truth

    if (!over || active.id === over.id) {
      // Check if live order differs from prop (cross-container drag may have shifted things)
      const liveStr = JSON.stringify(final);
      const propStr = JSON.stringify(pinnedIds);
      if (liveStr !== propStr) {
        onPinnedIdsChange(final);
      }
      return;
    }

    // Persist the final live order
    const fromPinned = new Set(pinnedIds).has(active.id);  // original pinned set
    const toPinned   = new Set(pinnedIds).has(over.id);

    if (fromPinned && toPinned) {
      onPinnedIdsChange(final);
    } else if (!fromPinned && toPinned) {
      onPinnedIdsChange(final);
    } else if (fromPinned && !toPinned) {
      if (pinnedIds.length > 1) {
        onPinnedIdsChange(final);
      }
    }
    // rest → rest: no-op
  }

  function handleDragCancel() {
    setActiveItem(null);
    setLivePinnedIds(null); // revert to committed order
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="filter-bar">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* ── Pinned row ── */}
        <div className="filter-top-row" role="group" aria-label="Filter recipes">
          <SortableContext items={currentPinnedIds} strategy={horizontalListSortingStrategy}>
            {pinnedFilters.map((f) => (
              <SortableChip
                key={f.id}
                filter={f}
                isActive={f.id === 'all' ? activeIds.length === 0 : activeIds.includes(f.id)}
                onChipClick={onChipClick}
                containerId={PINNED_CONTAINER}
                // Reordering is an explicit mode, entered with the chevron.
                // Collapsed, these are plain filter buttons — tap only.
                draggable={expanded}
              />
            ))}
          </SortableContext>

          {/* Chevron toggle */}
          {hasRest && (
            <button
              className={`chip-chevron${expanded ? ' open' : ''}`}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse filter options' : 'Show more filter options'}
            >
              <ChevronIcon open={expanded} />
            </button>
          )}
        </div>

        {/* ── Expanded rest area ── */}
        {expanded && hasRest && (
          <div className="filter-rest-row" role="group" aria-label="More filters">
            <SortableContext
              items={restFilters.map((f) => f.id)}
              strategy={rectSortingStrategy}
            >
              {restFilters.map((f) => (
                <SortableChip
                  key={f.id}
                  filter={f}
                  isActive={activeIds.includes(f.id)}
                  onChipClick={onChipClick}
                  containerId={REST_CONTAINER}
                />
              ))}
            </SortableContext>
          </div>
        )}

        {/* Drag overlay — ghost chip that follows the cursor */}
        <DragOverlay dropAnimation={null}>
          {activeItem ? (
            <SortableChip
              filter={activeItem}
              isActive={
                activeItem.id === 'all'
                  ? activeIds.length === 0
                  : activeIds.includes(activeItem.id)
              }
              onChipClick={() => {}}
              containerId={PINNED_CONTAINER}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
