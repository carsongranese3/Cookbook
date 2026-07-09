import { useState, useMemo, useEffect, useCallback } from 'react';
import RecipeImage from '../components/RecipeImage.jsx';
import FilterBar from '../components/FilterCustomizePanel.jsx';
import ManageFiltersModal from '../components/ManageFiltersModal.jsx';
import {
  buildAvailableFilters,
  matchesActiveSet,
  loadPinnedIds,
  savePinnedIds,
  reconcilePins,
} from '../utils/filters.js';
import { api } from '../api.js';

// ── Search helper ─────────────────────────────────────────────────────────────
function matchesSearch(recipe, q) {
  if (!q) return true;
  const lower = q.toLowerCase();
  if ((recipe.title || '').toLowerCase().includes(lower)) return true;
  if ((recipe.cuisine || '').toLowerCase().includes(lower)) return true;
  const ings = recipe.ingredients || [];
  if (ings.some((ing) => (ing.name || '').toLowerCase().includes(lower))) return true;
  const tags = recipe.tags || [];
  if (tags.some((t) => t.toLowerCase().includes(lower))) return true;
  return false;
}

// ── Main Library screen ───────────────────────────────────────────────────────
export default function Library({ recipes, loading, error, onRetry, onOpen, onNew, onFavorite }) {
  const [search, setSearch]             = useState('');
  const [activeIds, setActiveIds]       = useState([]);
  const [pinnedIds, setPinnedIds]       = useState(null); // null = not yet initialised
  const [userFilters, setUserFilters]   = useState([]);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [manageOpen, setManageOpen]     = useState(false);
  // localRecipes lets us refresh recipe list after assign-all without remounting
  const [localRecipes, setLocalRecipes] = useState(null);

  const displayRecipes = localRecipes ?? recipes;

  // Fetch user-defined filters from the server
  useEffect(() => {
    let cancelled = false;
    setFiltersLoading(true);
    api.filters.list()
      .then((data) => { if (!cancelled) setUserFilters(data || []); })
      .catch(() => { if (!cancelled) setUserFilters([]); })
      .finally(() => { if (!cancelled) setFiltersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Build available filters from user list + recipes
  const availableFilters = useMemo(
    () => buildAvailableFilters(userFilters, displayRecipes),
    [userFilters, displayRecipes],
  );

  // On load (and whenever availableFilters change), reconcile stored pins.
  useEffect(() => {
    if (loading || filtersLoading) return;
    const savedIds = loadPinnedIds();
    const reconciled = reconcilePins(availableFilters, savedIds);
    setPinnedIds(reconciled);
  }, [availableFilters, loading, filtersLoading]);

  // If any active filter leaves the available set, remove it.
  useEffect(() => {
    const available = new Set(availableFilters.map((f) => f.id));
    setActiveIds((prev) => prev.filter((id) => available.has(id)));
  }, [availableFilters]);

  // Persist whenever pins change
  const handlePinnedIdsChange = useCallback((newIds) => {
    setPinnedIds(newIds);
    savePinnedIds(newIds);
  }, []);

  // When ManageFilters creates/renames/deletes filters, update the local list
  function handleFiltersChange(updatedList) {
    setUserFilters(updatedList);
  }

  // When assign-all runs, re-fetch recipes from the parent by triggering onRetry,
  // but we also optimistically keep the current list showing.
  function handleRecipesChange() {
    // Fetch fresh recipe list without disturbing the parent's cache
    api.list().then((data) => {
      if (data) setLocalRecipes(data);
    }).catch(() => {});
  }

  // ── Chip toggle logic ──────────────────────────────────────────────────────
  function handleChipClick(filterId) {
    if (filterId === 'all') {
      setActiveIds([]);
      return;
    }
    setActiveIds((prev) =>
      prev.includes(filterId)
        ? prev.filter((id) => id !== filterId)
        : [...prev, filterId]
    );
  }

  // Filtered recipe list: multi-select active set AND search
  const filtered = useMemo(() => {
    return displayRecipes.filter(
      (r) => matchesActiveSet(r, activeIds) && matchesSearch(r, search)
    );
  }, [displayRecipes, activeIds, search]);

  const chipsReady = pinnedIds !== null && !loading && !filtersLoading;

  // True when user has no custom filters defined
  const hasNoUserFilters = !filtersLoading && userFilters.length === 0;

  return (
    <div className="page-pad">
      {/* Header */}
      <div className="library-header">
        <div>
          <div className="eyebrow">My Kitchen</div>
          <h1 className="page-title desktop-only" style={{ margin: 0 }}>Recipes</h1>
          <div className="ph-title-count-row phone-only">
            <h1 className="page-title" style={{ margin: 0 }}>Recipes</h1>
            <span className="ph-recipe-count">{displayRecipes.length}</span>
          </div>
        </div>

        {/* Desktop: search + New recipe */}
        <div className="desktop-flex" style={{ alignItems: 'center', gap: 10 }}>
          <div className="search-box" style={{ width: 280 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a8a29a" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recipes, ingredients…"
              aria-label="Search recipes"
            />
          </div>
          <button className="btn btn-primary" onClick={onNew} style={{ whiteSpace: 'nowrap' }}>
            + New recipe
          </button>
        </div>
      </div>

      {/* Phone: full-width search */}
      <div className="phone-block" style={{ marginTop: 16 }}>
        <div className="search-box" style={{ borderRadius: 12, height: 42 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a8a29a" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes"
            aria-label="Search recipes"
          />
        </div>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────────── */}
      {chipsReady && (
        <div className="filter-bar-wrapper">
          <FilterBar
            availableFilters={availableFilters}
            pinnedIds={pinnedIds}
            onPinnedIdsChange={handlePinnedIdsChange}
            activeIds={activeIds}
            onChipClick={handleChipClick}
          />

          {/* Manage Filters button — always visible after bar */}
          <button
            className="manage-filters-btn"
            onClick={() => setManageOpen(true)}
            aria-label="Manage filters"
            title="Manage filters"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 6h18M7 12h10M11 18h2"/>
            </svg>
            <span className="desktop-only" style={{ fontSize: 11, marginLeft: 4 }}>Filters</span>
          </button>

          {/* Empty-state hint when no user filters defined */}
          {hasNoUserFilters && (
            <p className="no-filters-hint">
              No filters yet.{' '}
              <button
                className="no-filters-link"
                onClick={() => setManageOpen(true)}
              >
                Add filters
              </button>{' '}
              to start categorising your recipes.
            </p>
          )}
        </div>
      )}

      {/* ── States ──────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="state-center">
          <div className="spinner" aria-label="Loading recipes" role="status" />
          <span>Loading recipes…</span>
        </div>
      )}

      {!loading && error && (
        <div className="state-center">
          <p style={{ color: 'var(--accent-dark)', margin: 0 }}>{error}</p>
          <button className="btn btn-secondary" onClick={onRetry}>Try again</button>
        </div>
      )}

      {!loading && !error && displayRecipes.length === 0 && (
        <div className="state-center">
          <p style={{ margin: 0, fontSize: 15 }}>No recipes yet.</p>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Add one manually or import from a TikTok / Instagram video.
          </p>
          <button className="btn btn-primary" onClick={onNew}>+ New recipe</button>
        </div>
      )}

      {!loading && !error && displayRecipes.length > 0 && filtered.length === 0 && (
        <div className="state-center">
          {search
            ? <p style={{ margin: 0 }}>No recipes match &ldquo;{search}&rdquo;.</p>
            : <p style={{ margin: 0 }}>No recipes match that filter.</p>
          }
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="card-grid">
          {filtered.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              onOpen={() => onOpen(r.id)}
              onFavorite={() => onFavorite(r.id)}
            />
          ))}
        </div>
      )}

      {/* ── Manage Filters Modal ─────────────────────────────────────────────── */}
      {manageOpen && (
        <ManageFiltersModal
          filters={userFilters}
          onClose={() => setManageOpen(false)}
          onFiltersChange={handleFiltersChange}
          onRecipesChange={handleRecipesChange}
        />
      )}
    </div>
  );
}

// ── RecipeCard ────────────────────────────────────────────────────────────────
function RecipeCard({ recipe, onOpen, onFavorite }) {
  const { title, image, minutes, cuisine, rating, favorite } = recipe;

  function handleFavClick(e) {
    e.stopPropagation();
    onFavorite();
  }

  return (
    <div>
      <div
        className="recipe-card-image"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        aria-label={`Open ${title}`}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        style={{ cursor: 'pointer' }}
      >
        <RecipeImage
          image={image}
          title={title}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
        <button
          className="recipe-card-fav"
          onClick={handleFavClick}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <HeartIcon filled={favorite} />
        </button>
      </div>
      <div
        className="recipe-card-title"
        onClick={onOpen}
        style={{ cursor: 'pointer' }}
      >
        {title}
      </div>
      <div className="recipe-card-meta" onClick={onOpen} style={{ cursor: 'pointer' }}>
        {minutes != null && <><span>{minutes} min</span><span>&middot;</span></>}
        {cuisine && <span>{cuisine}</span>}
        {rating != null && (
          <>
            <span className="desktop-only">&middot;</span>
            <span className="desktop-only">&#9733; {rating}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function HeartIcon({ filled, size = 16, color }) {
  const stroke = color || (filled ? '#c56a4a' : '#a8a29a');
  const fill = filled ? '#c56a4a' : 'none';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  );
}
