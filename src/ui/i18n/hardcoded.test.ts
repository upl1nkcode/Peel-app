import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Every screen file's source, by path relative to this folder (no Node APIs in src). */
const SOURCES = import.meta.glob<string>(
  ['../**/*.tsx', '!../**/*.test.tsx', '../../App.tsx'],
  { query: '?raw', import: 'default', eager: true },
)

/** Text that isn't language, so it isn't translated. */
const ALLOWED = new Set<string>([
  // Symbols used as button faces; their buttons carry translated names.
  '×',
  '⋯',
  '+',
  '‹',
  '✓',
  // The product's name is the same in every language.
  'Peel',
])

const ATTRIBUTES = new Set([
  'aria-label',
  'title',
  'alt',
  'placeholder',
  'aria-description',
  'aria-roledescription',
])

function offenders(path: string, text: string): string[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const found: string[] = []
  const report = (node: ts.Node, text: string) => {
    const t = text.trim()
    if (!/\p{L}/u.test(t) || ALLOWED.has(t)) return
    const { line } = source.getLineAndCharacterOfPosition(node.getStart())
    found.push(`${path}:${String(line + 1)} ${t}`)
  }
  const literal = (e: ts.Node | undefined): e is ts.StringLiteralLike =>
    !!e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text)
    if (ts.isJsxAttribute(node) && ATTRIBUTES.has(node.name.getText())) {
      const init = node.initializer
      if (literal(init)) report(init, init.text)
      if (init && ts.isJsxExpression(init) && literal(init.expression)) {
        report(init, init.expression.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('no hard-coded text (spec 0013)', () => {
  it('should_have_no_hard_coded_text (AC-25)', () => {
    const files = Object.entries(SOURCES)
    expect(files.length).toBeGreaterThan(10)
    expect(files.some(([path]) => path.endsWith('App.tsx'))).toBe(true)
    expect(files.flatMap(([path, text]) => offenders(path, text))).toEqual([])
  })
})
