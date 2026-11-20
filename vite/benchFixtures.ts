import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/** Copies bench/fixtures/* into the bench build's bench-fixtures/ (spec 0014; bench mode only). */
export function benchFixtures(): Plugin {
  let root = process.cwd()
  return {
    name: 'peel-bench-fixtures',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    generateBundle() {
      const dir = join(root, 'bench', 'fixtures')
      for (const name of readdirSync(dir)) {
        if (!/\.(jpg|png)$/.test(name)) continue
        this.emitFile({
          type: 'asset',
          fileName: `bench-fixtures/${name}`,
          source: readFileSync(join(dir, name)),
        })
      }
    },
  }
}
