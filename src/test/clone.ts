/** Deep copy of plain JSON-safe test data (core tests have no structuredClone: no DOM lib). */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
