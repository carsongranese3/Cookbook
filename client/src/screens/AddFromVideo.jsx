import { useState, useRef } from 'react';
import { api } from '../api.js';
import RecipeImage from '../components/RecipeImage.jsx';

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

  async function saveDraft() {
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

function DraftCard({ draft, onUpdateField, onUpdateIng, onUpdateStep, onSave, onDiscard }) {
  return (
    <div className="draft-card">
      <div className="draft-hero">
        <RecipeImage
          image={draft.image}
          title={draft.title}
          style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
        />
        <div className="draft-badge">AI draft</div>
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
          <button className="btn btn-primary" onClick={onSave}>Save to library</button>
          <button className="btn btn-secondary" onClick={onDiscard}>Discard</button>
        </div>
      </div>
    </div>
  );
}
