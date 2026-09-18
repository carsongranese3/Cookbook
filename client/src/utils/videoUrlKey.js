/**
 * Client-side duplicate-import detection for pasted Instagram/TikTok links.
 *
 * The whole point is to catch an already-imported video **before** any
 * network call is made (no yt-dlp download, no Gemini quota spent), so this
 * only ever looks at the URL string itself against the `source_url`s the
 * client already has in memory from `GET /api/recipes`.
 *
 * `videoUrlKey(url)` normalizes a URL into a comparison key so the same
 * video pasted twice — with different share/tracking query params, with or
 * without `www.`, with or without a trailing slash — produces the same key.
 * Returns `null` for anything that isn't a recognized IG/TikTok shape.
 *
 * IMPORTANT: `null` means "no key available", not "matches everything" —
 * callers must never treat two `null` keys as equal.
 *
 * KNOWN GAP (documented deliberately, not an oversight): TikTok short share
 * links — `vm.tiktok.com/<token>`, `vt.tiktok.com/<token>`, and
 * `www.tiktok.com/t/<token>` — redirect server-side to the canonical
 * `/@user/video/<id>` URL. Resolving that redirect would require a network
 * request, which defeats the purpose of a client-only check, so it is not
 * done here. A short link and the canonical URL for the SAME video will
 * therefore produce DIFFERENT keys (`ttshort:<token>` vs `tt:<id>`) and will
 * NOT be detected as duplicates of each other. This is real, not
 * theoretical: several already-imported recipes are stored as `/t/` links.
 */

/**
 * @param {string} rawUrl
 * @returns {string|null} a stable key like `ig:<shortcode>`, `tt:<id>`,
 *   `ttshort:<token>`, or `null` if unrecognized.
 */
export function videoUrlKey(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let u;
  try {
    // Tolerate bare host/paths pasted without a scheme (e.g.
    // "instagram.com/reel/..."); URL() requires one.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    u = new URL(withScheme);
  } catch {
    return null;
  }

  // Host comparison is case/`www.`-insensitive; the path (and therefore any
  // shortcode/id it contains) is left exactly as-is — IG shortcodes are
  // case-sensitive. Query string and hash are ignored automatically since
  // we only ever read `u.pathname`.
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '/';

  if (host === 'instagram.com') {
    const m = path.match(/^\/(?:reel|reels|p|tv)\/([^/]+)/);
    return m ? `ig:${m[1]}` : null;
  }

  if (host === 'tiktok.com') {
    // Canonical: https://www.tiktok.com/@user/video/<id>
    let m = path.match(/^\/@[^/]+\/video\/(\d+)/);
    if (m) return `tt:${m[1]}`;
    // Short share link: https://www.tiktok.com/t/<token>
    m = path.match(/^\/t\/([^/]+)/);
    if (m) return `ttshort:${m[1].toLowerCase()}`;
    return null;
  }

  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    const m = path.match(/^\/([^/]+)/);
    return m ? `ttshort:${m[1].toLowerCase()}` : null;
  }

  return null;
}

/**
 * Given the recipe list already held in memory (each with a `source_url`,
 * per docs/api.md §2) and a freshly-pasted URL, return the first recipe
 * whose `source_url` normalizes to the same key — or `null` if there's no
 * match (including when either side fails to normalize at all).
 *
 * @param {Array<{source_url?: string|null}>} recipes
 * @param {string} url
 * @returns {object|null}
 */
export function findDuplicateRecipe(recipes, url) {
  const key = videoUrlKey(url);
  if (!key) return null; // never treat "unrecognized" as a match
  if (!Array.isArray(recipes)) return null;
  return recipes.find((r) => r?.source_url && videoUrlKey(r.source_url) === key) || null;
}
