import { defineConfig, devices } from '@playwright/test'

/** The accuracy benchmark (spec 0014): real models on a bench-only build. */
const PORT = 4174

export default defineConfig({
  testDir: './bench',
  testMatch: '*.bench.ts',
  workers: 1,
  timeout: 30 * 60_000,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 1000 },
    baseURL: `http://localhost:${String(PORT)}`,
  },
  webServer: {
    command: `npx vite build --mode bench && npx vite preview --outDir dist-bench --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}/bench.html`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
