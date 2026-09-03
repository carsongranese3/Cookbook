import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
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
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
