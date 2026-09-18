import RecipeImage from './RecipeImage.jsx';

/**
 * DuplicateVideoModal — shown by AddFromVideo when the pasted URL matches
 * (by normalized key, see utils/videoUrlKey.js) a recipe already in the
 * library, BEFORE any extraction request is sent.
 *
 * Props:
 *   recipe    — the existing recipe that matched ({ id, title, image, ... })
 *   onCancel  — user backed out; leave the form untouched
 *   onContinue — user wants to import anyway
 *   onOpenExisting — optional; navigate to the existing recipe's detail view
 */
export default function DuplicateVideoModal({ recipe, onCancel, onContinue, onOpenExisting }) {
  return (
    <div
      className="modal-scrim"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Video already imported"
    >
      <div className="modal-box dup-video-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mf-header">
          <span>Already imported</span>
          <button className="mf-close-btn" onClick={onCancel} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13"/>
            </svg>
          </button>
        </div>

        <div className="modal-body dup-video-body">
          <p className="dup-video-text">
            You&rsquo;ve already imported this video. Import again?
          </p>

          {recipe && (
            <div className="picker-recipe-row dup-video-recipe" aria-label={`Existing recipe: ${recipe.title}`}>
              <RecipeImage
                image={recipe.image}
                title={recipe.title}
                style={{ width: 44, height: 44, borderRadius: 8, flex: 'none' }}
              />
              <div>
                <div className="picker-recipe-title">{recipe.title || 'Untitled recipe'}</div>
                {onOpenExisting && (
                  <button
                    type="button"
                    className="receipt-link-btn dup-video-open-link"
                    onClick={() => onOpenExisting(recipe.id)}
                  >
                    View recipe
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="receipt-footer">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onContinue}>Import again</button>
        </div>
      </div>
    </div>
  );
}
