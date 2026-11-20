/** Squared distances along one line: Felzenszwalb and Huttenlocher's lower envelope of parabolas. */
function line1d(
  f: Float64Array,
  n: number,
  out: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  let k = -1
  for (let q = 0; q < n; q++) {
    const fq = f[q] as number
    if (fq === Infinity) continue
    if (k < 0) {
      k = 0
      v[0] = q
      z[0] = -Infinity
      z[1] = Infinity
      continue
    }
    let s: number
    for (;;) {
      const p = v[k] as number
      s = (fq + q * q - ((f[p] as number) + p * p)) / (2 * q - 2 * p)
      if (s > (z[k] as number)) break
      k--
      if (k < 0) break
    }
    k++
    v[k] = q
    z[k] = k === 0 ? -Infinity : s
    z[k + 1] = Infinity
  }
  if (k < 0) {
    out.fill(Infinity, 0, n)
    return
  }
  let j = 0
  for (let q = 0; q < n; q++) {
    while ((z[j + 1] as number) < q) j++
    const p = v[j] as number
    out[q] = (q - p) * (q - p) + (f[p] as number)
  }
}

/**
 * The exact Euclidean distance (px) from each pixel to the nearest pixel
 * where `inSet` is non-zero; `Infinity` everywhere when no pixel is set.
 */
export function distanceToSet(
  width: number,
  height: number,
  inSet: Uint8Array,
): Float64Array {
  if (inSet.length !== width * height) {
    throw new RangeError('inSet must have width × height entries')
  }
  const n = Math.max(width, height)
  const f = new Float64Array(n)
  const out = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const d = new Float64Array(width * height)
  // Columns first, then rows on the squared column distances.
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      f[y] = inSet[y * width + x] ? 0 : Infinity
    }
    line1d(f, height, out, v, z)
    for (let y = 0; y < height; y++) d[y * width + x] = out[y] as number
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = d[y * width + x] as number
    line1d(f, width, out, v, z)
    for (let x = 0; x < width; x++) {
      d[y * width + x] = Math.sqrt(out[x] as number)
    }
  }
  return d
}
