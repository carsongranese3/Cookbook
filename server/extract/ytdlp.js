/**
 * server/extract/ytdlp.js
 *
 * Path B helper: validate an Instagram/TikTok URL, then use yt-dlp to
 * download the video to a temp file and extract its caption/description.
 *
 * Environment variables consumed:
 *   YTDLP_COOKIES  (optional) — absolute path to a Netscape cookies file.
 *                  Required for Instagram Reels that are blocked without auth.
 *
 * Returns:
 *   { filePath: string, mimeType: string, caption: string, cleanup: () => Promise<void> }
 *
 * Throws ExtractError with codes:
 *   UNSUPPORTED_URL     — not an IG or TikTok link
 *   DOWNLOADER_MISSING  — yt-dlp binary not found / could not be spawned
 *   COOKIES_EXPIRED      — IG session cookies invalid/logged out
 *   SOURCE_RATE_LIMITED  — rate-limited by Instagram/TikTok (not Gemini)
 *   PRIVATE_POST         — private account / must follow to view
 *   POST_UNAVAILABLE     — deleted, 404, or empty media response
 *   NO_VIDEO_IN_POST     — photo/carousel post, or IG withheld the video
 *   GEO_OR_IP_BLOCKED    — this server's IP is blocked from the post
 *   SOURCE_UNAVAILABLE   — transient extractor failure, usually worth a retry
 *   TIMEOUT              — yt-dlp exceeded its time limit
 *   FETCH_FAILED         — any other non-zero exit or I/O error (fallback)
 * See classifyYtdlpStderr() below for the stderr → code mapping.
 */

import { spawn }             from 'node:child_process';
import { randomUUID }        from 'node:crypto';
import { rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir }             from 'node:os';
import { join }               from 'node:path';
import { ExtractError, CODES } from './errors.js';

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/** Patterns for accepted hosts (Instagram + TikTok only). */
const ALLOWED_HOSTS = [
  /^(?:www\.)?instagram\.com$/i,
  /^(?:www\.)?tiktok\.com$/i,
  /^(?:vm\.)?tiktok\.com$/i,
];

/**
 * Returns true if the URL is an Instagram or TikTok link we will attempt.
 * @param {string} raw
 * @returns {boolean}
 */
function isSupportedUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return ALLOWED_HOSTS.some((re) => re.test(parsed.hostname));
}

/**
 * Validate the URL; throw UNSUPPORTED_URL if it is not an IG/TikTok link.
 * @param {string} url
 */
export function validateUrl(url) {
  if (!isSupportedUrl(url)) {
    throw new ExtractError(
      CODES.UNSUPPORTED_URL,
      `Rejected URL (not IG/TikTok): ${url}`,
    );
  }
}

// ---------------------------------------------------------------------------
// yt-dlp runner
// ---------------------------------------------------------------------------

/**
 * Returns true if a yt-dlp failure looks like "impersonation is unavailable"
 * (e.g. curl_cffi was removed from the venv by a `brew upgrade`), as opposed
 * to any other failure (404, blocked, timeout, etc.) which must propagate.
 * Matches case-insensitively on "impersonat" + ("not available" | "unavailable").
 * @param {string} message
 * @returns {boolean}
 */
function isImpersonationUnavailable(message) {
  const lower = (message || '').toLowerCase();
  return lower.includes('impersonat') && (lower.includes('not available') || lower.includes('unavailable'));
}

/**
 * Ordered stderr → ExtractError-code classification for yt-dlp failures.
 * Matched case-insensitively against the FULL (untruncated) stderr — never
 * the 500-char `detail` slice, since the identifying line often sits past
 * 500 chars in a Python traceback (same trap `isImpersonationUnavailable`
 * already documents).
 *
 * Order matters: a login-required error from yt_dlp's `raise_login_required`
 * carries BOTH a specific reason (private post, restricted, etc.) AND the
 * generic "Use --cookies-from-browser or --cookies for the authentication"
 * hint appended to every one of them. The generic cookies-hint pattern is
 * therefore listed LAST so a specific reason is never misclassified as
 * expired cookies.
 *
 * See docs/decisions.md "2026-09-18 — Import failures collapse into one
 * unactionable error" for the source strings and rationale.
 *
 * @param {string} stderr  Full, untruncated yt-dlp stderr.
 * @returns {keyof typeof CODES | null}  null when nothing matches (caller
 *   should fall back to FETCH_FAILED).
 */
