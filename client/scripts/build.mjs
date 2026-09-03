/**
 * Stage-and-swap wrapper for `npm run build` (the plain, non-watch clean
 * build).
 *
 * Problem: a plain `vite build` uses emptyOutDir: true, which deletes
 * client/dist and rebuilds it over ~500-1000ms. com.cookbook.server (the
 * always-on LaunchAgent on :3001, which is what the phone hits over
 * Tailscale) serves straight out of client/dist, so during that window
 * every request hits an ENOENT on index.html.
 *
 * Fix: build into a sibling staging directory (dist.staging, itself
 * emptied/created fresh — cheap and safe since nothing else reads it), then
 * swap it into place with two fs.renameSync calls:
 *   1. dist       -> dist.old       (only if dist already exists)
 *   2. dist.staging -> dist
 *   3. rm -rf dist.old
 *
 * client/dist is only ever briefly absent between steps 1 and 2 — a gap of
 * a couple of synchronous rename() syscalls (milliseconds), not the
 * duration of the whole build. On first run (no existing dist/) step 1 is
 * skipped entirely, so there's no gap at all.
 *
 * A failed build removes dist.staging and leaves the live dist/ untouched.
 * The watch build (com.cookbook.build LaunchAgent, `vite build --watch`
 * with COOKBOOK_WATCH_BUILD=1) does not go through this script and is
 * unaffected.
 */
import { existsSync, rmSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(CLIENT_DIR, 'dist');
const STAGING = join(CLIENT_DIR, 'dist.staging');
const OLD = join(CLIENT_DIR, 'dist.old');
const VITE_BIN = join(CLIENT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');

// Clean up any leftovers from a previous interrupted run before starting —
// never leave dist.staging/dist.old lying around, whether we're about to
// succeed or fail.
for (const dir of [STAGING, OLD]) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

const result = spawnSync(process.execPath, [VITE_BIN, 'build'], {
  cwd: CLIENT_DIR,
  stdio: 'inherit',
  env: { ...process.env, COOKBOOK_OUT_DIR: STAGING },
});

if (result.error || result.status !== 0) {
  if (existsSync(STAGING)) rmSync(STAGING, { recursive: true, force: true });
  if (result.error) console.error('[build] failed to launch vite:', result.error);
  console.error('[build] vite build failed; client/dist left untouched.');
  process.exit(result.status ?? 1);
}

if (!existsSync(join(STAGING, 'index.html'))) {
  // Defensive: vite reported success but didn't produce the expected
  // output. Don't touch the live dist/.
  if (existsSync(STAGING)) rmSync(STAGING, { recursive: true, force: true });
  console.error('[build] staged output missing index.html; client/dist left untouched.');
  process.exit(1);
}

if (existsSync(DIST)) {
  renameSync(DIST, OLD);
}
renameSync(STAGING, DIST);
if (existsSync(OLD)) {
  rmSync(OLD, { recursive: true, force: true });
}

console.log('[build] client/dist updated (staged build, atomic swap).');
