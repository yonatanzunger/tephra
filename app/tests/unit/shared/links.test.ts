// The link scanner (ML1, D61).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destination, scanLinks } from '../../../src/shared/links.ts'

test('THE BUG THIS FIXES: a link with a space in its URL is still a link', () => {
  // `destination()` writes the angle-bracket form whenever a URL cannot survive
  // being written bare — and the editor's own regex could not read it back, so
  // Insert Link produced something the app would not render as a link. The
  // scanner and the writer are now two halves of one grammar.
  const written = `[The survey](${destination('https://example.com/a file.pdf')})`
  assert.equal(written, '[The survey](<https://example.com/a file.pdf>)')

  const found = scanLinks(written)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.label, 'The survey')
  assert.equal(found[0]?.target, 'https://example.com/a file.pdf', 'and the brackets are apparatus')
  assert.equal(found[0]?.reference?.kind, 'url')
})

test('a link says where it points, in the vocabulary the app already has', () => {
  const kinds = (body: string): unknown => scanLinks(body).map(l => l.reference?.kind ?? null)
  assert.deepEqual(kinds('[a](https://example.com)'), ['url'])
  assert.deepEqual(kinds('[a](../notes/offer.md)'), ['file'])
  assert.deepEqual(kinds('[a](tephra:tag/house)'), ['tag'])
  assert.deepEqual(kinds('[a](tephra:section/house)'), ['section'])
  assert.deepEqual(kinds('[a](mailto:someone@example.com)'), [null], 'a scheme we do not own')
})

test('an image is found and marked as one, rather than being hidden', () => {
  // It is a link by grammar and not by intent. The editor draws both; the link
  // directory will want only the ones you went to. The caller decides, which is
  // what keeps this scanner free of the directory's policy (D61).
  const found = scanLinks('![a photo](attachments/x.png) and [a note](notes/y.md)')
  assert.deepEqual(found.map(l => l.image), [true, false])
  assert.deepEqual(found.map(l => l.label), ['a photo', 'a note'])
})

test('offsets cover the whole link, so a caller can replace exactly it', () => {
  const body = 'see [The survey](../notes/survey.md) for the numbers'
  const found = scanLinks(body)[0]
  assert.ok(found !== undefined)
  assert.equal(body.slice(found.from, found.to), '[The survey](../notes/survey.md)')
})

test('several links on one line, in the order they were written', () => {
  const found = scanLinks('[one](a.md), [two](b.md) and [three](<c d.md>)')
  assert.deepEqual(found.map(l => l.target), ['a.md', 'b.md', 'c d.md'])
})

test('things that are not links', () => {
  assert.deepEqual(scanLinks('just some prose'), [])
  assert.deepEqual(scanLinks('[an empty target]()'), [], 'points nowhere, so not a link yet')
  assert.deepEqual(scanLinks('[unclosed](a.md'), [])
  // A reference-style link names a definition elsewhere. Not supported, and
  // silently mis-reading one as a target would be worse than not finding it.
  assert.deepEqual(scanLinks('[a][ref]'), [])
})

test('a link with no label is still a destination', () => {
  const found = scanLinks('[](https://example.com)')
  assert.equal(found[0]?.label, '')
  assert.equal(found[0]?.target, 'https://example.com')
})
