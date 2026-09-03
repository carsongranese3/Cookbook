import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { PANTRY_CATEGORIES } from './PantryScreen.jsx';
import { titleCase } from '../utils/text.js';

// Fold an unknown category into "Other" so every item lands in a known section.
const catOf = (it) =>
  PANTRY_CATEGORIES.includes(it.category) ? it.category : 'Other';

// Build the text pasted into Apple Reminders: one item name per line, since
// Reminders turns each pasted line into its own reminder. Names only — quantities
// are deliberately left off. Only unchecked items; checked ones are already in the
// cart. Ordered by category (matching the on-screen sections) so like items land
// together, since Reminders has no headers of its own.
function buildListText(items) {
  const order = new Map(PANTRY_CATEGORIES.map((c, i) => [c, i]));
  return items
    .filter((it) => !it.checked)
    .slice()
    .sort((a, b) => {
      const d = order.get(catOf(a)) - order.get(catOf(b));
      return d !== 0 ? d : a.position - b.position;
    })
    .map((it) => titleCase(it.name))
    .join('\n');
}

// Name of the macOS/iOS Shortcut that turns the pasted lines into individual
// reminders. Must match the Shortcut exactly, or Shortcuts reports "not found".
const SHORTCUT_NAME = 'Add to Groceries';

// Legacy execCommand copy, for the non-secure-context case (this app is served
// over plain HTTP via Tailscale, so navigator.clipboard does not exist there).
//
// Uses a contentEditable <div> holding a real child text node. A <textarea> does
// NOT work: its value is not a child node, so range.selectNodeContents() selects
// nothing and the copy silently succeeds with an empty clipboard.
// Must run synchronously inside a user gesture.
function copyViaExecCommand(text) {
  let host = null;
  try {
    host = document.createElement('div');
    host.textContent = text;
    host.contentEditable = 'true';
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.bottom = '0';
    host.style.width = '1px';
    host.style.height = '1px';
    host.style.padding = '0';
    host.style.border = 'none';
    host.style.outline = 'none';
    host.style.overflow = 'hidden';
    host.style.whiteSpace = 'pre';  // preserve the line breaks
    host.style.fontSize = '16px';   // under 16px makes iOS zoom the viewport
    host.style.opacity = '0';
    document.body.appendChild(host);

    const range = document.createRange();
    range.selectNodeContents(host);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    return ok;
  } catch {
    return false;
  } finally {
    if (host) host.remove();
  }
}

