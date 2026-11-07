import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { peelModels } from './vite/peelModels'

const THEME_COLOR = '#6d28d9'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    peelModels(),
    VitePWA({
      // Silent auto-update for now; switch to 'prompt' with the update prompt UI (plan Phase 9).
      registerType: 'autoUpdate',
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
        ],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
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
})
