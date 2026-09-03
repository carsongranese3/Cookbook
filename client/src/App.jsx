import { useEffect, useState, useCallback, useRef } from 'react';
import AppShell from './components/AppShell.jsx';
import Library from './screens/Library.jsx';
import RecipeDetail from './screens/RecipeDetail.jsx';
import RecipeFormScreen from './screens/RecipeFormScreen.jsx';
import AddFromVideo from './screens/AddFromVideo.jsx';
import MealPlan from './screens/MealPlan.jsx';
import ShoppingList from './screens/ShoppingList.jsx';
import CookingMode from './screens/CookingMode.jsx';
import HistoryScreen from './screens/HistoryScreen.jsx';
import PantryScreen from './screens/PantryScreen.jsx';
import { api } from './api.js';
import { getCurrentWeekDates, todayISO } from './utils/week.js';

/**
 * View state machine:
 *   tab:     library | plan | shopping | pantry | add | history
 *   view:    list | detail | form | cooking
 *   activeId: recipe id in context
 *
 * URL routing maps this state to a path (and back), so every screen is
 * bookmarkable/shareable and the browser Back/Forward buttons work.
 */
const TAB_PATHS = {
  library: '/',
  plan: '/plan',
  shopping: '/shopping',
  pantry: '/pantry',
  history: '/history',
  add: '/add',
};

/** (tab, view, activeId) → URL path. */
function pathForState(tab, view, activeId) {
  if (view === 'detail' && activeId) return `/recipe/${activeId}`;
  if (view === 'cooking' && activeId) return `/recipe/${activeId}/cook`;
  if (view === 'form') return activeId ? `/recipe/${activeId}/edit` : '/new';
  return TAB_PATHS[tab] || '/';
}

/** URL path → { tab, view, activeId }. Unknown paths fall back to the library. */
function stateFromPath(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  const rec = p.match(/^\/recipe\/([^/]+)(\/edit|\/cook)?$/);
  if (rec) {
    const activeId = decodeURIComponent(rec[1]);
    if (rec[2] === '/edit') return { tab: 'library', view: 'form', activeId };
    if (rec[2] === '/cook') return { tab: 'library', view: 'cooking', activeId };
    return { tab: 'library', view: 'detail', activeId };
  }
  if (p === '/new') return { tab: 'library', view: 'form', activeId: null };
  const entry = Object.entries(TAB_PATHS).find(([, path]) => path === p);
  if (entry) return { tab: entry[0], view: 'list', activeId: null };
  return { tab: 'library', view: 'list', activeId: null };
}

