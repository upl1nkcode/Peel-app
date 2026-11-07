import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/** Pages serves files up to 25 MiB; parts are cut a little below (spec 0007 decision 3). */
export const PART_BYTES = 24 * 1024 * 1024

const VIRTUAL_ID = 'virtual:peel-models'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

interface Source {
  key: 'engineLoader' | 'engineWasm' | 'fast' | 'precise'
  /** Served path, also the cache key. */
  path: string
  file: string
  type: string
}

interface ModelFile {
  path: string
  bytes: number
  sha256: string
  parts?: { path: string; bytes: number }[]
}

function sources(root: string): Source[] {
  // The package's `exports` hide its files, so read them from node_modules directly.
  const wasmDir = join(
    root,
    'node_modules',
    '@mediapipe',
    'tasks-vision',
    'wasm',
  )
  return [
    {
      key: 'engineLoader',
      path: '/engine/vision_wasm_module_internal.js',
      file: join(wasmDir, 'vision_wasm_module_internal.js'),
      type: 'text/javascript',
    },
    {
      key: 'engineWasm',
      path: '/engine/vision_wasm_module_internal.wasm',
      file: join(wasmDir, 'vision_wasm_module_internal.wasm'),
      type: 'application/wasm',
    },
    {
      key: 'fast',
      path: '/models/magic_touch.tflite',
      file: join(root, 'models', 'magic_touch.tflite'),
      type: 'application/octet-stream',
    },
    {
      key: 'precise',
      path: '/models/interactive_segmentation.task',
      file: join(root, 'models', 'interactive_segmentation.task'),
      type: 'application/octet-stream',
    },
  ]
}

/** Every served file (path → bytes and type) and the manifest describing them. */
function build(root: string) {
  const served = new Map<string, { data: Buffer; type: string }>()
  const files = {} as Record<Source['key'], ModelFile>
  for (const s of sources(root)) {
    const data = readFileSync(s.file)
    const entry: ModelFile = {
      path: s.path,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    }
    if (data.length > PART_BYTES) {
      entry.parts = []
      for (let at = 0, k = 1; at < data.length; at += PART_BYTES, k++) {
        const part = data.subarray(at, Math.min(data.length, at + PART_BYTES))
        const path = `${s.path}.part${String(k)}`
        entry.parts.push({ path, bytes: part.length })
        served.set(path, { data: part, type: s.type })
      }
    } else {
      served.set(s.path, { data, type: s.type })
    }
    files[s.key] = entry
  }
  const manifest = { files }
  served.set('/models/manifest.json', {
    data: Buffer.from(JSON.stringify(manifest, null, 2)),
    type: 'application/json',
  })
  return { served, manifest }
}

/**
 * Serves the MediaPipe engine (copied from node_modules) and the tap models
 * (from `models/`) at `/engine/` and `/models/`, splits files over 24 MiB
 * into parts, and writes their manifest with sizes and SHA-256. The app reads
 * the manifest from `virtual:peel-models`, so it needs no request before Auto
 * is used (spec 0007 AC-19); `/models/manifest.json` is for tests and tools.
 */
export function peelModels(): Plugin {
  let root = process.cwd()
  let cached: ReturnType<typeof build> | undefined
  const get = () => (cached ??= build(root))
  return {
    name: 'peel-models',
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined
      return `export default ${JSON.stringify(get().manifest)}`
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? ''
        const hit = get().served.get(path)
        if (!hit) {
          next()
          return
        }
        res.setHeader('Content-Type', hit.type)
        res.setHeader('Content-Length', String(hit.data.length))
        res.end(hit.data)
      })
    },
    generateBundle() {
      for (const [path, { data }] of get().served) {
        this.emitFile({ type: 'asset', fileName: path.slice(1), source: data })
      }
    },
  }
}
