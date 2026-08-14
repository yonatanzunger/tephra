// Pure path logic, deliberately free of any Electron import so it can be tested
// in plain Node. The protocol handler binds it to a scheme; the containment
// rule itself is ordinary computation and belongs where it can be exercised.

import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Resolve a request path inside `root`, or null if it escapes.
 *
 * Containment is *verified*, not sanitised: resolve first, then check that the
 * result actually lands inside the root. Stripping `../` from the input instead
 * only defends against the spellings you thought of.
 *
 * This cannot be reached through the renderer — Chromium normalises `../` and
 * `%2e%2e/` away before a standard-scheme handler sees them, so both arrive
 * already clamped. It is defence in depth against request sources that do not
 * normalise, which makes it a path that never runs in normal use, which is
 * precisely why it is unit-tested rather than trusted.
 */
export function resolveWithinRoot(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null // malformed percent-encoding is not a path we will guess at
  }
  const target = resolve(root, '.' + (decoded === '' || decoded === '/' ? '/index.html' : decoded))
  const rel = relative(root, target)
  return rel.startsWith('..') || isAbsolute(rel) ? null : target
}
