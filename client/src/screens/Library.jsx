import { useState, useMemo } from 'react';
import RecipeImage from '../components/RecipeImage.jsx';

const CHIPS = [
  { label: 'All',        id: 'all' },
  { label: 'Dinners',    id: 'Dinner' },
  { label: 'Breakfast',  id: 'Breakfast' },
  { label: 'Desserts',   id: 'Dessert' },
  { label: 'Quick',      id: 'Quick' },
  { label: 'Vegetarian', id: 'Vegetarian' },
];

function matchesChip(recipe, chipId) {
  if (chipId === 'all') return true;
  if (chipId === 'Quick') return (recipe.minutes ?? 999) <= 25;
  if (chipId === 'Vegetarian') {
    const tags = recipe.tags || [];
    return tags.some((t) => t.toLowerCase() === 'vegetarian');
  }
  return recipe.category === chipId;
}

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

export default function Library({ recipes, loading, error, onRetry, onOpen, onNew, onFavorite }) {
  const [search, setSearch] = useState('');
  const [activeChip, setActiveChip] = useState('all');

  const filtered = useMemo(() => {
    return recipes.filter(
      (r) => matchesChip(r, activeChip) && matchesSearch(r, search)
    );
  }, [recipes, activeChip, search]);

  return (
    <div className="page-pad">
      {/* Header */}
      <div className="library-header">
        <div>
          <div className="eyebrow">My Kitchen</div>
          {/* Desktop: just the title */}
          <h1 className="page-title desktop-only" style={{ margin: 0 }}>Recipes</h1>
          {/* Phone: title + recipe count side by side */}
          <div className="ph-title-count-row phone-only">
            <h1 className="page-title" style={{ margin: 0 }}>Recipes</h1>
            <span className="ph-recipe-count">{recipes.length}</span>
          </div>
        </div>

        {/* Desktop: search box + New recipe button */}
        <div className="desktop-flex" style={{ alignItems: 'center', gap: 10 }}>
          <div className="search-box" style={{ width: 280 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a8a29a" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
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
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes"
            aria-label="Search recipes"
          />
        </div>
      </div>

      {/* Filter chips */}
      <div className="chip-row" role="group" aria-label="Filter recipes">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            className={`chip ${activeChip === c.id ? 'active' : ''}`}
            onClick={() => setActiveChip(c.id)}
            aria-pressed={activeChip === c.id}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* States */}
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

      {!loading && !error && recipes.length === 0 && (
        <div className="state-center">
          <p style={{ margin: 0, fontSize: 15 }}>No recipes yet.</p>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Add one manually or import from a TikTok / Instagram video.
          </p>
          <button className="btn btn-primary" onClick={onNew}>+ New recipe</button>
        </div>
      )}

      {!loading && !error && recipes.length > 0 && filtered.length === 0 && (
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
    </div>
  );
}

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
        {/* ★ rating: desktop only */}
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
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  );
}
