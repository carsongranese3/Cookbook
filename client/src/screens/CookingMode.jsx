import { useState } from 'react';

export default function CookingMode({ recipe, onExit }) {
  const steps = recipe?.steps || [];
  const [stepIndex, setStepIndex] = useState(0);

  // Edge case: 0 steps
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
      onExit();
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  function goBack() {
    if (!isFirst) setStepIndex((i) => i - 1);
  }

  return (
    <div className="cooking-overlay" role="dialog" aria-modal="true" aria-label="Cooking Mode">
      {/* Header */}
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

      {/* Progress bar */}
      <div className="cook-progress-bar" role="progressbar" aria-valuenow={n} aria-valuemin={1} aria-valuemax={total}>
        <div className="cook-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Body */}
      <div className="cook-body">
        <div className="cook-step-label">Step {n} of {total}</div>
        <div className="cook-step-text">{steps[stepIndex]}</div>
      </div>

      {/* Footer */}
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
    </div>
  );
}
