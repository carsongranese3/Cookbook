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
  UNSUPPORTED_URL: 'UNSUPPORTED_URL',
  FETCH_FAILED:    'FETCH_FAILED',
  NO_RECIPE:       'NO_RECIPE',
  PARSE_FAILED:    'PARSE_FAILED',
  TIMEOUT:         'TIMEOUT',
  CONFIG:          'CONFIG',
  RATE_LIMITED:    'RATE_LIMITED',
});

const DEFAULT_MESSAGES = {
  [CODES.UNSUPPORTED_URL]: 'Only Instagram and TikTok links are supported. Upload the file instead.',
  [CODES.FETCH_FAILED]:    'Could not read that video. Check the link, or upload the file instead.',
  [CODES.NO_RECIPE]:       "Couldn't find a recipe in that video.",
  [CODES.PARSE_FAILED]:    'The AI returned an unreadable response. Try again or upload the file instead.',
  [CODES.TIMEOUT]:         'The request timed out. Try again or upload the file instead.',
  [CODES.CONFIG]:          'Server configuration error. Contact the administrator.',
  [CODES.RATE_LIMITED]:    'The AI is over its free-tier limit or busy right now. Wait a bit and try again, or enable billing on your Gemini key.',
};

export class ExtractError extends Error {
  /**
   * @param {keyof typeof CODES} code
   * @param {string} [detail]   Internal detail logged server-side only.
   * @param {string} [userMessage] Override the default friendly message.
   */
  constructor(code, detail, userMessage) {
    super(detail ?? code);
    this.name = 'ExtractError';
    this.code = code;
    this.userMessage = userMessage ?? DEFAULT_MESSAGES[code] ?? 'An unexpected error occurred.';
  }
}
