import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The com.cookbook.build LaunchAgent runs `vite build --watch` with
// emptyOutDir disabled (see the `build` config below) so dist/ is never
// briefly empty for the always-on server. The tradeoff: without
// emptyOutDir, superseded hashed bundles from previous rebuilds are never
// removed from dist/assets, and vite-plugin-pwa's Workbox step globs
// dist/** to build the precache manifest — so every dead bundle gets
// precached and the phone re-downloads it on every SW update. This plugin
// deletes anything in dist/assets that isn't part of the bundle Rollup just
// wrote, so the directory holds only the current hashed files.
//
// Ordering: this only touches dist/assets, and it hooks writeBundle, which
// Rollup always runs after the bundle's files are physically written to
// disk and always before any plugin's closeBundle hook — which is where
// vite-plugin-pwa's Workbox step (globbing dist/** for the precache
// manifest) actually runs. So pruning here is guaranteed to complete before
// Workbox sees the directory, regardless of plugin array order. Verified
// empirically (see devops notes) rather than assumed.
function prunePreviousAssets() {
  let outDir;
  let assetsDir;
  return {
    name: 'cookbook-prune-previous-assets',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
      assetsDir = config.build.assetsDir; // 'assets' by default
    },
    writeBundle(_, bundle) {
      const dir = join(outDir, assetsDir);
      if (!existsSync(dir)) return;

      const current = new Set(
        Object.values(bundle)
          .map((file) => file.fileName)
          .filter((name) => name.startsWith(`${assetsDir}/`))
          .map((name) => name.slice(assetsDir.length + 1))
      );

      for (const entry of readdirSync(dir)) {
        if (current.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isFile()) rmSync(full);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    prunePreviousAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'The Cookbook',
        short_name: 'Cookbook',
        description: 'Personal recipe app with AI video import',
        theme_color: '#c56a4a',
        background_color: '#e7e5df',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Client-side routing: serve the app shell for any navigation (e.g.
        // /pantry, /recipe/:id) while leaving /api requests to the network.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Excludes /api/recipes/:id/video on purpose — that route streams
            // with HTTP Range support for <video> seeking, and a service worker
            // intercepting/caching range requests interacts badly with that.
            // Video stays network-only (won't play offline; accepted tradeoff).
            urlPattern: ({ url }) =>
              /^\/api\/recipes/.test(url.pathname) && !/\/video$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-recipes',
              expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: /https:\/\/fonts\.googleapis\.com/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /https:\/\/fonts\.gstatic\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    // The com.cookbook.build LaunchAgent runs `vite build --watch`, and Vite's
    // default emptyOutDir wipes dist/ before each rebuild — which briefly leaves
    // the always-on server on :3001 (the phone's URL, over Tailscale) with no
    // index.html to serve, producing an ENOENT on the SPA fallback route. In
    // watch mode we overwrite in place instead, so the app shell is never
    // missing. A plain `npm run build` still does a clean build.
    emptyOutDir: !process.env.COOKBOOK_WATCH_BUILD,

    // `npm run build` (plain clean build) goes through scripts/build.mjs,
    // which sets COOKBOOK_OUT_DIR to a sibling staging directory
    // (dist.staging) so the clean build's own emptyOutDir + rebuild never
    // touches the live dist/ that :3001 is serving — the script swaps
    // dist.staging into dist only after a successful build. Watch mode
    // doesn't set this, so it keeps writing straight to dist/ as before.
    outDir: process.env.COOKBOOK_OUT_DIR || 'dist',
  },

  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