// ── Manual-copy panel ────────────────────────────────────────
// Shown whenever the one-tap clipboard write is not available (plain HTTP) or
// fails. The text is on screen and pre-selected, so copying by hand always
// works even if every programmatic path is blocked.
function CopyFallbackModal({ text, onClose }) {
  const taRef = useRef(null);
  const [status, setStatus] = useState('');

  const selectAll = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
  };

  useEffect(() => { selectAll(); }, []);

  function handleCopyClick() {
    if (copyViaExecCommand(text)) {
      setStatus('Copied — now paste into Reminders.');
    } else {
      selectAll();
      setStatus('Still blocked. The text is selected — press and hold it, then tap Copy.');
    }
  }

  return (
    <div
      className="modal-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Copy list for Reminders"
    >
      <div className="modal-box pantry-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header mf-header">
          <span>Copy for Reminders</span>
          <button className="mf-close-btn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13"/>
            </svg>
          </button>
        </div>
        <div className="modal-body" style={{ padding: '16px 20px 20px' }}>
          <p className="form-hint" style={{ margin: '0 0 10px' }}>
            Tap Copy below. If nothing lands on the clipboard, press and hold the
            selected text and choose Copy — then paste into a Reminders list.
          </p>
          <textarea
            ref={taRef}
            className="form-input form-textarea copy-fallback-text"
            defaultValue={text}
            rows={Math.min(14, text.split('\n').length + 1)}
            onFocus={selectAll}
          />
          {status && (
            <p className="shop-pantry-msg" role="status" style={{ marginTop: 8 }}>{status}</p>
          )}
          <div className="form-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={handleCopyClick}>Copy</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ShoppingList ───────────────────────────────────────────────────────────
export default function ShoppingList({ isOffline }) {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [formOpen, setFormOpen]   = useState(false);
  const [pantryMsg, setPantryMsg] = useState('');
  const [movingToPantry, setMovingToPantry] = useState(false);
  const [copyMsg, setCopyMsg]           = useState('');
  const [copyFallback, setCopyFallback] = useState(null); // text, or null

  // Category toggle bar (same as Pantry): which category sections are shown.
  // Seeded once from content — categories with items on, empty ones off.
  const [activeCats, setActiveCats] = useState(() => new Set());
  const catsInitialized = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.shopping.get();
      setItems(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Seed the category toggles the first time items arrive: on where there are
  // items, off where empty. After that, toggles are the user's to control.
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

  const uncheckedCount = items.filter((i) => !i.checked).length;

  async function handleAdd({ name, qty, category }) {
    // Throws on failure so the modal can show the error and stay open.
    const created = await api.shopping.add(name, qty, category || undefined);
    setItems((prev) => [...prev, created]);
    // Reveal the item's category in case it was toggled off (or empty before).
    setActiveCats((prev) => new Set(prev).add(catOf(created)));
    setFormOpen(false);
  }

  async function handleToggle(id) {
    if (isOffline) return;
    // Optimistic update
    setItems((prev) =>
      prev.map((it) => it.id === id ? { ...it, checked: !it.checked } : it)
    );
    try {
      const updated = await api.shopping.toggle(id);
      setItems((prev) => prev.map((it) => it.id === id ? updated : it));
    } catch (e) {
      // revert
      setItems((prev) =>
        prev.map((it) => it.id === id ? { ...it, checked: !it.checked } : it)
      );
    }
  }

  async function handleDelete(id) {
    if (isOffline) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
    try {
      await api.shopping.remove(id);
    } catch (e) {
      await load();
    }
  }

  async function handleClearChecked() {
    if (isOffline) return;
    const checked = items.filter((i) => i.checked);
    if (checked.length === 0) return;
    setItems((prev) => prev.filter((i) => !i.checked));
    try {
      await api.shopping.clearChecked();
    } catch (e) {
      await load();
    }
  }

  // Hand the list to the Shortcut, which adds one reminder per line. Reminders
  // itself will not split a pasted multi-line block, so something has to create
  // them one at a time — that is what the Shortcut is for.
  //
  // The text is sent BOTH as the shortcut input and on the clipboard, so this
  // works whether the Shortcut starts with "Shortcut Input" or "Get Clipboard".
  function handleSendToShortcut() {
    const text = buildListText(items);
    if (!text) return;
    copyViaExecCommand(text); // best effort; harmless if it fails
    const url =
      'shortcuts://run-shortcut?name=' + encodeURIComponent(SHORTCUT_NAME) +
      '&input=text&text=' + encodeURIComponent(text);
    window.location.href = url;
  }

  async function handleCopyForReminders() {
    const text = buildListText(items);
    if (!text) return;
    // One-tap path only exists in a secure context (HTTPS/localhost). Over plain
    // HTTP there is no navigator.clipboard, so go straight to the manual panel
    // rather than firing a copy that can report success while doing nothing.
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopyMsg('Copied — paste into Reminders');
        setTimeout(() => setCopyMsg(''), 3000);
        return;
      } catch {
        // Blocked by permissions — fall through to the panel.
      }
    }
    setCopyFallback(text);
  }

  async function handleMoveToPantry() {
    if (isOffline) return;
    const checkedItems = items.filter((i) => i.checked);
    if (checkedItems.length === 0) {
      setPantryMsg('No checked items to move.');
      setTimeout(() => setPantryMsg(''), 3000);
      return;
    }
    setMovingToPantry(true);
    // Optimistically remove checked items from list
    setItems((prev) => prev.filter((i) => !i.checked));
    try {
      const result = await api.shopping.moveToPantry();
      const n = result?.moved?.length ?? 0;
      setPantryMsg(n > 0 ? `Moved ${n} to your pantry.` : 'No checked items to move.');
      setTimeout(() => setPantryMsg(''), 3500);
    } catch (e) {
      setPantryMsg('Could not move to pantry.');
      setTimeout(() => setPantryMsg(''), 3500);
      await load(); // revert on error
    } finally {
      setMovingToPantry(false);
    }
  }

  if (loading) {
    return (
      <div className="page-pad">
        <div className="state-center">
          <div className="spinner" aria-label="Loading shopping list" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  // Filter by search, then group into the active (toggled-on) category sections.
  const searchLower = search.trim().toLowerCase();
  const filtered = searchLower
    ? items.filter((it) => it.name.toLowerCase().includes(searchLower))
    : items;

  // Total item count per category (unfiltered) — drives chip labels + initial state.
  const countByCat = Object.fromEntries(PANTRY_CATEGORIES.map((c) => [c, 0]));
  for (const it of items) countByCat[catOf(it)] += 1;

  // Sections to render: active categories, in fixed order. While searching,
  // drop active-but-empty sections to cut noise.
  const sections = PANTRY_CATEGORIES
    .filter((cat) => activeCats.has(cat))
    .map((cat) => ({ category: cat, items: filtered.filter((it) => catOf(it) === cat) }))
    .filter((g) => (searchLower ? g.items.length > 0 : true));

  const searchBox = (extraStyle) => (
    <div className="search-box" style={extraStyle}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a8a29a" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
      </svg>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search list…"
        aria-label="Search shopping list"
      />
    </div>
  );

  return (
    <>
      {formOpen && (
        <ShoppingFormModal onSave={handleAdd} onClose={() => setFormOpen(false)} />
      )}

      {copyFallback !== null && (
        <CopyFallbackModal text={copyFallback} onClose={() => setCopyFallback(null)} />
      )}

      <div className="page-pad">
        {/* Header — mirrors the Pantry screen */}
        <div className="library-header">
          <div>
            <div className="eyebrow">{uncheckedCount} to buy</div>
            <h1 className="page-title" style={{ margin: 0 }}>Shopping List</h1>
          </div>
          <div className="desktop-flex" style={{ alignItems: 'center', gap: 10 }}>
            {searchBox({ width: 240 })}
            <button className="btn btn-primary" onClick={() => setFormOpen(true)} disabled={isOffline}>
              + Add item
            </button>
          </div>

          {/* Phone: top-right add button */}
          <button className="btn btn-primary header-add-btn" onClick={() => setFormOpen(true)} disabled={isOffline}>
            + Add
          </button>
        </div>

        {/* Phone: full-width search (add button lives in the header, top-right) */}
        <div className="phone-block" style={{ marginTop: 14 }}>
          {searchBox({ borderRadius: 12, height: 42 })}
        </div>

        {/* Category toggle bar — one button per section (same as Pantry) */}
        {items.length > 0 && (
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

        {items.length > 0 && (
          <div className="shop-actions">
            <button
              className="btn btn-ghost shop-action-btn"
              onClick={handleSendToShortcut}
              disabled={uncheckedCount === 0}
              title={`Send the list to the "${SHORTCUT_NAME}" shortcut, which adds one reminder per item`}
            >
              Send to Reminders
            </button>
            {/* Copy is purely local — deliberately not gated on isOffline. */}
            <button
              className="btn btn-ghost shop-action-btn"
              onClick={handleCopyForReminders}
              disabled={uncheckedCount === 0}
              title="Copy unchecked items, one per line, to paste into Reminders"
            >
              {copyMsg || `Copy ${uncheckedCount} for Reminders`}
            </button>
            {items.some((i) => i.checked) && (
              <>
                <button
                  className="btn btn-ghost shop-action-btn"
                  onClick={handleMoveToPantry}
                  disabled={isOffline || movingToPantry}
                  title="Move checked items to your pantry"
                >
                  {movingToPantry ? 'Moving…' : 'Move to Pantry'}
                </button>
                <button
                  className="btn btn-ghost shop-action-btn"
                  onClick={handleClearChecked}
                  disabled={isOffline}
                >
                  Clear checked
                </button>
              </>
            )}
          </div>
        )}
        {pantryMsg && (
          <p className="shop-pantry-msg" role="status">{pantryMsg}</p>
        )}

        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              className="btn btn-ghost"
              onClick={load}
              style={{ marginLeft: 10, height: 28, fontSize: 12 }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state (nothing on the list) */}
        {items.length === 0 && !error && (
          <div className="state-center">
            <p style={{ margin: 0, fontSize: 15 }}>Your list is empty.</p>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Add an item, or send ingredients here from a recipe.
            </p>
            <button className="btn btn-primary" onClick={() => setFormOpen(true)} disabled={isOffline}>
              + Add item
            </button>
          </div>
        )}

        {/* No sections shown (search miss, or all categories toggled off) */}
        {items.length > 0 && sections.length === 0 && (
          <div className="state-center">
            <p style={{ margin: 0 }}>
              {searchLower
                ? <>No items match &ldquo;{search}&rdquo;.</>
                : 'No categories shown — turn one on above.'}
            </p>
          </div>
        )}

        {/* Category sections */}
        {sections.length > 0 && (
          <div className="pantry-list">
            {sections.map((group) => (
              <div key={group.category} className="pantry-section">
                <div className="pantry-section-header">{group.category}</div>
                <div className="pantry-section-items" role="list" aria-label={group.category}>
                  {group.items.length === 0 && (
                    <div className="pantry-empty-hint">Nothing here yet.</div>
                  )}
                  {group.items.map((item) => (
                    <div key={item.id} className="shop-item" role="listitem">
                      <button
                        className={`shop-checkbox ${item.checked ? 'checked' : ''}`}
                        onClick={() => handleToggle(item.id)}
                        aria-label={item.checked ? `Uncheck ${item.name}` : `Check ${item.name}`}
                        aria-pressed={item.checked}
                        disabled={isOffline}
                      >
                        {item.checked && (
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5" aria-hidden="true">
                            <path d="M2 6l3 3 5-5"/>
                          </svg>
                        )}
                      </button>
                      <span className={`shop-item-name ${item.checked ? 'checked' : ''}`}>
                        {titleCase(item.name)}
                      </span>
                      {item.qty && (
                        <span className="shop-item-qty">{item.qty}</span>
                      )}
                      <button
                        className="shop-item-delete"
                        onClick={() => handleDelete(item.id)}
                        aria-label={`Delete ${item.name}`}
                        disabled={isOffline}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
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
