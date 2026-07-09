import { recipePlaceholderGradient } from '../utils/gradient.js';

/**
 * Renders a recipe image with a deterministic gradient fallback.
 * `className` is applied to the wrapping element.
 * Pass `style` for additional inline styles on the wrapper.
 */
export default function RecipeImage({ image, title, className = '', style = {} }) {
  const gradient = recipePlaceholderGradient(title);

  if (!image) {
    return (
      <div
        className={`placeholder-img ${className}`}
        style={{ background: gradient, ...style }}
        aria-hidden="true"
      />
    );
  }

  return (
    <div className={`placeholder-img ${className}`} style={{ background: gradient, ...style }}>
      <img
        src={image}
        alt={title || ''}
        className="img-with-fallback"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
    </div>
  );
}
