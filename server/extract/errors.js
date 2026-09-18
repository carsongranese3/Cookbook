/**
 * server/extract/errors.js
 *
 * Typed error factory for the extraction layer.
 * All public functions in this layer throw an ExtractError on failure.
 *
 * err.code       — machine-readable discriminant consumed by the route handler
 * err.userMessage — safe, friendly string safe to forward to the UI banner
 */

export const CODES = /** @type {const} */ ({
  UNSUPPORTED_URL:     'UNSUPPORTED_URL',
  FETCH_FAILED:        'FETCH_FAILED',
  NO_RECIPE:           'NO_RECIPE',
  PARSE_FAILED:        'PARSE_FAILED',
  TIMEOUT:             'TIMEOUT',
  CONFIG:              'CONFIG',
  RATE_LIMITED:        'RATE_LIMITED',
  // Specific yt-dlp/source failure classifications (see ytdlp.js's
  // classifyYtdlpStderr). These replace the old catch-all of collapsing
  // every non-zero yt-dlp exit into FETCH_FAILED — see docs/decisions.md
  // "2026-09-18 — Import failures collapse into one unactionable error".
  COOKIES_EXPIRED:     'COOKIES_EXPIRED',
  SOURCE_RATE_LIMITED: 'SOURCE_RATE_LIMITED',
  PRIVATE_POST:        'PRIVATE_POST',
  POST_UNAVAILABLE:    'POST_UNAVAILABLE',
  NO_VIDEO_IN_POST:    'NO_VIDEO_IN_POST',
  GEO_OR_IP_BLOCKED:   'GEO_OR_IP_BLOCKED',
  SOURCE_UNAVAILABLE:  'SOURCE_UNAVAILABLE',
  DOWNLOADER_MISSING:  'DOWNLOADER_MISSING',
});

const DEFAULT_MESSAGES = {
  [CODES.UNSUPPORTED_URL]: 'Only Instagram and TikTok links are supported. Upload the file instead.',
  [CODES.FETCH_FAILED]:    'Could not read that video. Check the link, or upload the file instead.',
  [CODES.NO_RECIPE]:       "Couldn't find a recipe in that video.",
  [CODES.PARSE_FAILED]:    'The AI returned an unreadable response. Try again or upload the file instead.',
  [CODES.TIMEOUT]:         'The request timed out. Try again or upload the file instead.',
  [CODES.CONFIG]:          'Server configuration error. Contact the administrator.',
  [CODES.RATE_LIMITED]:    'The AI is over its free-tier limit or busy right now. Wait a bit and try again, or enable billing on your Gemini key.',
  // Note: SOURCE_RATE_LIMITED (below) is Instagram/TikTok rate-limiting the
  // download, not this Gemini quota — the two must never be conflated.
  [CODES.COOKIES_EXPIRED]:     "Instagram's saved login has expired or is missing the session cookie. Re-export cookies from a logged-in browser — make sure the HttpOnly `sessionid` cookie is included — and update the file the server reads from YTDLP_COOKIES.",
  [CODES.SOURCE_RATE_LIMITED]: 'Instagram or TikTok is rate-limiting this server right now. Wait a while before trying another import.',
  [CODES.PRIVATE_POST]:        "That post is private or restricted — you'd need to follow the account to view it. Try a different link, or upload the file instead.",
  [CODES.POST_UNAVAILABLE]:    'That post is no longer available (deleted, removed, or empty). Check the link.',
  [CODES.NO_VIDEO_IN_POST]:    "Could not find a video in that post — it may be a photo/carousel post, or Instagram may be withholding the video. Try a different link, or upload the file instead.",
  [CODES.GEO_OR_IP_BLOCKED]:   "This server's IP address is blocked from accessing that post right now. Try again later, or upload the file instead.",
  [CODES.SOURCE_UNAVAILABLE]:  'Instagram/TikTok had a temporary hiccup serving that video. This is usually transient — try again in a bit.',
  [CODES.DOWNLOADER_MISSING]:  'Could not start the video downloader. Make sure yt-dlp is installed on the server.',
};

export class ExtractError extends Error {
  /**
   * @param {keyof typeof CODES} code
   * @param {string} [detail]   Internal detail logged server-side only.
   * @param {string} [userMessage] Override the default friendly message.
   * @param {string} [fullDetail]  Untruncated internal detail (e.g. raw stderr),
   *   for callers that need to pattern-match on text a truncated `detail` may
   *   have cut off. Not logged/displayed by default; attached non-enumerable
   *   so it doesn't leak into JSON.stringify(err) or accidental logging.
   */
  constructor(code, detail, userMessage, fullDetail) {
    super(detail ?? code);
    this.name = 'ExtractError';
    this.code = code;
    this.userMessage = userMessage ?? DEFAULT_MESSAGES[code] ?? 'An unexpected error occurred.';
    Object.defineProperty(this, 'fullDetail', {
      value: fullDetail ?? detail ?? '',
      enumerable: false,
      writable: false,
    });
  }
}
