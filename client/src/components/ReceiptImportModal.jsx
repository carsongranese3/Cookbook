/**
 * ReceiptImportModal — photograph a grocery receipt, review what the AI read,
 * and bulk-add the keepers to the Pantry.
 *
 * Three states:
 *   pick   — choose a photo (camera on phones, file picker on desktop)
 *   review — the editable draft list; nothing is saved until "Add to pantry"
 *   done   — a short summary of what landed and what was already there
 *
 * The review step is deliberate: receipts abbreviate names heavily and the AI
 * has to guess, so every row is editable and de-selectable before it is saved.
 *
 * Props:
 *   categories — ordered category list (PANTRY_CATEGORIES)
 *   onImported — async (items) => { added, skipped }; called on confirm
 *   onClose    — close the modal
 */
import { useState } from 'react';
import { api } from '../api.js';

export default function ReceiptImportModal({ categories, onImported, onClose }) {
  const [state, setState]     = useState('pick'); // pick | scanning | review | saving | done
  const [error, setError]     = useState('');
  const [store, setStore]     = useState('');
  const [rows, setRows]       = useState([]);     // { name, category, keep }
  const [result, setResult]   = useState(null);   // { added, skipped }

  const busy = state === 'scanning' || state === 'saving';

  async function handleFile(e) {
    // Hold the element: there are several file inputs (camera / library /
    // desktop) and we reset whichever one actually fired.
    const input = e.target;
    const file  = input.files?.[0];
    if (!file) return;

    setState('scanning');
    setError('');
    try {
      const draft = await api.pantry.scanReceipt(file);
      setStore(draft.store || '');
      setRows((draft.items || []).map((it) => ({ name: it.name, category: it.category, keep: true })));
      setState('review');
    } catch (err) {
      // NO_RECIPE / FETCH_FAILED already carry a receipt-specific message from
      // the server; only the config case needs rewording for this screen.
      const msg = (err.code === 'CONFIG' || err.code === 'EXTRACT_UNAVAILABLE')
        ? 'AI scanning is not configured on the server.'
        : err.message || 'Could not read that receipt.';
      setError(msg);
      setState('pick');
    } finally {
      // Reset so re-picking/re-shooting the same file still fires onChange.
      input.value = '';
    }
  }

  function updateRow(index, patch) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function setAllKept(keep) {
    setRows((prev) => prev.map((r) => ({ ...r, keep })));
  }

  const kept = rows.filter((r) => r.keep && r.name.trim());

  async function handleConfirm() {
    if (kept.length === 0) return;
    setState('saving');
    setError('');
    try {
      const res = await onImported(
        kept.map(({ name, category }) => ({ name: name.trim(), category }))
      );
      setResult({ added: res?.added?.length ?? 0, skipped: res?.skipped ?? [] });
      setState('done');
    } catch (err) {
      setError(err.message || 'Could not add those items.');
      setState('review');
    }
  }

  return (
    <div
      className="modal-scrim"
      onClick={busy ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Import groceries from a receipt"
    >
      <div className="modal-box receipt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header mf-header">
          <span>
            {state === 'done' ? 'Added to pantry' : 'Scan a receipt'}
            {store && state === 'review' && <span className="receipt-store"> · {store}</span>}
          </span>
          <button className="mf-close-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13"/>
            </svg>
          </button>
        </div>

        <div className="modal-body receipt-body">
          {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

          {/* ── Pick a photo ─────────────────────────────────────────────── */}
          {state === 'pick' && (
            <div className="receipt-pick">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.6" aria-hidden="true">
                <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"/>
                <path d="M9 7h6M9 11h6M9 15h3"/>
              </svg>
              <p className="receipt-pick-title">Take a photo of your receipt</p>
              <p className="receipt-pick-hint">
                The AI reads the grocery lines, expands the abbreviations, and you
                review everything before it&rsquo;s added.
              </p>
              {/* Phone: shoot it now, or pick a shot already in the camera roll.
                  `capture` sends iOS/Android straight to the rear camera; the
                  second input deliberately omits it, because with `capture` set
                  iOS skips the library chooser entirely. */}
              <div className="receipt-pick-actions phone-flex">
                <label className="btn btn-primary receipt-pick-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                  Take photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFile}
                  />
                </label>
                <label className="btn btn-secondary receipt-pick-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <path d="M21 15l-5-5L5 21"/>
                  </svg>
                  Choose from library
                  <input type="file" accept="image/*" onChange={handleFile} />
                </label>
              </div>

              {/* Desktop: no camera worth offering — just the file picker. */}
              <div className="receipt-pick-actions desktop-flex">
                <label className="btn btn-primary receipt-pick-btn">
                  Choose photo
                  <input type="file" accept="image/*" onChange={handleFile} />
                </label>
              </div>

              <p className="receipt-pick-hint" style={{ fontSize: 11 }}>JPEG, PNG or HEIC · max 12 MB</p>
            </div>
          )}

          {/* ── Scanning ─────────────────────────────────────────────────── */}
          {state === 'scanning' && (
            <div className="state-center" aria-live="polite" aria-busy="true">
              <div className="spinner" role="status" aria-label="Reading receipt"/>
              <span>Reading your receipt…</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>This takes a few seconds.</span>
            </div>
          )}

          {/* ── Review ───────────────────────────────────────────────────── */}
          {(state === 'review' || state === 'saving') && (
            <>
              <div className="receipt-toolbar">
                <span className="receipt-count">
                  {kept.length} of {rows.length} selected
                </span>
                <div className="receipt-toolbar-actions">
                  <button className="receipt-link-btn" onClick={() => setAllKept(true)} disabled={busy}>All</button>
                  <button className="receipt-link-btn" onClick={() => setAllKept(false)} disabled={busy}>None</button>
                </div>
              </div>

              <div className="receipt-rows">
                {rows.map((row, i) => (
                  <div key={i} className={`receipt-row ${row.keep ? '' : 'receipt-row--off'}`}>
                    <input
                      type="checkbox"
                      className="receipt-check"
                      checked={row.keep}
                      onChange={(e) => updateRow(i, { keep: e.target.checked })}
                      aria-label={`Include ${row.name}`}
                      disabled={busy}
                    />
                    <div className="receipt-row-fields">
                      <input
                        className="form-input receipt-name"
                        value={row.name}
                        onChange={(e) => updateRow(i, { name: e.target.value })}
                        aria-label={`Name of item ${i + 1}`}
                        disabled={busy}
                      />
                      <select
                        className="form-input form-select receipt-cat"
                        value={row.category}
                        onChange={(e) => updateRow(i, { category: e.target.value })}
                        aria-label={`Category of ${row.name}`}
                        disabled={busy}
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Done ─────────────────────────────────────────────────────── */}
          {state === 'done' && result && (
            <div className="state-center">
              <p style={{ margin: 0, fontSize: 15 }}>
                Added <strong>{result.added}</strong> {result.added === 1 ? 'item' : 'items'} to your pantry.
              </p>
              {result.skipped.length > 0 && (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
                  {result.skipped.length} already there: {result.skipped.join(', ')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Footer actions ─────────────────────────────────────────────── */}
        {(state === 'review' || state === 'saving') && (
          <div className="receipt-footer">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={busy || kept.length === 0}
            >
              {state === 'saving'
                ? 'Adding…'
                : `Add ${kept.length} ${kept.length === 1 ? 'item' : 'items'}`}
            </button>
          </div>
        )}

        {state === 'done' && (
          <div className="receipt-footer">
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
