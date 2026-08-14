// The containment check is unreachable through the renderer (Chromium clamps
// the path first), so this is the only place it is ever exercised.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { resolveWithinRoot } from '../../../src/main/paths.ts'

const root = resolve('/app/out/renderer')

test('serves ordinary paths', () => {
  assert.equal(resolveWithinRoot(root, '/index.html'), resolve(root, 'index.html'))
  assert.equal(resolveWithinRoot(root, '/assets/app.js'), resolve(root, 'assets/app.js'))
})

test('an empty path is the index', () => {
  assert.equal(resolveWithinRoot(root, '/'), resolve(root, 'index.html'))
  assert.equal(resolveWithinRoot(root, ''), resolve(root, 'index.html'))
})

test('rejects traversal in every spelling that reaches it', () => {
  for (const p of [
    '/../../../package.json',
    '/%2e%2e/%2e%2e/package.json',        // percent-encoded, survives some parsers
    '/assets/../../secrets',
    '/..%2f..%2fsecrets',
    '/%2e%2e%2f%2e%2e%2fsecrets',
  ]) {
    assert.equal(resolveWithinRoot(root, p), null, `should reject ${p}`)
  }
})

test('an absolute-looking path is clamped into the root, not escaped', () => {
  // This is what the './' prefix in resolveWithinRoot buys. Without it,
  // resolve(root, '/etc/passwd') returns /etc/passwd and leaves the tree
  // entirely. With it, the path is treated as relative and stays contained —
  // so the right assertion is containment, not rejection.
  assert.equal(resolveWithinRoot(root, '/etc/passwd'), resolve(root, 'etc/passwd'))
  assert.equal(resolveWithinRoot(root, '//etc/passwd'), resolve(root, 'etc/passwd'))
})

test('malformed percent-encoding is refused rather than guessed at', () => {
  assert.equal(resolveWithinRoot(root, '/%E0%A4%A'), null)
})

test('a sibling directory sharing a prefix is not inside the root', () => {
  // The classic startsWith(root) bug: /app/out/renderer-evil begins with the
  // root string but is not under it. path.relative does not confuse them.
  assert.equal(resolveWithinRoot(root, '/../renderer-evil/x'), null)
})
