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
 *   UNSUPPORTED_URL — not an IG or TikTok link
 *   FETCH_FAILED    — yt-dlp not found, non-zero exit, or I/O error
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
          CODES.FETCH_FAILED,
          `yt-dlp not found or could not be spawned: ${err.message}`,
          'Could not start the video downloader. Make sure yt-dlp is installed on the server.',
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
        reject(
          new ExtractError(
            CODES.FETCH_FAILED,
            `yt-dlp exited ${code}: ${stderr.slice(0, 500)}`,
            undefined,
            // Untruncated stderr: the identifying line for the impersonation
            // fallback (e.g. "Impersonate target ... is not available") can
            // sit well past 500 chars in a long Python traceback.
            `yt-dlp exited ${code}: ${stderr}`,
          ),
        );
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new ExtractError(
          CODES.FETCH_FAILED,
          `yt-dlp process error: ${err.message}`,
          'Could not read that video. Check the link, or upload the file instead.',
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
    throw new ExtractError(
      CODES.FETCH_FAILED,
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
