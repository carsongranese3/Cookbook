import { useEffect, useState, useCallback } from 'react';
import AppShell from './components/AppShell.jsx';
import Library from './screens/Library.jsx';
import RecipeDetail from './screens/RecipeDetail.jsx';
import RecipeFormScreen from './screens/RecipeFormScreen.jsx';
import AddFromVideo from './screens/AddFromVideo.jsx';
import MealPlan from './screens/MealPlan.jsx';
import ShoppingList from './screens/ShoppingList.jsx';
import CookingMode from './screens/CookingMode.jsx';
import { api } from './api.js';
import { getCurrentWeekDates } from './utils/week.js';

/**
 * View state machine:
 *   tab:     which sidebar/bottom-tab section is selected
 *   view:    sub-view within that tab (e.g. 'list' | 'detail' | 'form' | 'cooking')
 *   activeId: recipe id in context
 */
export default function App() {
  // ── Recipe collection (fetched once, kept fresh) ────────────────────────
  const [recipes, setRecipes]         = useState([]);
  const [recipesLoading, setRL]       = useState(true);
  const [recipesError, setRE]         = useState('');

  // ── Navigation state ────────────────────────────────────────────────────
  const [tab, setTab]       = useState('library'); // library | plan | shopping | add
  const [view, setView]     = useState('list');    // list | detail | form | cooking
  const [activeId, setAI]   = useState(null);
  const [newMode, setNewMode] = useState('manual'); // manual | import — for the New recipe screen

  // ── Single recipe fetch (for detail / edit after deep-link) ────────────
  const [detailRecipe, setDR]   = useState(null);
  const [detailLoading, setDL]  = useState(false);
  const [detailError, setDE]    = useState('');

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

  // ── Navigation helpers ──────────────────────────────────────────────────
  function goTab(t) {
    setTab(t);
    setView('list');
    setAI(null);
    setDR(null);
    setDE('');
  }

  function openDetail(id) {
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
    // detailRecipe is already loaded
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
        <CookingMode recipe={currentRecipe} onExit={backToDetail} />
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
          <>
            <AddFromVideo
              onSaved={handleAiSaved}
              isOffline={isOffline}
            />
            {/* Phone: secondary "Enter manually" link */}
            <div id="ph-manual-link-wrap" style={{ display: 'none', padding: '0 20px 20px' }}>
              <style>{`@media (max-width:767px){#ph-manual-link-wrap{display:block}}`}</style>
              <button className="ph-manual-link" onClick={openNew}>
                or enter a recipe manually
              </button>
            </div>
          </>
        )}
      </AppShell>
    </>
  );
}
