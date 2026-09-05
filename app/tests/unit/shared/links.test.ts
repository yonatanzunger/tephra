// The link scanner (ML1, D61).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destination, flattenLinks, scanLinks } from '../../../src/shared/links.ts'
import { plainLine } from '../../../src/shared/plain.ts'

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

// ── showing a line where links cannot be live ──────────
//
// A row in the due-soon rail is itself a button that scrolls to the item, and
// an anchor inside a button is both invalid and a second thing to hit; a menu's
// label is a label. Neither can render live links, and both were showing the
// raw `[text](https://…)` — the file being honest in a place nobody asked it
// to be. Labels rather than nothing, because the label is what the line SAYS.

test('a link becomes the words it shows', () => {
  assert.equal(
    flattenLinks('Review [Steve\'s bio draft](https://docs.google.com/document/d/1t8/edit)'),
    "Review Steve's bio draft",
  )
})

test('text with no links is returned as it is', () => {
  assert.equal(flattenLinks('call the surveyor #house'), 'call the surveyor #house')
})

test('several links in one line all flatten', () => {
  assert.equal(
    flattenLinks('compare [one](../a.md) against [two](../b.md) again'),
    'compare one against two again',
  )
})

test('an image leaves nothing behind, because its label is alt text', () => {
  // A row is a line of type; there is nowhere for a picture to go, and "the
  // words it shows" for an image is a description of a thing that is absent.
  assert.equal(flattenLinks('the plan ![a floor plan](../plan.png) as drawn'), 'the plan as drawn')
})

test('a bare URL is left alone, because it already reads as itself', () => {
  assert.equal(flattenLinks('see https://example.com/survey'), 'see https://example.com/survey')
})

// ── a line of the corpus, as a reader would read it ────
//
// **Reported from use**, in the link directory: a task's context line showed
// `- [ ] Review Steve's bio draft #career <!--tephra:item oqacmjoh 178… 178…-->`,
// which is exactly what is in the file and is not the sentence. The file being
// what it appears to be (R26, D20) is the premise of the storage, and it means
// a line pulled out for display carries what the app wrote beside what a person
// did.

test('THE POINT: an item marker is machinery, and a reader is not shown it', () => {
  assert.equal(
    plainLine("- [ ] Review Steve's bio draft #career <!--tephra:item oqacmjoh 1788311075 1788397350-->"),
    "Review Steve's bio draft #career",
  )
})

test('tags and due dates STAY, because a person typed them and meant them', () => {
  // T16: there is one notation, and it is the one in the file.
  assert.equal(plainLine('- [ ] file the return #hmrc DUE 2026-09-07'), 'file the return #hmrc DUE 2026-09-07')
})

test('a bullet and a checkbox go, because a row is not showing its filing system', () => {
  assert.equal(plainLine('* 2026-03-31 [Applying fundamentals](https://example.org/a)'), '2026-03-31 Applying fundamentals')
  assert.equal(plainLine('- [x] done with it'), 'done with it')
})

test('and link markup collapses to the words it was written with', () => {
  assert.equal(plainLine('Read [the paper](https://example.com/x) this morning.'), 'Read the paper this morning.')
})

test('ordinary prose comes back as it is', () => {
  assert.equal(plainLine('Just a sentence.'), 'Just a sentence.')
})
