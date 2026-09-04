import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { api } from '../api.js';
import { PANTRY_CATEGORIES } from './PantryScreen.jsx';
import { titleCase } from '../utils/text.js';
import StoreSettingsForm from '../components/StoreSettingsForm.jsx';

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

// Format a receipt-priced item's `updated_at` (the observation's `purchased_at`,
// docs/api.md § GET /prices) for the price marker's title/aria-label. That value
// is either a bare YYYY-MM-DD (the receipt's own printed date) or a full ISO
// timestamp (fallback to scan time) — append a noon time only to the bare form,
// same trick as utils/week.js's formatDayDate, so a UTC-midnight date string
// can't roll back a day in a negative-offset timezone. Matches the app's
// existing "Aug 12" short-date convention (HistoryScreen, week.js).
function formatReceiptDate(value) {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value}T12:00:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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

// ── Add item form modal ──────────────────────────────────────
// Inline in this file (not its own component file) to mirror PantryFormModal,
// which lives inline in PantryScreen.jsx right beside its call site.
//
// onSave is called with exactly { name, qty, category } — matching handleAdd's
// signature above. `category` is '' (Auto-detect) unless the user picks one;
// handleAdd passes `category || undefined` on to the API, so an empty string
// lets the server's own guessCategory(name) classify it, same as the receipt
// importer's fallback.
function ShoppingFormModal({ onSave, onClose }) {
  const [name, setName]         = useState('');
  const [qty, setQty]           = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const submittingRef = useRef(false); // guards a double-click firing two saves

  // Escape closes, matching the other modals' click-outside-to-close behavior.
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required.'); return; }
    submittingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave({ name: trimmed, qty: qty.trim(), category });
    } catch (err) {
      setError(err.message || 'Could not add that item.');
      setSaving(false);
      submittingRef.current = false;
    }
  }

  return (
    <div
      className="modal-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add item to shopping list"
    >
      <div className="modal-box shop-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header mf-header">
          <span>Add item</span>
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
              <label htmlFor="shop-item-name" className="form-label">Name <span aria-hidden>*</span></label>
              <input
                id="shop-item-name"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Olive oil"
                autoFocus
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label htmlFor="shop-item-qty" className="form-label">Quantity</label>
              <input
                id="shop-item-qty"
                className="form-input"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 1 lb, 2, 1 bag"
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label htmlFor="shop-item-cat" className="form-label">Category</label>
              <select
                id="shop-item-cat"
                className="form-input form-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={saving}
              >
                <option value="">Auto-detect</option>
                {PANTRY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Adding…' : 'Add item'}
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

// ── Store picker modal ───────────────────────────────────────
// Same pattern as ShoppingFormModal above: modal-scrim → modal-box → mf-header
// / mf-close-btn → modal-body → form. The fields themselves live in
// StoreSettingsForm, shared with the Settings modal (see AppShell.jsx) —
// this wrapper just supplies the "Set store" chrome; the chain list still
// comes entirely from the server, never hardcoded (spec §3.4 / AC-1.3).
//
// onSave receives the already-saved { store, zip, stores } once
// StoreSettingsForm's own request succeeds.
function StorePickerModal({ storeInfo, onSave, onClose }) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="modal-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a grocery store"
    >
      <div className="modal-box store-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header mf-header">
          <span>Set store</span>
          <button className="mf-close-btn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13"/>
            </svg>
          </button>
        </div>
        <div className="modal-body" style={{ padding: '16px 20px 20px' }}>
          <StoreSettingsForm storeInfo={storeInfo} onSaved={onSave} onCancel={onClose} />
        </div>
      </div>
    </div>
  );
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
  // Send to Reminders and Copy for Reminders share one button, one state at a
  // time (docs/decisions.md "2026-09-03 — Reminders becomes one toggling
  // button"). 'copy' is the default/rest state; a successful copy flips it to
  // 'send', and sending flips it right back. useState('copy') as the initial
  // value is also what makes "leaving the page" reset it for free — this
  // screen unmounts on tab change (see App.jsx), so there's nothing to persist.
  const [reminderStage, setReminderStage] = useState('copy'); // 'copy' | 'send'

  // The button must never offer to Send a clipboard that no longer matches the
  // list. Call this from every path that mutates `items` (or a price) instead
  // of scattering setReminderStage calls next to each one — one place to
  // remember, not a list of conditions to keep in sync.
  const invalidateReminderCopy = useCallback(() => {
    setReminderStage('copy');
  }, []);

  // ── Price estimation ─────────────────────────────────────────
  // Store choice is server-persisted (settings table) so the Mac and phone
  // agree. A price is a property of an ITEM, not a snapshot of a press
  // (docs/decisions.md "Prices persist per item, not per estimate"): it is
  // hydrated from the server-side cache on mount and again after a press,
  // and both routes populate the exact same `priceItems` state.
  const [storeInfo, setStoreInfo]       = useState({ store: '', zip: '', stores: [] });
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [priceItems, setPriceItems]     = useState([]);     // [{id, price, qty_priced}]
  const [estimating, setEstimating]     = useState(false);
  const [estimateError, setEstimateError] = useState('');
  // Default ON (skip checked items) — the common case is "what's left to spend".
  const [skipChecked, setSkipChecked]   = useState(true);

  // ── Manual price editing ─────────────────────────────────────
  // Tap the price (or the — on an unpriced row) to edit it inline. Only one
  // row is editable at a time. A manual price is still just a price_book row
  // server-side (docs/decisions.md "2026-09-03 — Manual prices"), so saving
  // it returns the same whole-list payload as GET /prices and POST /estimate —
  // priceItems is replaced wholesale, never patched one entry at a time.
  const [editingPriceId, setEditingPriceId] = useState(null);
  const [priceDraft, setPriceDraft]         = useState('');
  const [priceEditError, setPriceEditError] = useState('');
  const [priceSaving, setPriceSaving]       = useState(false);
  const priceSavingRef = useRef(false);   // sync guard — state updates lag a render
  const escapedRef     = useRef(false);   // Escape just fired; the blur it causes must not re-commit
  const priceOriginalRef = useRef(null);  // value at edit-start, to skip a no-op save on blur

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

  const loadStore = useCallback(async () => {
    try {
      const data = await api.shopping.getStore();
      setStoreInfo(data);
    } catch {
      // Endpoint missing/erroring just leaves storeInfo at its "no store" default —
      // the Estimate button degrades to opening the (empty) store picker.
    }
  }, []);

  // Read-only hydration of whatever the price cache already holds — no Gemini
  // call, so this is safe on every mount/reload. Populates the exact same
  // state a successful Estimate press does, which is what makes a price
  // "stick to its ingredient" across a reload.
  const loadPrices = useCallback(async () => {
    try {
      const data = await api.shopping.getPrices();
      setPriceItems(data.items);
    } catch {
      // Missing/erroring endpoint just leaves prices unhydrated for this
      // session — the Estimate button still works and fills them in.
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStore(); }, [loadStore]);
  useEffect(() => { loadPrices(); }, [loadPrices]);

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
    invalidateReminderCopy();
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
    // buildListText filters to unchecked items only, so a check/uncheck
    // genuinely changes what would be pasted — reset regardless of whether
    // the request below ends up succeeding or reverting.
    invalidateReminderCopy();
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
    invalidateReminderCopy();
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
    invalidateReminderCopy();
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

  // The round trip (Copy, then Send) is done once this runs, so the button
  // goes back to offering a fresh Copy — the next useful action.
  function handleSendClick() {
    handleSendToShortcut();
    setReminderStage('copy');
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
        // Secure context: flip to Send right alongside the copy confirmation
        // above, since the clipboard write already succeeded.
        setReminderStage('send');
        return;
      } catch {
        // Blocked by permissions — fall through to the panel.
      }
    }
    // Non-secure context (or a blocked clipboard permission): the flip to
    // Send happens when CopyFallbackModal is closed, not here — the user
    // hasn't actually copied anything yet at the point they tap this button.
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
    invalidateReminderCopy();
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

  // StoreSettingsForm already made the save request by the time this fires —
  // just adopt the result and close (mirrors the Settings modal's own path).
  // Re-hydrate prices too: the cache is keyed by (store, zip, …), so a store/
  // ZIP change needs no bespoke staleness handling — just re-ask the same
  // free GET for whatever the price book holds under the new key. Without
  // this, the old store's cached numbers would keep showing next to the new
  // store's name until the next reload.
  function handleSaveStore(data) {
    setStoreInfo(data);
    setStoreModalOpen(false);
    loadPrices();
  }

  async function handleEstimateClick() {
    if (isOffline || estimating) return;
    setEstimateError('');
    // No store yet: open the picker instead of firing a request (spec §6.2 / AC-9).
    if (!storeInfo.store) {
      setStoreModalOpen(true);
      return;
    }
    setEstimating(true);
    try {
      const data = await api.shopping.estimate();
      setPriceItems(data.items);
      setSkipChecked(true); // fresh press always starts with the default
    } catch (e) {
      setEstimateError(e.message || 'Could not estimate prices.');
    } finally {
      setEstimating(false);
    }
  }

  // Tapping the price (or —) opens the inline editor. No store yet: open the
  // store picker instead, exactly like the Estimate button does in that state —
  // there is nowhere to key a price without a store+ZIP.
  function startEditPrice(item, currentPrice) {
    if (isOffline || priceSavingRef.current) return;
    if (!storeInfo.store) {
      setStoreModalOpen(true);
      return;
    }
    setEditingPriceId(item.id);
    setPriceDraft(currentPrice != null ? String(currentPrice) : '');
    setPriceEditError('');
    priceOriginalRef.current = currentPrice ?? null;
  }

  function cancelEditPrice() {
    setEditingPriceId(null);
    setPriceDraft('');
    setPriceEditError('');
  }

  // Validates, then saves. An empty field clears the manual price (price: null)
  // — the way back out of a manual entry. At most 2 decimals, non-negative,
  // capped at 999 (matches the server's own sanity cap on a real price).
  async function commitPriceEdit(item) {
    if (priceSavingRef.current) return;
    const raw = priceDraft.trim();
    if (raw === '') {
      // Nothing to clear — the field was already empty (e.g. tapped —, then
      // clicked away without typing). Just close, no network round-trip.
      if (priceOriginalRef.current == null) { cancelEditPrice(); return; }
      await savePrice(item, null);
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      setPriceEditError('Enter a price like 4.99.');
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 999) {
      setPriceEditError('Price must be between $0 and $999.');
      return;
    }
    const rounded = Math.round(n * 100) / 100;
    // Unchanged from what was already there — nothing to save.
    if (priceOriginalRef.current === rounded) { cancelEditPrice(); return; }
    await savePrice(item, rounded);
  }

  async function savePrice(item, price) {
    priceSavingRef.current = true;
    setPriceSaving(true);
    setPriceEditError('');
    try {
      const data = await api.shopping.setPrice(item.id, price);
      setPriceItems(data.items);
      invalidateReminderCopy();
      // Only close out THIS row's editor — a slow save must not clobber a
      // different row the user has since opened.
      setEditingPriceId((cur) => (cur === item.id ? null : cur));
    } catch (e) {
      if (e.code === 'NO_STORE') {
        setStoreModalOpen(true);
        setPriceEditError('Set a store to price this item.');
      } else {
        setPriceEditError(e.message || 'Could not save that price.');
      }
    } finally {
      priceSavingRef.current = false;
      setPriceSaving(false);
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

  // ── Price display: a price is a property of an item, not a snapshot ────────
  // priceById maps rows to their cached price BY ID (never by name — hazard
  // (a), duplicate names). A row with no entry is simply unpriced; adding,
  // renaming, or requantifying an item needs no bookkeeping here — it just
  // won't be in the map until the next hydrate/estimate finds it. There is no
  // staleness flag: nothing dims because the list changed (docs/decisions.md
  // "Prices persist per item, not per estimate").
  const checkedCount = items.filter((i) => i.checked).length;
  const priceById = new Map(priceItems.map((it) => [it.id, it]));
  const pricedCount = items.filter((it) => priceById.get(it.id)?.price != null).length;
  const unpricedCount = items.length - pricedCount;
  const hasPrices = pricedCount > 0;

  // Provenance mix, for the total block's disclaimer — it has to stay truthful
  // no matter which of the three sources are on screen (docs/decisions.md
  // "2026-09-03 — Manual prices" and "— Receipts build the price database").
  // `source` comes back on every priced item from GET /prices and POST
  // /estimate: 'ai' | 'manual' | 'receipt' | null (unpriced). An unrecognized
  // source (older cache row, future addition) falls through to the AI bucket
  // rather than crashing or silently vanishing from the count.
  const manualPricedCount = items.filter((it) => {
    const pe = priceById.get(it.id);
    return pe && pe.price != null && pe.source === 'manual';
  }).length;
  const receiptPricedCount = items.filter((it) => {
    const pe = priceById.get(it.id);
    return pe && pe.price != null && pe.source === 'receipt';
  }).length;
  const aiPricedCount = pricedCount - manualPricedCount - receiptPricedCount;
  const realPricedCount = manualPricedCount + receiptPricedCount; // real money, either way

  let priceDisclaimer;
  if (aiPricedCount === 0 && pricedCount > 0) {
    // Nothing on screen is a guess — every price is either typed in or paid.
    if (receiptPricedCount === 0) {
      priceDisclaimer = pricedCount === 1
        ? 'You set this price — not an AI estimate.'
        : 'You set these prices — not AI estimates.';
    } else if (manualPricedCount === 0) {
      priceDisclaimer = receiptPricedCount === 1
        ? 'From your receipts — a real price, not an AI estimate.'
        : 'From your receipts — real prices, not AI estimates.';
    } else {
      priceDisclaimer = 'Real prices — some you set, some from your receipts.';
    }
  } else if (realPricedCount === 0) {
    priceDisclaimer = 'AI estimate — not a real price.';
  } else {
    // Mixed: at least one AI guess and at least one real price.
    const realDesc = manualPricedCount > 0 && receiptPricedCount > 0
      ? `${manualPricedCount} you set and ${receiptPricedCount} from your receipts`
      : manualPricedCount > 0
        ? `${manualPricedCount} price${manualPricedCount === 1 ? '' : 's'} you set yourself`
        : `${receiptPricedCount} price${receiptPricedCount === 1 ? '' : 's'} from your receipts`;
    priceDisclaimer = `AI estimate — not a real price, except ${realDesc}.`;
  }

  // The total is ALWAYS a live computation over cached item prices + current
  // checked state — never bound to a response's `total`/`total_unchecked`.
  let estimateTotal = 0;
  for (const it of items) {
    const pe = priceById.get(it.id);
    if (!pe || pe.price == null) continue;
    if (skipChecked && it.checked) continue;
    estimateTotal += pe.price;
  }
  estimateTotal = Math.round(estimateTotal * 100) / 100;

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
        <CopyFallbackModal
          text={copyFallback}
          onClose={() => {
            setCopyFallback(null);
            // Non-secure context: the button only advances to Send once the
            // user has actually had the text in hand via this panel, not the
            // moment they tapped Copy to open it.
            setReminderStage('send');
          }}
        />
      )}

      {storeModalOpen && (
        <StorePickerModal
          storeInfo={storeInfo}
          onSave={handleSaveStore}
          onClose={() => setStoreModalOpen(false)}
        />
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
            {/* Send to Reminders and Copy for Reminders share one button, one
                state at a time — Copy first (the Shortcut reads the
                clipboard), then Send, then back to Copy. Copy is purely
                local — deliberately not gated on isOffline; Send wasn't
                either before this change, so that stays as-is too. */}
            <button
              className="btn btn-ghost shop-action-btn"
              onClick={reminderStage === 'send' ? handleSendClick : handleCopyForReminders}
              disabled={uncheckedCount === 0}
              title={
                reminderStage === 'send'
                  ? `Send the list to the "${SHORTCUT_NAME}" shortcut, which adds one reminder per item`
                  : 'Copy unchecked items, one per line, to paste into Reminders'
              }
            >
              {reminderStage === 'send' ? 'Send to Reminders' : (copyMsg || `Copy ${uncheckedCount} for Reminders`)}
            </button>
            <button
              className="btn btn-ghost shop-action-btn"
              onClick={handleEstimateClick}
              disabled={isOffline || estimating}
              title={
                storeInfo.store
                  ? 'Fill in missing prices and refresh anything older than 30 days — AI estimate, not a real price'
                  : 'Estimate the cost of this list with AI — not a real price'
              }
            >
              {estimating ? 'Updating…' : (storeInfo.store ? 'Update prices' : 'Estimate cost')}
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

        {estimating && (
          <p className="shop-pantry-msg" role="status">
            Updating prices at {storeInfo.store}…
          </p>
        )}

        {estimateError && (
          <div className="error-banner" role="alert">
            {estimateError}
            <button
              className="btn btn-ghost"
              onClick={handleEstimateClick}
              style={{ marginLeft: 10, height: 28, fontSize: 12 }}
            >
              Retry
            </button>
          </div>
        )}

        {hasPrices && (
          <div className="shop-estimate">
            <p className="shop-estimate-total">
              Estimated total ≈ ${estimateTotal.toFixed(2)}
              {checkedCount > 0 && (
                skipChecked
                  ? ` · excluding ${checkedCount} checked`
                  : ` · including ${checkedCount} checked`
              )}
              {storeInfo.store ? ` · ${storeInfo.store}` : ''}
              {storeInfo.zip ? ` · ${storeInfo.zip}` : ''}
              {' · '}{pricedCount} of {items.length} items priced
            </p>
            {unpricedCount > 0 && (
              <p className="shop-estimate-unpriced">
                {unpricedCount} item{unpricedCount === 1 ? '' : 's'} couldn&rsquo;t be priced
              </p>
            )}
            <p className="shop-estimate-disclaimer">{priceDisclaimer}</p>
            {checkedCount > 0 && (
              <div className="shop-estimate-toggle-row">
                <input
                  id="shop-estimate-skip"
                  type="checkbox"
                  className="shop-estimate-toggle"
                  checked={skipChecked}
                  onChange={(e) => setSkipChecked(e.target.checked)}
                />
                <label htmlFor="shop-estimate-skip">
                  Skip {checkedCount} checked {checkedCount === 1 ? 'item' : 'items'}
                </label>
              </div>
            )}
          </div>
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
                  {group.items.map((item) => {
                    const pe = priceById.get(item.id);
                    const hasPrice = Boolean(pe) && pe.price != null;
                    const isManual = pe?.source === 'manual';
                    const isReceipt = pe?.source === 'receipt';
                    const isEditingPrice = editingPriceId === item.id;
                    const displayName = titleCase(item.name);
                    // Priced rows: surface the qty the estimate actually assumed
                    // (spec §7 — matters most when the item's own qty was blank
                    // or ambiguous), a plain note when the price is the user's
                    // own, or where a receipt price came from (with the date, when
                    // readable — docs/api.md: `updated_at` is the observation's
                    // `purchased_at` for a receipt-sourced item). Unpriced rows
                    // keep the existing message, plus an invitation to price it
                    // by hand. An unrecognized `source` (e.g. the backend hasn't
                    // shipped `receipt` yet) falls through to the qty_priced/plain
                    // case rather than showing nothing.
                    const receiptDate = isReceipt ? formatReceiptDate(pe.updated_at) : null;
                    const priceTitle = hasPrice
                      ? (isManual
                          ? 'You set this price manually'
                          : isReceipt
                            ? (receiptDate ? `From your receipt, ${receiptDate}` : 'From your receipt')
                            : (pe.qty_priced ? `Priced as ${pe.qty_priced}` : undefined))
                      : 'No estimate available — tap to set a price';
                    return (
                    <Fragment key={item.id}>
                    <div className="shop-item" role="listitem">
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
                        {displayName}
                      </span>
                      {item.qty && (
                        <span className="shop-item-qty">{item.qty}</span>
                      )}
                      {isEditingPrice ? (
                        <span className="shop-item-price-edit">
                          <input
                            type="text"
                            inputMode="decimal"
                            className="shop-item-price-input"
                            value={priceDraft}
                            onChange={(e) => setPriceDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitPriceEdit(item);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                escapedRef.current = true;
                                cancelEditPrice();
                              }
                            }}
                            onBlur={() => {
                              if (escapedRef.current) { escapedRef.current = false; return; }
                              commitPriceEdit(item);
                            }}
                            disabled={priceSaving}
                            autoFocus
                            aria-label={`Price for ${displayName}${hasPrice ? `, currently $${pe.price.toFixed(2)}` : ''}`}
                            placeholder="0.00"
                          />
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`shop-item-price ${item.checked ? 'checked' : ''} ${isManual ? 'manual' : ''} ${isReceipt ? 'receipt' : ''}`}
                          onClick={() => startEditPrice(item, hasPrice ? pe.price : null)}
                          title={priceTitle}
                          aria-label={
                            hasPrice
                              ? `Edit price for ${displayName}, currently $${pe.price.toFixed(2)}${isManual ? ', set by you' : isReceipt ? ', from your receipt' + (receiptDate ? `, ${receiptDate}` : '') : ''}`
                              : `Set price for ${displayName}`
                          }
                          disabled={isOffline}
                        >
                          {isManual && hasPrice && <span className="shop-item-price-dot" aria-hidden="true">•</span>}
                          {isReceipt && hasPrice && <span className="shop-item-price-dot shop-item-price-dot-receipt" aria-hidden="true">✓</span>}
                          {hasPrice ? `$${pe.price.toFixed(2)}` : '—'}
                        </button>
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
                    {isEditingPrice && priceEditError && (
                      <p className="shop-item-price-error" role="alert">{priceEditError}</p>
                    )}
                    </Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