const YTDLP_ERROR_PATTERNS = [
  // Instagram (yt_dlp/extractor/instagram.py) — specific reasons first.
  { code: CODES.COOKIES_EXPIRED,     test: /the provided instagram account cookies are no longer valid/i },
  { code: CODES.COOKIES_EXPIRED,     test: /instagram api is not granting access/i },
  { code: CODES.SOURCE_RATE_LIMITED, test: /exceeded the rate-limit for accessing posts anonymously/i },
  { code: CODES.PRIVATE_POST,        test: /only available for registered users who follow this account/i },
  { code: CODES.PRIVATE_POST,        test: /restricted video/i },
  { code: CODES.NO_VIDEO_IN_POST,    test: /there is no video in this post/i },
  { code: CODES.NO_VIDEO_IN_POST,    test: /no video formats found/i },
  { code: CODES.POST_UNAVAILABLE,    test: /instagram sent an empty media response/i },
  // TikTok (yt_dlp/extractor/tiktok.py).
  { code: CODES.SOURCE_UNAVAILABLE,  test: /unexpected response from webpage request/i },
  { code: CODES.SOURCE_UNAVAILABLE,  test: /unable to solve js challenge/i },
  { code: CODES.GEO_OR_IP_BLOCKED,   test: /your ip address is blocked from accessing this post/i },
  { code: CODES.POST_UNAVAILABLE,    test: /video not available, status code/i },
  // Generic (yt_dlp/extractor/common.py raise_login_required / HTTP errors).
  { code: CODES.PRIVATE_POST,        test: /this video is only available for registered users/i },
  { code: CODES.SOURCE_RATE_LIMITED, test: /\b429\b|too many requests/i },
  { code: CODES.POST_UNAVAILABLE,    test: /http error 404/i },
  // Generic cookies hint — appended to EVERY login-required error, so it must
  // stay last: a specific pattern above should win first.
  { code: CODES.COOKIES_EXPIRED,     test: /use --cookies-from-browser or --cookies for the authentication/i },
];

function classifyYtdlpStderr(stderr) {
  const text = stderr || '';
  for (const { code, test } of YTDLP_ERROR_PATTERNS) {
    if (test.test(text)) return code;
  }
  return null;
}

/**
 * Build the COOKIES_EXPIRED userMessage, naming the actual configured
 * cookies path when known (falls back to just naming the env var).
 * @returns {string}
 */
function cookiesExpiredMessage() {
  const cookiesFile = process.env.YTDLP_COOKIES;
  const where = cookiesFile
    ? `the cookies file at \`${cookiesFile}\` (YTDLP_COOKIES)`
    : 'the file configured via YTDLP_COOKIES';
  return (
    "Instagram's saved login has expired or is missing the session cookie. " +
    'Re-export cookies from a logged-in browser session — make sure the ' +
    `HttpOnly \`sessionid\` cookie is included — and replace ${where}.`
  );
}

/**
 * Low-level spawn of yt-dlp with the exact args given.
 * Resolves with { stdout, stderr } or rejects on non-zero exit.
 *
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function spawnYtdlp(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(
        new ExtractError(
          CODES.DOWNLOADER_MISSING,
          `yt-dlp not found or could not be spawned: ${err.message}`,
        ),
      );
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(
        new ExtractError(
          CODES.TIMEOUT,
          'yt-dlp timed out',
        ),
      );
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        // Classify against the FULL stderr — the identifying line (for the
        // impersonation fallback, or for one of the patterns below) can sit
        // well past 500 chars in a long Python traceback.
        const matchedCode = classifyYtdlpStderr(stderr) ?? CODES.FETCH_FAILED;
        const userMessage = matchedCode === CODES.COOKIES_EXPIRED ? cookiesExpiredMessage() : undefined;
        reject(
          new ExtractError(
            matchedCode,
            `yt-dlp exited ${code}: ${stderr.slice(0, 500)}`,
            userMessage,
            `yt-dlp exited ${code}: ${stderr}`,
          ),
        );
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new ExtractError(
          CODES.DOWNLOADER_MISSING,
          `yt-dlp process error: ${err.message}`,
        ),
      );
    });
  });
}

/**
 * Run yt-dlp with browser impersonation applied uniformly to every call site.
 * Prepends `--impersonate chrome` (the generic alias, so it auto-selects the
 * best available target rather than a pinned version that can go stale).
 *
 * Graceful fallback: if curl_cffi is missing from the yt-dlp install (e.g. a
 * `brew upgrade yt-dlp` recreated the venv), yt-dlp errors with something like
 * "Impersonate target is not available". In that case only, retry the exact
 * same call once WITHOUT `--impersonate` so imports keep working. Any other
 * failure (404, blocked, timeout, etc.) propagates unchanged.
 *
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runYtdlp(args, opts = {}) {
  const impersonatedArgs = ['--impersonate', 'chrome', ...args];
  try {
    return await spawnYtdlp(impersonatedArgs, opts);
  } catch (err) {
    // Match against the untruncated stderr (`fullDetail`) — the 500-char
    // `err.message` slice can cut off before the identifying line in a long
    // Python traceback. Fall back to `err.message` for non-ExtractError or
    // errors without fullDetail (defensive; shouldn't normally happen here).
    const haystack = err instanceof ExtractError ? (err.fullDetail || err.message) : '';
    if (err instanceof ExtractError && isImpersonationUnavailable(haystack)) {
      console.warn('[ytdlp] --impersonate chrome unavailable, retrying without impersonation:', err.message);
      return spawnYtdlp(args, opts);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download a video from an IG/TikTok URL using yt-dlp.
 *
 * Steps:
 *   1. Validate the URL (throws UNSUPPORTED_URL if bad).
 *   2. Run yt-dlp --dump-json to get metadata (caption/description).
 *   3. Run yt-dlp to download the best video ≤ mp4/webm into a temp dir.
 *   4. Return { filePath, mimeType, caption, cleanup }.
 *
 * The caller MUST call cleanup() after it is done with the file.
 *
 * @param {string} url  Instagram or TikTok URL.
 * @returns {Promise<{
 *   filePath: string,
 *   mimeType: 'video/mp4' | 'video/webm',
 *   caption: string,
 *   cleanup: () => Promise<void>,
 * }>}
 */

