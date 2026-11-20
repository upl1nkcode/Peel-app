// Runs the accuracy benchmark (spec 0014 AC-6). `--update` rewrites bench/accuracy-baseline.json (AC-10).
import { spawnSync } from 'node:child_process'

const update = process.argv.includes('--update')
const result = spawnSync(
  'npx',
  ['playwright', 'test', '-c', 'playwright.bench.config.ts'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(update && { BENCH_UPDATE: '1' }) },
  },
)
process.exit(result.status ?? 1)
