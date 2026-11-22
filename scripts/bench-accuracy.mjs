// Runs the accuracy benchmark (spec 0014 AC-6). `--update` rewrites bench/accuracy-baseline.json (AC-10).
import { spawnSync } from 'node:child_process'

const update = process.argv.includes('--update')
// `--only=a,b`: just those fixtures, written to bench/accuracy-only.json, not compared (spec 0015).
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
const result = spawnSync(
  'npx',
  ['playwright', 'test', '-c', 'playwright.bench.config.ts'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...(update && { BENCH_UPDATE: '1' }),
      ...(only && { BENCH_ONLY: only }),
    },
  },
)
process.exit(result.status ?? 1)
