import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { benchFixtures } from './vite/benchFixtures'
import { peelModels } from './vite/peelModels'

const THEME_COLOR = '#6d28d9'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // The WebP encoder finds its wasm next to its own script (new URL(…, import.meta.url));
  // pre-bundling would move the script away from it in the dev server (spec 0012).
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  // Module workers (services/workers.ts), so a worker's dynamic import (the
  // WebP encoder) becomes its own chunk instead of being inlined.
  worker: { format: 'es' },
  // The accuracy benchmark's own build (spec 0014): adds bench.html and its
  // test photos, in dist-bench/; the app's build never includes them.
  ...(mode === 'bench' && {
    build: {
      outDir: 'dist-bench',
      rollupOptions: { input: { main: 'index.html', bench: 'bench.html' } },
    },
  }),
  plugins: [
    react(),
    peelModels(),
    ...(mode === 'bench' ? [benchFixtures()] : []),
    VitePWA({
      // A new version waits until the Library's Reload (spec 0013 AC-22, AC-23).
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Peel',
        short_name: 'Peel',
        description:
          'Cut anything out of a photo onto a transparent background.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: THEME_COLOR,
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Root files and assets/ only: engine/ and models/ are downloaded and
        // cached by the app on first use (spec 0007 AC-19).
        globPatterns: [
          '*.{js,css,html,svg,png,webmanifest}',
          'assets/**/*.{js,css,html,svg,png,webmanifest}',
          // The WebP encoder's wasm: WhatsApp-style works offline after the
          // first visit (spec 0013 AC-20). It still loads only when chosen.
          'assets/webp_enc*.wasm',
        ],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'bench/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
      thresholds: {
        'src/core/**': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
}))