/**
 * Best-effort: fetch the author's / pinned comments, where creators often post
 * the full written recipe. Never throws — returns '' on any failure or timeout.
 * @param {string} url
 * @param {string[]} cookieArgs
 * @returns {Promise<string>}
 */
async function fetchAuthorComments(url, cookieArgs) {
  try {
    const { stdout } = await runYtdlp(
      ['--dump-json', '--no-playlist', '--write-comments', ...cookieArgs, url],
      { timeoutMs: 40_000 },
    );
    const meta = JSON.parse(stdout.trim());
    const all = Array.isArray(meta.comments) ? meta.comments : [];
    if (all.length === 0) return '';
    // Prefer the uploader's own comments and pinned ones (recipe usually lives there).
    const authored = all.filter((c) => c && (c.author_is_uploader || c.is_pinned));
    const picked = (authored.length ? authored : all).slice(0, 15);
    return picked
      .map((c) => (typeof c.text === 'string' ? c.text.trim() : ''))
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4000);
  } catch {
    return ''; // comments are a bonus; never break extraction over them
  }
}

export async function downloadVideo(url) {
  validateUrl(url);

  // Build the shared cookie args (optional).
  const cookiesFile = process.env.YTDLP_COOKIES;
  const cookieArgs  = cookiesFile ? ['--cookies', cookiesFile] : [];

  // ── Step 1: fetch metadata (caption/description) ────────────────────────
  let caption = '';
  try {
    const { stdout } = await runYtdlp([
      '--dump-json',
      '--no-playlist',
      ...cookieArgs,
      url,
    ]);
    const meta = JSON.parse(stdout.trim());
    // Prefer full description; fall back to title.
    caption = meta.description ?? meta.title ?? '';
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    // JSON parse of metadata is non-fatal — we can still attempt the video.
    console.warn('[ytdlp] Could not parse metadata JSON:', err.message);
  }

  // ── Step 1b: best-effort — append author's / pinned comments (creators
  // often post the full written recipe there). Never blocks or fails. ──────
  try {
    const commentText = await fetchAuthorComments(url, cookieArgs);
    if (commentText) {
      caption = caption
        ? `${caption}\n\n--- AUTHOR / PINNED COMMENTS ---\n${commentText}`
        : commentText;
    }
  } catch { /* best-effort only */ }

  // ── Step 2: download video to a temp directory ──────────────────────────
  const tmpDir  = join(tmpdir(), `cookbook-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });

  const outTemplate = join(tmpDir, 'video.%(ext)s');

  // Prefer mp4; accept webm as fallback. Limit to ~200 MB to avoid model limits.
  const downloadArgs = [
    '--no-playlist',
    '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
    '--max-filesize', '200M',
    '--output', outTemplate,
    ...cookieArgs,
    url,
  ];

  try {
    await runYtdlp(downloadArgs, { timeoutMs: 180_000 });
  } catch (err) {
    // Cleanup the temp dir before re-throwing.
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  // ── Step 3: locate the downloaded file ──────────────────────────────────
  // yt-dlp writes to video.<ext>; try mp4 first, then webm.
  let entries;
  try {
    entries = await readdir(tmpDir);
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new ExtractError(
      CODES.FETCH_FAILED,
      `Could not read temp directory: ${err.message}`,
    );
  }

  const videoFile = entries.find((f) => /\.(mp4|webm|mov|mkv)$/i.test(f));
  if (!videoFile) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    // yt-dlp exited 0 but produced no video file — no stderr to classify,
    // but the shape is the same as NO_VIDEO_IN_POST: a photo/carousel post
    // (or Instagram withholding the video). One honest message covers both.
    throw new ExtractError(
      CODES.NO_VIDEO_IN_POST,
      'yt-dlp did not produce a video file.',
    );
  }

  const filePath = join(tmpDir, videoFile);
  const ext      = videoFile.split('.').pop().toLowerCase();
  const mimeType = ext === 'webm' ? 'video/webm' : 'video/mp4';

  const cleanup = async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  };

  return { filePath, mimeType, caption, cleanup };
}
