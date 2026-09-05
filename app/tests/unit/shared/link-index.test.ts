// The link directory's policy (ML2, D60, D61).
//
// Its own module and its own tests, because these two functions are the ones
// expected to change — and every change invalidates every key the index holds.
// That is safe only because the index stores the raw target and derives the
// key on read (D60), which is what the branded type says out loud.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizeLink, indexable } from '../../../src/shared/link-index.ts'
import { scanLinks } from '../../../src/shared/links.ts'

const DAY = 'notebook.stream/2026/09/2026-09-02.md'
const only = (body: string) => scanLinks(body)[0]
const key = (target: string, inFile = DAY): string => canonicalizeLink(target, inFile)

// ── what counts (D61) ──────────────────────────────────

test('a URL and a file both belong in the directory', () => {
  assert.equal(indexable(only('see [the paper](https://example.com/a)') as never), true)
  assert.equal(indexable(only('see [the covenants](../../notes/c.md)') as never), true)
})

test('a tephra: reference does NOT — the sidebar already serves those', () => {
  // And they would bury the documents under them, which is the whole point of
  // the directory.
  assert.equal(indexable(only('see [that day](tephra:day/2026-03-01)') as never), false)
  assert.equal(indexable(only('see [the task](tephra:todo/aaaa1111)') as never), false)
})

test('and an image does not, because an embedded picture is not a document', () => {
  assert.equal(indexable(only('![a plan](../plan.png)') as never), false)
})

// ── the grouping key (D60) ─────────────────────────────

test('a fragment does not make a second document', () => {
  assert.equal(key('https://example.com/a#section-3'), 'https://example.com/a')
})

test('THE POINT: tracking parameters are noise, and the rest of the query is not', () => {
  assert.equal(
    key('https://example.com/a?utm_source=x&id=7&fbclid=abc'),
    'https://example.com/a?id=7',
  )
})

test('and a URL that was ONLY tracking loses its question mark too', () => {
  assert.equal(key('https://example.com/a?utm_source=x'), 'https://example.com/a')
})

test('the scheme and host are case-insensitive; the path is not', () => {
  assert.equal(key('HTTPS://Example.COM/Path'), 'https://example.com/Path')
})

test('a default port is not part of the name', () => {
  assert.equal(key('https://example.com:443/a'), 'https://example.com/a')
  assert.equal(key('http://example.com:80/a'), 'http://example.com/a')
  assert.equal(key('https://example.com:8443/a'), 'https://example.com:8443/a', 'and a real one is')
})

test('www is NOT stripped, and http is not unified with https', () => {
  // Both are claims about host identity that the URL does not itself make. The
  // patterns actually worth merging are learned from use; this does not have to
  // be a canonicalizer for the whole web.
  assert.notEqual(key('https://www.example.com/a'), key('https://example.com/a'))
  assert.notEqual(key('http://example.com/a'), key('https://example.com/a'))
})

test('something unparseable groups with itself rather than throwing', () => {
  // The file is hand-edited. Text that looks like a URL and is not still
  // deserves to be one row.
  assert.equal(key('https://'), 'https://')
})

// ── one document, one key, however it was reached ──────

test('THE POINT: the same file linked from two days has ONE key', () => {
  // Which is the whole reason canonicalization takes the containing file: the
  // relative spelling differs by where it was written and the document does not.
  // Three `..`, which is what `relativePath` writes from a day three
  // directories deep — the spelling the app itself produces.
  const fromDay = key('../../../notes/covenants.md', 'notebook.stream/2026/09/2026-09-02.md')
  const fromNote = key('covenants.md', 'notes/plan.md')
  assert.equal(fromDay, 'notes/covenants.md')
  assert.equal(fromNote, 'notes/covenants.md')
})

test('a file outside the notebook keeps the way out, named from the root', () => {
  // Still a link (D61), and `../elsewhere/x.md` relative to the root is a stable
  // name for it however many files point there.
  assert.equal(key('../../../../elsewhere/x.md'), '../elsewhere/x.md')
  assert.equal(key('../../elsewhere/x.md', 'notes/plan.md'), '../elsewhere/x.md')
})

test('a fragment on a file is dropped too', () => {
  assert.equal(key('../../../notes/c.md#a-heading'), 'notes/c.md')
})

test('an absolute path is left as it is', () => {
  assert.equal(key('/Users/someone/thing.md'), '/Users/someone/thing.md')
})
