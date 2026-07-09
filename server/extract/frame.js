/**
 * server/extract/frame.js
 *
 * Grab a single "hero" frame from a video with ffmpeg and return it as a JPEG
 * data URI, to use as the recipe's photo. Best-effort: returns null on any
 * failure (the recipe image is optional and falls back to a gradient placeholder).
 *
 * Requires ffmpeg on PATH (already a yt-dlp dependency for merging).
 */

import { spawn }                  from 'node:child_process';
import { readFile, rm, mkdtemp }  from 'node:fs/promises';
import { tmpdir }                 from 'node:os';
import { join }                   from 'node:path';

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

/** Extract one frame at `seconds` into a JPEG data URI, or null on failure. */
async function grabAt(filePath, seconds) {
  const dir = await mkdtemp(join(tmpdir(), 'cookbook-frame-'));
  const out = join(dir, 'frame.jpg');
  try {
    const ok = await runFfmpeg([
      '-ss', String(seconds),          // input seeking (fast) to the timestamp
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
 * Pick a hero frame for the recipe photo. Tries the AI-suggested timestamp
 * first, then a safe fallback near the start (in case the timestamp is out of
 * range or the video is very short). Returns a JPEG data URI, or null.
 *
 * @param {string} filePath  Path to the downloaded/uploaded video.
 * @param {number|null} seconds  AI-suggested hero timestamp in seconds.
 * @returns {Promise<string|null>}
 */
export async function pickHeroFrameDataUri(filePath, seconds) {
  const t = Number(seconds);
  const candidates = [];
  if (Number.isFinite(t) && t >= 0) candidates.push(t);
  candidates.push(1.0); // fallback if the AI timestamp misses or is out of range

  for (const c of candidates) {
    const uri = await grabAt(filePath, c);
    if (uri) return uri;
  }
  return null;
}
