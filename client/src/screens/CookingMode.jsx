import { useState, useRef, useEffect, useMemo } from 'react';

/**
 * CookingMode — full-screen step-by-step cooking guide.
 *
 * Props:
 *   recipe    — the full recipe object
 *   onExit    — called when the user closes mid-cook (X button) OR finishes on a
 *               recipe with 0 steps. Does NOT log history.
 *   onFinish  — optional; called with `recipe` when the user taps Done on the
 *               final step. App uses this to pre-fill a History entry.
 *               If omitted, falls back to onExit.
 *
 * Desktop (>767px): when the recipe has a video, renders two panes —
 * instructions left, source video right — and seeks the video to each
 * step's timestamp. Recipes with `has_video: false`, or whose video fails
 * to load, fall back to the original single-pane text layout unchanged.
 * Phone (<=767px): video stacked above the step, functional only.
 */
export default function CookingMode({ recipe, onExit, onFinish }) {
  const steps = recipe?.steps || [];
  const stepTimes = Array.isArray(recipe?.step_times) ? recipe.step_times : [];
  const [stepIndex, setStepIndex] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef(null);

  const hasVideo = !!recipe?.has_video && !videoError;
  const videoSrc = recipe?.id ? `/api/recipes/${recipe.id}/video` : null;

  // Ingredients for the reference list at the bottom of the step view.
  const ingredients = useMemo(
    () => (Array.isArray(recipe?.ingredients) ? recipe.ingredients.filter((i) => i && i.name) : []),
    [recipe?.ingredients]
  );

  function handleFinish() {
    if (onFinish) {
      onFinish(recipe);
    } else {
      onExit();
    }
  }

  // Derived seek plan, computed once per recipe (not per step-change).
  // The AI returns `0` for a step whose moment "isn't shown in the video"
  // (e.g. an optional final step), and occasionally an out-of-order value —
  // neither should be treated as a real timestamp.
  //
  // A step's timestamp is USABLE iff: it's a finite number, AND
  // (step 0 ? t >= 0 : t > 0), AND it is >= the last usable timestamp seen
  // so far (non-decreasing). `seekTargets[i]` is that usable value, or
  // `null` if step i's own timestamp is unusable (meaning: don't seek when
  // entering that step — leave the video wherever it already is).
  const seekTargets = useMemo(() => {
    const targets = [];
    let lastUsable = -Infinity;
    for (let i = 0; i < steps.length; i++) {
      const t = stepTimes[i];
      const usable =
        typeof t === 'number' &&
        Number.isFinite(t) &&
        (i === 0 ? t >= 0 : t > 0) &&
        t >= lastUsable;
      if (usable) {
        targets.push(t);
        lastUsable = t;
      } else {
        targets.push(null);
      }
    }
    return targets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length, stepTimes]);

  // `boundaries[i]` — the timestamp at which playback should auto-pause
  // while on step i: the next USABLE timestamp after i (skipping over any
  // unusable ones in between), or `null` if none remains (play to the end).
  const boundaries = useMemo(() => {
    const b = new Array(steps.length).fill(null);
    for (let i = 0; i < steps.length; i++) {
      for (let j = i + 1; j < steps.length; j++) {
        if (seekTargets[j] !== null) {
          b[i] = seekTargets[j];
          break;
        }
      }
    }
    return b;
  }, [seekTargets, steps.length]);

  // Seek + auto-pause-per-segment. Only runs when there's an actual video
  // pane and actual steps.
  useEffect(() => {
    const video = videoRef.current;
    if (!hasVideo || !video || steps.length === 0) return;

    const startT = seekTargets[stepIndex]; // number, or null = don't seek
    const endT = boundaries[stepIndex];    // number, or null = play to end
    const canSeek = startT !== null;
    const canBound = endT !== null;

    let pausedForThisStep = false;

    function seekAndPlay() {
      if (!canSeek) return; // unusable timestamp for this step — leave the video alone
      video.currentTime = startT;
      video.play().catch(() => {});
    }

    if (video.readyState >= 1 /* HAVE_METADATA */) {
      seekAndPlay();
    } else {
      video.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    }

    function handleTimeUpdate() {
      if (!canBound || pausedForThisStep) return;
      if (video.currentTime >= endT) {
        video.pause();
        pausedForThisStep = true;
      }
    }
    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      video.removeEventListener('loadedmetadata', seekAndPlay);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [stepIndex, hasVideo, steps.length, seekTargets, boundaries]);

  // Edge case: 0 steps — unchanged from before, no video pane regardless.
  if (steps.length === 0) {
    return (
      <div className="cooking-overlay" role="dialog" aria-modal="true" aria-label="Cooking Mode">
        <div className="cook-header">
          <div>
            <div className="cook-eyebrow">Cooking</div>
            <div className="cook-title">{recipe?.title}</div>
          </div>
          <button className="cook-close" onClick={onExit} aria-label="Close cooking mode">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="cook-body">
          <div className="cook-step-label">No steps yet</div>
          <div className="cook-step-text" style={{ fontSize: 20, color: 'rgba(255,255,255,.6)' }}>
            This recipe doesn't have any steps. Add them by editing the recipe.
          </div>
        </div>
        <div className="cook-footer" style={{ justifyContent: 'flex-end' }}>
          <button className="cook-next-btn" onClick={onExit}>Close</button>
        </div>
      </div>
    );
  }

  const total = steps.length;
  const n = stepIndex + 1;
  const progress = (n / total) * 100;
  const isFirst = stepIndex === 0;
  const isLast  = stepIndex === total - 1;

  function goNext() {
    if (isLast) {
      handleFinish();
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  function goBack() {
    if (!isFirst) setStepIndex((i) => i - 1);
  }

  const body = (
    <div className={`cook-body ${hasVideo ? 'cook-body--paned' : ''}`}>
      <div className="cook-step-label">Step {n} of {total}</div>
      <div className="cook-step-text">{steps[stepIndex]}</div>
    </div>
  );

  const ingredientsBar = ingredients.length > 0 && (
    <div className="cook-ingredients">
      <div className="cook-ingredients-label">Ingredients</div>
      <ul className="cook-ingredients-list">
        {ingredients.map((ing, i) => (
          <li key={i}>
            {ing.name}
            {ing.qty ? <span className="cook-ing-qty"> ({ing.qty})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );

  const footer = (
    <div className="cook-footer">
      <button
        className="cook-back-btn"
        onClick={goBack}
        disabled={isFirst}
        aria-label="Previous step"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
        Back
      </button>

      {/* Dots — desktop only (hidden on phone via CSS) */}
      <div className="cook-dots" aria-hidden="true">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`cook-dot ${i === stepIndex ? 'active' : ''}`}
          />
        ))}
      </div>

      <button
        className="cook-next-btn"
        onClick={goNext}
        aria-label={isLast ? 'Finish cooking' : 'Next step'}
      >
        {isLast ? 'Done' : 'Next'}
        {!isLast && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        )}
      </button>
    </div>
  );

  const header = (
    <div className="cook-header">
      <div>
        <div className="cook-eyebrow">Cooking</div>
        <div className="cook-title">{recipe?.title}</div>
      </div>
      <button className="cook-close" onClick={onExit} aria-label="Close cooking mode">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  );

  const progressBar = (
    <div className="cook-progress-bar" role="progressbar" aria-valuenow={n} aria-valuemin={1} aria-valuemax={total}>
      <div className="cook-progress-fill" style={{ width: `${progress}%` }} />
    </div>
  );

  const videoPane = hasVideo && (
    <div className="cook-video-pane">
      <video
        ref={videoRef}
        key={recipe.id}
        src={videoSrc}
        controls
        playsInline
        className="cook-video"
        onError={() => setVideoError(true)}
      />
    </div>
  );

  if (!hasVideo) {
    // No video (has_video: false) or the video failed to load — today's
    // single-pane text layout, unchanged.
    return (
      <div className="cooking-overlay" role="dialog" aria-modal="true" aria-label="Cooking Mode">
        {header}
        {progressBar}
        {body}
        {ingredientsBar}
        {footer}
      </div>
    );
  }

  return (
    <div className="cooking-overlay cooking-overlay--video" role="dialog" aria-modal="true" aria-label="Cooking Mode">
      {header}
      {progressBar}
      <div className="cook-main">
        <div className="cook-instructions">
          {body}
          {ingredientsBar}
          {footer}
        </div>
        {videoPane}
      </div>
    </div>
  );
}
