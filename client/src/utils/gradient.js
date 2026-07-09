/**
 * Deterministic gradient placeholder for recipes without an image.
 * Derives a hue from the title string so the same recipe always gets the same color.
 */

const PALETTE = [
  ['#c56a4a', '#e8a882'],  // terracotta
  ['#6a8c5f', '#a8c49d'],  // sage
  ['#7a6a9e', '#b3a9d4'],  // lavender
  ['#8c6a3a', '#c4a07a'],  // warm brown
  ['#4a7a8c', '#7ab0c4'],  // teal
  ['#8c4a6a', '#c47aa0'],  // rose
  ['#5f6a8c', '#9da8c4'],  // slate
  ['#8c7a4a', '#c4b07a'],  // gold
];

function hashString(str) {
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Returns a CSS `background` value (gradient) for a recipe title.
 */
export function recipePlaceholderGradient(title) {
  const idx = hashString(title || '') % PALETTE.length;
  const [a, b] = PALETTE[idx];
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}