export default function App() {
  // ── Recipe collection (fetched once, kept fresh) ────────────────────────
  const [recipes, setRecipes]         = useState([]);
  const [recipesLoading, setRL]       = useState(true);
  const [recipesError, setRE]         = useState('');

  // ── Navigation state (seeded from the URL for deep-linking) ───────────────
  const initialRoute = stateFromPath(window.location.pathname);
  const [tab, setTab]       = useState(initialRoute.tab);   // library | plan | shopping | pantry | add | history
  const [view, setView]     = useState(initialRoute.view);  // list | detail | form | cooking
  const [activeId, setAI]   = useState(initialRoute.activeId);
  const [newMode, setNewMode] = useState('manual'); // manual | import — for the New recipe screen

  // ── Single recipe fetch (for detail / edit after deep-link) ────────────
  const [detailRecipe, setDR]   = useState(null);
  const [detailLoading, setDL]  = useState(false);
  const [detailError, setDE]    = useState('');

  // ── History prefill (set when Cook Mode finishes) ───────────────────────
  const [historyPrefill, setHistoryPrefill] = useState(null);

  // ── Offline detection ───────────────────────────────────────────────────
  const [isOffline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const online  = () => setOffline(false);
    const offline = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  // ── Week dates for "Add to plan" on detail ──────────────────────────────
  const [weekDays] = useState(() => getCurrentWeekDates());

  // ── Load recipe list ────────────────────────────────────────────────────
  const loadRecipes = useCallback(async () => {
    setRL(true);
    setRE('');
    try {
      const data = await api.list();
      setRecipes(data);
    } catch (e) {
      setRE(e.message);
    } finally {
      setRL(false);
    }
  }, []);

  useEffect(() => { loadRecipes(); }, [loadRecipes]);

  // ── Load a single recipe ────────────────────────────────────────────────
  const loadDetail = useCallback(async (id) => {
    setDL(true);
    setDE('');
    setDR(null);
    try {
      const data = await api.get(id);
      setDR(data);
    } catch (e) {
      if (e.status === 404) {
        setDE('Recipe not found.');
      } else {
        setDE(e.message);
      }
    } finally {
      setDL(false);
    }
  }, []);

  // ── URL routing ───────────────────────────────────────────────────────────
  // Set true right before a popstate-driven state change so the sync effect
  // below doesn't push a duplicate history entry for it.
  const skipPush = useRef(false);

  // On first load: hydrate a deep-linked recipe and seed a history state object.
  useEffect(() => {
    if (initialRoute.activeId) loadDetail(initialRoute.activeId);
    window.history.replaceState({ app: true }, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push a new URL whenever navigation state changes (unless it came from Back).
  useEffect(() => {
    if (skipPush.current) { skipPush.current = false; return; }
    const path = pathForState(tab, view, activeId);
    if (window.location.pathname !== path) {
      window.history.pushState({ app: true }, '', path);
    }
  }, [tab, view, activeId]);

  // Back/Forward: restore navigation state from the URL.
  useEffect(() => {
    function onPop() {
      const s = stateFromPath(window.location.pathname);
      skipPush.current = true;
      setTab(s.tab);
      setView(s.view);
      setAI(s.activeId);
      if (s.activeId) {
        loadDetail(s.activeId);
      } else {
        setDR(null);
        setDE('');
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [loadDetail]);

  // ── Navigation helpers ──────────────────────────────────────────────────
  function goTab(t) {
    setTab(t);
    setView('list');
    setAI(null);
    setDR(null);
    setDE('');
  }

  function openDetail(id) {
    setTab('library');
    setAI(id);
    setView('detail');
    loadDetail(id);
  }

  function openNew() {
    setTab('library');
    setAI(null);
    setDR(null);
    setNewMode('manual');
    setView('form');
  }

  function openEdit(id) {
    setAI(id);
    setView('form');
  }

  function openCooking() {
    setView('cooking');
  }

  function backToDetail() {
    setView('detail');
  }

  function backToList() {
    setTab('library');
    setView('list');
    setAI(null);
    setDR(null);
    setDE('');
  }

  // ── Cook Mode finish → pre-fill History entry ────────────────────────────
  function handleCookFinish(recipe) {
    setHistoryPrefill({ recipe_id: recipe.id, recipe, date: todayISO() });
    goTab('history');
  }

  // ── Recipe CRUD ─────────────────────────────────────────────────────────
  async function handleFavorite(id) {
    try {
      const updated = await api.favorite(id);
      setRecipes((prev) => prev.map((r) => r.id === id ? updated : r));
      if (detailRecipe?.id === id) setDR(updated);
    } catch (e) {
      // ignore offline/error silently; UI stays optimistic
    }
  }

  async function handleSave(data) {
    if (activeId) {
      const updated = await api.update(activeId, data);
      setRecipes((prev) => prev.map((r) => r.id === activeId ? updated : r));
      setDR(updated);
      setView('detail');
    } else {
      const created = await api.create(data);
      await loadRecipes();
      setAI(created.id);
      setDR(created);
      setView('detail');
    }
  }

  async function handleDelete() {
    if (!activeId) return;
    await api.remove(activeId);
    await loadRecipes();
    backToList();
  }

  async function handleAddToList(recipeId) {
    return api.shopping.fromRecipe(recipeId);
  }

  async function handleAddToPlan(day, recipeId) {
    await api.mealPlan.add(day, recipeId);
  }

  // After AI import saves a new recipe
  async function handleAiSaved(newId) {
    await loadRecipes();
    openDetail(newId);
  }

  // ── The recipe shown in detail/form ────────────────────────────────────
  // Prefer fresh detailRecipe; fall back to recipe from list (stale but ok).
  const currentRecipe = detailRecipe || recipes.find((r) => r.id === activeId) || null;

  // ── Cooking mode needs the current recipe ──────────────────────────────
  if (view === 'cooking' && currentRecipe) {
    return (
      <>
        {isOffline && <div className="offline-toast">You're offline</div>}
        <CookingMode
          recipe={currentRecipe}
          onExit={backToDetail}
          onFinish={handleCookFinish}
        />
      </>
    );
  }

  return (
    <>
      {isOffline && <div className="offline-toast">You're offline — showing cached data</div>}
      <AppShell
        activeTab={tab}
        onNav={goTab}
        recipeCount={recipes.length}
      >
        {/* ── Library ── */}
        {tab === 'library' && view === 'list' && (
          <Library
            recipes={recipes}
            loading={recipesLoading}
            error={recipesError}
            onRetry={loadRecipes}
            onOpen={openDetail}
            onNew={openNew}
            onFavorite={handleFavorite}
          />
        )}

        {/* ── Recipe Detail ── */}
        {view === 'detail' && (
          <RecipeDetail
            recipe={currentRecipe}
            loading={detailLoading}
            error={detailError}
            onBack={backToList}
            onEdit={() => openEdit(activeId)}
            onDelete={handleDelete}
            onFavorite={handleFavorite}
            onAddToList={() => handleAddToList(activeId)}
            onStartCooking={openCooking}
            weekDays={weekDays}
            onAddToPlan={handleAddToPlan}
            onRecipeChange={(updated) => {
              setDR(updated);
              setRecipes((prev) => prev.map((r) => r.id === updated.id ? updated : r));
            }}
          />
        )}

        {/* ── Recipe Form: edit an existing recipe ── */}
        {view === 'form' && activeId && (
          <RecipeFormScreen
            key={activeId}
            recipe={currentRecipe}
            onSave={handleSave}
            onCancel={() => {
              if (currentRecipe) setView('detail');
              else backToList();
            }}
          />
        )}

        {/* ── New recipe: toggle between manual entry and video import ── */}
        {view === 'form' && !activeId && (
          <div className="page-pad">
            <div className="eyebrow">My Kitchen</div>
            <h1 className="page-title" style={{ marginBottom: 16 }}>New recipe</h1>
            <div className="segmented" role="tablist" aria-label="How to add a recipe">
              <button
                role="tab"
                aria-selected={newMode === 'manual'}
                className={`segmented-btn ${newMode === 'manual' ? 'active' : ''}`}
                onClick={() => setNewMode('manual')}
              >
                Enter manually
              </button>
              <button
                role="tab"
                aria-selected={newMode === 'import'}
                className={`segmented-btn ${newMode === 'import' ? 'active' : ''}`}
                onClick={() => setNewMode('import')}
              >
                Import from video
              </button>
            </div>
            {newMode === 'manual' ? (
              <RecipeFormScreen embedded recipe={null} onSave={handleSave} onCancel={backToList} />
            ) : (
              <AddFromVideo embedded onSaved={handleAiSaved} isOffline={isOffline} />
            )}
          </div>
        )}

        {/* ── Meal Plan ── */}
        {tab === 'plan' && view === 'list' && (
          <MealPlan
            onOpenRecipe={(id) => { openDetail(id); }}
            isOffline={isOffline}
          />
        )}

        {/* ── Shopping List ── */}
        {tab === 'shopping' && view === 'list' && (
          <ShoppingList isOffline={isOffline} />
        )}

        {/* ── Add from Video ── */}
        {tab === 'add' && view === 'list' && (
          <AddFromVideo
            onSaved={handleAiSaved}
            isOffline={isOffline}
          />
        )}

        {/* ── Pantry ── */}
        {tab === 'pantry' && view === 'list' && (
          <PantryScreen isOffline={isOffline} />
        )}

        {/* ── History ── */}
        {tab === 'history' && view === 'list' && (
          <HistoryScreen
            onOpenRecipe={openDetail}
            prefill={historyPrefill}
            onPrefillHandled={() => setHistoryPrefill(null)}
            isOffline={isOffline}
          />
        )}
      </AppShell>
    </>
  );
}
