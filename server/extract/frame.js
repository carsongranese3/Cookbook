/**
 * server/extract/frame.js
 *
 * Grab a single "hero" frame from a video with ffmpeg and return it as a JPEG
 * data URI, to use as the recipe's photo. Best-effort: returns null on any
 * failure (the recipe image is optional and falls back to a gradient placeholder).
 *
 * Requires ffmpeg on PATH (already a yt-dlp dependency for merging).
 * Requires ffprobe on PATH (ships with ffmpeg).
 */

import { spawn }                  from 'node:child_process';
import { readFile, rm, mkdtemp }  from 'node:fs/promises';
import { tmpdir }                 from 'node:os';
import { join }                   from 'node:path';
import { downloadVideo }          from './ytdlp.js';

const FRAME_WIDTH = 720;  // max output width; height auto-scaled to keep aspect
const JPEG_QSCALE = '4';  // ffmpeg -q:v (2 = best … 31 = worst); 4 is a good balance

/**
 * Run ffmpeg with the given args. Resolves true on exit code 0, false otherwise
 * (missing binary, non-zero exit, or timeout). Never rejects.
 */
function runFfmpeg(args, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(false); }, timeoutMs);
    proc.on('error', () => { clearTimeout(timer); resolve(false); });
    proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

/** Extract one frame (using the given ffmpeg seek args) into a JPEG data URI, or null. */
async function grabFrame(filePath, seekArgs) {
  const dir = await mkdtemp(join(tmpdir(), 'cookbook-frame-'));
  const out = join(dir, 'frame.jpg');
  try {
    const ok = await runFfmpeg([
      ...seekArgs,                     // e.g. ['-ss','42'] or ['-sseof','-1.5']
      '-i', filePath,
      '-frames:v', '1',                // grab a single frame
      '-vf', `scale='min(${FRAME_WIDTH},iw)':-2`, // downscale to <=720w, keep aspect
      '-q:v', JPEG_QSCALE,
      '-f', 'image2',
      '-y', out,
    ]);
    if (!ok) return null;
    const buf = await readFile(out).catch(() => null);
    if (!buf || buf.length === 0) return null;
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Pick a hero frame for the recipe photo — biased toward the FINAL plated dish.
 * Tries the AI-suggested timestamp (the final-result frame) first; if that's
 * missing/out of range, falls back to a frame ~1.5s before the END of the video
 * (cooking videos show the finished dish at the end); then a near-start frame as
 * a last resort. Returns a JPEG data URI, or null.
 *
 * @param {string} filePath  Path to the downloaded/uploaded video.
 * @param {number|null} seconds  AI-suggested hero timestamp in seconds.
 * @returns {Promise<string|null>}
 */
export async function pickHeroFrameDataUri(filePath, seconds) {
  const frames = await extractCandidateFrames(filePath, seconds);
  return frames[0] ?? null;
}

// ---------------------------------------------------------------------------
// ffprobe helper
// ---------------------------------------------------------------------------

/**
 * Probe the video duration (in seconds) using ffprobe.
 * Returns a float, or null on any failure (missing binary, non-video file, etc.).
 * Never rejects.
 *
 * @param {string} filePath
 * @returns {Promise<number|null>}
 */
async function probeDuration(filePath) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }

    const chunks = [];
    proc.stdout.on('data', (c) => chunks.push(c));
    const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(null); }, 10_000);
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        const d = parseFloat(raw);
        resolve(Number.isFinite(d) && d > 0 ? d : null);
      } catch {
        resolve(null);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Candidate frames
// ---------------------------------------------------------------------------

const MAX_CANDIDATES = 6;
const DEDUP_WINDOW_S = 0.5; // timestamps within this distance are considered the same

/**
 * Clamp t to [lo, hi] and round to one decimal place.
 * @param {number} t
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clampRound(t, lo, hi) {
  return Math.round(Math.min(Math.max(t, lo), hi) * 10) / 10;
}

/**
 * Deduplicate an array of timestamps (numbers), removing any that are within
 * DEDUP_WINDOW_S seconds of an already-accepted timestamp.
 * Input is consumed in order; returns a new array.
 * @param {number[]} timestamps
 * @returns {number[]}
 */
function dedupeTimestamps(timestamps) {
  const accepted = [];
  for (const t of timestamps) {
    if (!accepted.some((a) => Math.abs(a - t) < DEDUP_WINDOW_S)) {
      accepted.push(t);
    }
  }
  return accepted;
}

/**
 * Grab multiple JPEG frames from a video, ordered best-guess first.
 *
 * Strategy:
 *  - If duration is known (via ffprobe), build candidate timestamps weighted
 *    toward the END (where the plated dish typically appears), with the AI's
 *    heroSeconds inserted at the front if valid.
 *  - If duration is unknown, fall back to end-relative seeks (ffmpeg -sseof)
 *    plus a couple of absolute timestamps.
 *
 * Returns an ordered array of `data:image/jpeg;base64,…` strings (≤MAX_CANDIDATES).
 * Never rejects — returns [] on failure.
 *
 * @param {string} filePath   Absolute path to the video file.
 * @param {number|null} heroSeconds  AI-suggested timestamp; may be null/0/NaN.
 * @returns {Promise<string[]>}
 */
export async function extractCandidateFrames(filePath, heroSeconds) {
  const results = [];

  // --- probe duration ---------------------------------------------------------
  const duration = await probeDuration(filePath);

  if (duration !== null) {
    // Clamp range: must be at least 0.2s in and at least 0.3s from the end.
    const lo = 0.2;
    const hi = Math.max(lo, duration - 0.3);

    // Build raw candidate timestamps (best-guess first → end-weighted).
    const rawTimestamps = [
      // AI hero timestamp first (if valid and positive).
      ...(Number.isFinite(Number(heroSeconds)) && Number(heroSeconds) > 0
        ? [Number(heroSeconds)]
        : []),
      // End-weighted positions.
      0.95 * duration,
      0.88 * duration,
      0.80 * duration,
      0.65 * duration,
      0.50 * duration,
    ];

    // Clamp, round, and deduplicate.
    const timestamps = dedupeTimestamps(rawTimestamps.map((t) => clampRound(t, lo, hi)));

    for (const t of timestamps.slice(0, MAX_CANDIDATES)) {
      const uri = await grabFrame(filePath, ['-ss', String(t)]);
      if (uri) results.push(uri);
    }
  } else {
    // Duration unknown — use end-relative (-sseof) seeks + a couple of
    // absolute positions as fallbacks.
    const seekArgSets = [
      ['-sseof', '-1'],
      ['-sseof', '-2.5'],
      ['-sseof', '-4'],
      ['-ss', String(Number.isFinite(Number(heroSeconds)) && Number(heroSeconds) > 0
        ? Number(heroSeconds) : 1)],
      ['-ss', '0.8'],
    ];

    for (const seekArgs of seekArgSets.slice(0, MAX_CANDIDATES)) {
      const uri = await grabFrame(filePath, seekArgs);
      if (uri) results.push(uri);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// URL → candidate frames (convenience helper for the /frames route)
// ---------------------------------------------------------------------------

/**
 * Download a video from an IG/TikTok URL (via yt-dlp) and extract candidate
 * frames. The temp file is cleaned up in a finally block whether or not frame
 * extraction succeeds. ExtractError from downloadVideo propagates to the caller.
 *
 * @param {string} url  An Instagram Reel or TikTok video URL.
 * @returns {Promise<string[]>}  Array of JPEG data URIs (may be empty if video
 *                               cannot be probed/decoded).
 */
export async function getCandidateFramesFromUrl(url) {
  const { filePath, cleanup } = await downloadVideo(url);
  try {
    return await extractCandidateFrames(filePath, null);
  } finally {
    await cleanup();
  }
}
