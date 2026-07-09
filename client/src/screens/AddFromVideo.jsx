import { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';
import RecipeImage from '../components/RecipeImage.jsx';
import { fileToDownscaledDataUrl } from '../utils/image.js';

const STATUS_MESSAGES = [
  'Transcribing narration & captions',
  'Identifying ingredients on screen',
  'Reconstructing the method',
  'Converting measurements to imperial',
  'Polishing the recipe draft…',
];

const SAMPLE_LINKS = [
  { label: 'tiktok.com/@spicychef', url: 'https://www.tiktok.com/@spicychef/video/7341234567890123456' },
  { label: 'instagram.com/reel/pasta', url: 'https://www.instagram.com/reel/C1AbCdEfGhI/' },
];

function statusCycle(setStatus) {
  let i = 0;
  setStatus(STATUS_MESSAGES[0]);
  const id = setInterval(() => {
    i = (i + 1) % STATUS_MESSAGES.length;
    setStatus(STATUS_MESSAGES[i]);
  }, 2200);
  return () => clearInterval(id);
}

export default function AddFromVideo({ onSaved, isOffline, embedded }) {
  const [url, setUrl]           = useState('');
  const [state, setState]       = useState('idle'); // idle | loading | error | draft
  const [aiStatus, setAiStatus] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [draft, setDraft]       = useState(null);
  const fileRef                 = useRef(null);
  const stopStatus              = useRef(null);

  // User-defined filter list (fetched once)
  const [userFilters, setUserFilters]     = useState([]);
  const [filtersReady, setFiltersReady]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.filters.list()
      .then((data) => { if (!cancelled) setUserFilters(data || []); })
      .catch(() => { if (!cancelled) setUserFilters([]); })
      .finally(() => { if (!cancelled) setFiltersReady(true); });
    return () => { cancelled = true; };
  }, []);

  function startLoading() {
    setState('loading');
    stopStatus.current = statusCycle(setAiStatus);
  }

  function stopLoading() {
    if (stopStatus.current) {
      stopStatus.current();
      stopStatus.current = null;
    }
  }

  function showError(msg) {
    stopLoading();
    setErrorMsg(msg);
    setState('error');
  }

  async function handleExtract() {
    if (isOffline) { showError("You're offline. Connect and try again."); return; }
    const trimmed = url.trim();
    if (!trimmed) { showError('Paste a video link first.'); return; }
    if (!/tiktok\.com|instagram\.com/i.test(trimmed)) {
      showError('Only TikTok and Instagram links are supported. Paste an IG Reel or TikTok, or upload a file instead.');
      return;
    }
    startLoading();
    try {
      const result = await api.extract.fromUrl(trimmed);
      stopLoading();
      setDraft({ ...result, _sourceUrl: trimmed });
      setState('draft');
    } catch (e) {
      const code = e.code;
      let msg = e.message;
      if (code === 'FETCH_FAILED' || e.status === 502) {
        msg = 'Could not read that video. Check the link, or upload the file instead.';
      } else if (code === 'UNSUPPORTED_URL') {
        msg = 'Only TikTok and Instagram links are supported. Try uploading a file instead.';
      } else if (code === 'NO_RECIPE') {
        msg = "Couldn't find a recipe in that video. Try a different video or upload a file.";
      } else if (code === 'TIMEOUT') {
        msg = 'The request timed out. Try again or upload a file instead.';
      } else if (code === 'RATE_LIMITED' || e.status === 429) {
        msg = e.message || 'The AI is over its free-tier limit or busy. Wait a bit and try again.';
      } else if (code === 'CONFIG' || e.status === 503) {
        msg = 'AI extraction is not configured on the server.';
      }
      showError(msg);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isOffline) { showError("You're offline. Connect and try again."); return; }
    startLoading();
    try {
      const result = await api.extract.fromFile(file);
      stopLoading();
      setDraft({ ...result, _sourceUrl: null });
      setState('draft');
    } catch (e) {
      const code = e.code;
      let msg = e.message;
      if (code === 'NO_RECIPE') {
        msg = "Couldn't find a recipe in that video. Try a different file.";
      } else if (code === 'CONFIG' || e.status === 503) {
        msg = 'AI extraction is not configured on the server.';
      }
      showError(msg);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function discard() {
    setState('idle');
    setDraft(null);
    setUrl('');
    setErrorMsg('');
  }

  async function saveDraft(checkedFilters) {
    if (!draft) return;
    if (isOffline) { showError("You're offline. Can't save right now."); return; }
    try {
      const payload = {
        title:       (draft.title || '').trim(),
        description: (draft.description || '').trim(),
        cuisine:     (draft.cuisine || '').trim(),
        category:    (draft.category || '').trim(),
        minutes:     draft.minutes ? parseInt(draft.minutes, 10) : null,
        servings:    draft.servings ? parseInt(draft.servings, 10) : null,
        image:       draft.image || null,
        ingredients: (draft.ingredients || []).filter((i) => i.name?.trim()),
        steps:       (draft.steps || []).filter((s) => s?.trim()),
        tags:        draft.tags || [],
        source_url:  draft._sourceUrl || null,
        filters:     [...checkedFilters],
      };
      const created = await api.create(payload);
      onSaved(created.id);
    } catch (e) {
      showError(e.message);
    }
  }

  function updateDraftField(field, val) {
    setDraft((d) => ({ ...d, [field]: val }));
  }

  function updateDraftIng(i, key, val) {
    setDraft((d) => {
      const ings = [...(d.ingredients || [])];
      ings[i] = { ...ings[i], [key]: val };
      return { ...d, ingredients: ings };
    });
  }

  function updateDraftStep(i, val) {
    setDraft((d) => {
      const ss = [...(d.steps || [])];
      ss[i] = val;
      return { ...d, steps: ss };
    });
  }

  return (
    <div className={embedded ? '' : 'page-pad'}>
      {!embedded && <div className="eyebrow eyebrow-accent">AI Import</div>}
      {!embedded && <h1 className="page-title">Add from a video</h1>}

      {/* Intro — desktop */}
      <p className="desktop-block" style={{ font: '400 14px/1.55 Onest,system-ui', color: 'var(--secondary)', marginTop: 10, maxWidth: 520 }}>
        Paste a link to a cooking video from TikTok or Instagram. The AI will draft a full
        recipe — title, ingredients, and steps — that you can tweak and save.
      </p>
      {/* Intro — phone */}
      <p className="phone-block" style={{ font: '400 13px/1.5 Onest,system-ui', color: 'var(--secondary)', marginTop: 8 }}>
        Paste a TikTok or Reels link — the AI drafts the recipe.
      </p>

      {/* URL input row */}
      <div className="extract-input-row">
        <div className="extract-url-box">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#c4bfb6" strokeWidth="2" aria-hidden="true">
            <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/>
            <path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>
          </svg>
          {/* Desktop placeholder */}
          <input
            className="desktop-only"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && state !== 'loading' && handleExtract()}
            placeholder="https://tiktok.com/@chef/video/…"
            aria-label="Video URL"
            disabled={state === 'loading'}
          />
          {/* Phone placeholder */}
          <input
            className="phone-only"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && state !== 'loading' && handleExtract()}
            placeholder="Paste link…"
            aria-label="Video URL"
            disabled={state === 'loading'}
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={handleExtract}
          disabled={state === 'loading'}
        >
          {state === 'loading' ? 'Working…' : 'Extract recipe'}
        </button>
      </div>

      {/* File upload */}
      <div className="extract-file-row">
        <span>or</span>
        <label className="extract-file-label">
          upload a file
          <input
            ref={fileRef}
            type="file"
            accept="video/*,.mp4,.mov,.avi,.mkv"
            onChange={handleFileUpload}
            disabled={state === 'loading'}
          />
        </label>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>(max 200 MB)</span>
      </div>

      {/* Sample chips */}
      <div className="sample-chips">
        {SAMPLE_LINKS.map((s) => (
          <button
            key={s.label}
            className="sample-chip"
            onClick={() => { setUrl(s.url); setState('idle'); setErrorMsg(''); }}
            disabled={state === 'loading'}
            aria-label={`Use sample: ${s.label}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {state === 'loading' && (
        <div className="loading-card" aria-live="polite" aria-busy="true">
          <div className="spinner" />
          <div>
            <div className="loading-text">Watching the video…</div>
            <div className="loading-status">{aiStatus}</div>
          </div>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="error-banner" role="alert">{errorMsg}</div>
      )}

      {/* Draft */}
      {state === 'draft' && draft && (
        <DraftCard
          draft={draft}
          userFilters={filtersReady ? userFilters : []}
          onUpdateField={updateDraftField}
          onUpdateIng={updateDraftIng}
          onUpdateStep={updateDraftStep}
          onSave={saveDraft}
          onDiscard={discard}
        />
      )}
    </div>
  );
}

function DraftCard({ draft, userFilters, onUpdateField, onUpdateIng, onUpdateStep, onSave, onDiscard }) {
  // Pre-check filters that the AI suggested (draft.filters is string[])
  const aiSuggested = new Set(Array.isArray(draft.filters) ? draft.filters : []);
  const [checkedFilters, setCheckedFilters] = useState(
    () => new Set([...aiSuggested])
  );

  // Cover photo: candidates from AI draft (imageCandidates) + selected index
  const candidates = Array.isArray(draft.imageCandidates) ? draft.imageCandidates : [];
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverFileRef = useRef(null);

  // Currently selected image — driven by draft.image (updated via onUpdateField)
  const selectedImage = draft.image ?? null;

  function selectCandidate(dataUri) {
    onUpdateField('image', dataUri);
  }

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const dataUrl = await fileToDownscaledDataUrl(file, 800);
      onUpdateField('image', dataUrl);
    } catch {
      // keep existing image on error
    } finally {
      setUploadingCover(false);
      if (coverFileRef.current) coverFileRef.current.value = '';
    }
  }

  function toggleFilter(label) {
    setCheckedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <div className="draft-card">
      <div className="draft-hero">
        <RecipeImage
          image={selectedImage}
          title={draft.title}
          style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
        />
        <div className="draft-badge">AI draft</div>
      </div>

      {/* Cover photo thumbnail strip — always visible; shows upload tile even when no candidates */}
      <div className="draft-thumb-strip" aria-label="Choose cover photo">
          {candidates.map((uri, i) => (
            <button
              key={i}
              type="button"
              className={`draft-thumb${uri === selectedImage ? ' selected' : ''}`}
              onClick={() => selectCandidate(uri)}
              aria-label={`Frame ${i + 1}`}
              aria-pressed={uri === selectedImage}
            >
              <img src={uri} alt={`Frame ${i + 1}`} />
            </button>
          ))}
          {/* Upload your own tile */}
          <label
            className={`draft-thumb draft-thumb-upload${uploadingCover ? ' uploading' : ''}`}
            title="Upload your own photo"
            aria-label="Upload your own cover photo"
          >
            {uploadingCover ? (
              <span className="spinner spinner-sm" role="status" aria-label="Uploading" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            )}
            <span className="draft-thumb-upload-label">Upload</span>
            <input
              ref={coverFileRef}
              type="file"
              accept="image/*"
              onChange={handleCoverUpload}
              disabled={uploadingCover}
              style={{ display: 'none' }}
            />
          </label>
      </div>
      <div className="draft-body">
        <input
          className="draft-title-input"
          value={draft.title || ''}
          onChange={(e) => onUpdateField('title', e.target.value)}
          placeholder="Recipe title"
          aria-label="Recipe title"
        />
        <textarea
          className="draft-desc-input"
          value={draft.description || ''}
          onChange={(e) => onUpdateField('description', e.target.value)}
          placeholder="Description…"
          rows={2}
          aria-label="Description"
        />
        <div className="draft-meta">
          <span>
            ⏱{' '}
            <input
              className="draft-meta-input"
              value={draft.minutes ?? ''}
              onChange={(e) => onUpdateField('minutes', e.target.value)}
              type="number"
              min="1"
              aria-label="Minutes"
              style={{ width: 40 }}
            /> min
          </span>
          <span>
            <input
              className="draft-meta-input"
              value={draft.servings ?? ''}
              onChange={(e) => onUpdateField('servings', e.target.value)}
              type="number"
              min="1"
              aria-label="Servings"
              style={{ width: 30 }}
            /> servings
          </span>
          <span>
            <input
              className="draft-meta-input"
              value={draft.cuisine || ''}
              onChange={(e) => onUpdateField('cuisine', e.target.value)}
              placeholder="Cuisine"
              aria-label="Cuisine"
              style={{ width: 80 }}
            />
          </span>
        </div>

        {/* Filters checklist */}
        {userFilters.length > 0 && (
          <div className="draft-filters-section">
            <div className="draft-filters-label">
              Filters
              {aiSuggested.size > 0 && (
                <span className="draft-filters-ai-hint"> · AI pre-selected</span>
              )}
            </div>
            <div className="rf-filter-checklist" role="group" aria-label="Filters">
              {userFilters.map((f) => {
                const checked = checkedFilters.has(f.label);
                const wasAi   = aiSuggested.has(f.label);
                return (
                  <label key={f.id} className="rf-filter-chip">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFilter(f.label)}
                      aria-label={f.label}
                    />
                    <span className={`rf-filter-chip-label${checked ? ' checked' : ''}${wasAi ? ' ai-suggested' : ''}`}>
                      {f.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="draft-columns">
          {/* Ingredients — always visible */}
          <div>
            <div className="draft-section-title">Ingredients</div>
            <div style={{ marginTop: 10 }}>
              {(draft.ingredients || []).map((ing, i) => (
                <div key={i} className="draft-ingredient-row">
                  <input
                    className="draft-ing-name"
                    value={ing.name || ''}
                    onChange={(e) => onUpdateIng(i, 'name', e.target.value)}
                    placeholder="Ingredient"
                    aria-label={`Ingredient ${i + 1} name`}
                  />
                  <input
                    className="draft-ing-qty"
                    value={ing.qty || ''}
                    onChange={(e) => onUpdateIng(i, 'qty', e.target.value)}
                    placeholder="qty"
                    aria-label={`Ingredient ${i + 1} quantity`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Method — desktop only */}
          <div className="desktop-block">
            <div className="draft-section-title">Method</div>
            <div style={{ marginTop: 10 }}>
              {(draft.steps || []).map((step, i) => (
                <div key={i} className="draft-step-row">
                  <div className="draft-step-num">{i + 1}</div>
                  <textarea
                    className="draft-step-text"
                    value={step || ''}
                    onChange={(e) => onUpdateStep(i, e.target.value)}
                    rows={2}
                    aria-label={`Step ${i + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Phone: steps below ingredients */}
        <div className="phone-block" style={{ marginTop: 16 }}>
          <div className="draft-section-title">Method</div>
          <div style={{ marginTop: 8 }}>
            {(draft.steps || []).map((step, i) => (
              <div key={i} className="draft-step-row">
                <div className="draft-step-num">{i + 1}</div>
                <textarea
                  className="draft-step-text"
                  value={step || ''}
                  onChange={(e) => onUpdateStep(i, e.target.value)}
                  rows={2}
                  aria-label={`Step ${i + 1}`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="draft-actions">
          <button className="btn btn-primary" onClick={() => onSave(checkedFilters)}>Save to library</button>
          <button className="btn btn-secondary" onClick={onDiscard}>Discard</button>
        </div>
      </div>
    </div>
  );
}
