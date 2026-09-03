/**
 * StoreSettingsForm — the grocery store + ZIP fields, shared by the Shopping
 * List's own "Set store" modal and the global Settings modal, so there is
 * exactly ONE implementation of the chain <select>, the "Other…" free-text
 * path, ZIP validation, and the save call — not two copies drifting apart
 * (the way `PANTRY_CATEGORIES` already does between `PantryScreen.jsx` and
 * `server/index.js`).
 *
 * The chain list (`storeInfo.stores`) always comes from the server — never
 * hardcode it here (spec §3.4 / AC-1.3).
 *
 * This component owns the save request itself (`PUT /api/shopping-list/store`)
 * so both callers share one error/loading story, not just markup.
 *
 * Props:
 *   storeInfo — { store, zip, stores } | undefined. If omitted, the form
 *               loads it itself (`GET /api/shopping-list/store`) and shows
 *               its own loading/error state — used by the Settings modal,
 *               which mounts fresh. The Shopping List already has this in
 *               memory and passes it straight in (no extra fetch/flicker).
 *   onSaved   — (updatedStoreInfo) => void, called after a successful save.
 *   onCancel  — () => void
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';

const OTHER_STORE = '__other__';

export default function StoreSettingsForm({ storeInfo: storeInfoProp, onSaved, onCancel }) {
  const [storeInfo, setStoreInfo] = useState(storeInfoProp || null);
  const [loading, setLoading]     = useState(!storeInfoProp);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    if (storeInfoProp) return; // caller already supplied it — nothing to fetch
    setLoading(true);
    setLoadError('');
    api.shopping.getStore()
      .then((data) => setStoreInfo(data))
      .catch((e) => setLoadError(e.message || 'Could not load your store.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // Form fields, seeded once storeInfo first arrives (whether passed in or
  // fetched here) — same pattern as the category toggles in ShoppingList.
  const [selected, setSelected] = useState('');
  const [custom, setCustom]     = useState('');
  const [zip, setZip]           = useState('');
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !storeInfo) return;
    const isCustom = Boolean(storeInfo.store) && !storeInfo.stores.includes(storeInfo.store);
    setSelected(isCustom ? OTHER_STORE : (storeInfo.store || ''));
    setCustom(isCustom ? storeInfo.store : '');
    setZip(storeInfo.zip || '');
    seeded.current = true;
  }, [storeInfo]);

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const storeValue = (selected === OTHER_STORE ? custom : selected).trim();
  const zipValid = zip === '' || /^\d{5}$/.test(zip);
  const canSave = storeValue.length > 0 && storeValue.length <= 60 && zipValid;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError('');
    try {
      const data = await api.shopping.setStore(storeValue, zip);
      onSaved(data);
    } catch (err) {
      setError(err.message || 'Could not save the store.');
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="error-banner" role="alert">
        {loadError}
        <button
          className="btn btn-ghost"
          onClick={load}
          style={{ marginLeft: 10, height: 28, fontSize: 12 }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading || !storeInfo) {
    return (
      <div className="state-center" style={{ padding: '20px 0' }}>
        <div className="spinner" aria-label="Loading your store" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="form-group" style={{ marginBottom: 12 }}>
        <label htmlFor="store-select" className="form-label">Store</label>
        <select
          id="store-select"
          className="form-input form-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={saving}
        >
          <option value="" disabled>Choose a store…</option>
          {storeInfo.stores.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
          <option value={OTHER_STORE}>Other…</option>
        </select>
      </div>

      {selected === OTHER_STORE && (
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label htmlFor="store-custom" className="form-label">Store name</label>
          <input
            id="store-custom"
            className="form-input"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="e.g. Star Market"
            maxLength={60}
            autoFocus
            disabled={saving}
          />
        </div>
      )}

      <div className="form-group" style={{ marginBottom: 20 }}>
        <label htmlFor="store-zip" className="form-label">ZIP code</label>
        <input
          id="store-zip"
          className="form-input"
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          inputMode="numeric"
          maxLength={5}
          placeholder="02139"
          disabled={saving}
        />
        <p className="form-hint">Optional — prices vary by area</p>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={!canSave || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
