// Pointing an <img> at the corpus (R7).
//
// **The file keeps a relative link and the screen needs an absolute one.** Every
// link in the format is relative so that the directory can be moved, synced, or
// read by something else (format-spec) — and the renderer is served from
// `tephra://app`, where a relative src resolves against the bundle rather than
// the notebook. That mismatch is why every inline image in this app drew as a
// broken one until the corpus was given a host.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { imageSrc } from '../../../src/shared/scheme.ts'

test('THE POINT: a relative src resolves against the document it was written in', () => {
  assert.equal(
    imageSrc('../../../attachments/2026/09/2026-09-09-plan-abc123.png', 'notebook.stream/2026/09'),
    'tephra://notebook/attachments/2026/09/2026-09-09-plan-abc123.png',
  )
  // A note is one level down, so the same picture is one `..` away rather than
  // three. Which is exactly why the base comes from main (D59).
  assert.equal(
    imageSrc('../attachments/2026/09/x.png', 'notes'),
    'tephra://notebook/attachments/2026/09/x.png',
  )
})

test('a sibling needs no dots at all', () => {
  assert.equal(imageSrc('picture.png', 'notes'), 'tephra://notebook/notes/picture.png')
})

test('and it cannot climb out of the notebook', () => {
  // `resolveWithinRoot` guards the handler too, but a src that asks to leave is
  // a src that should not have been built.
  assert.equal(imageSrc('../../../../../../etc/passwd', 'notes'), 'tephra://notebook/etc/passwd')
})

test('anything already absolute is left exactly as it was', () => {
  // Not the notebook's file to serve: a picture from the web, or one inlined
  // into the text as bytes.
  for (const src of ['https://example.com/a.png', 'data:image/png;base64,AAAA', '//cdn/x.png']) {
    assert.equal(imageSrc(src, 'notes'), src)
  }
})

test('a space in a filename survives the trip', () => {
  assert.equal(imageSrc('../attachments/a b.png', 'notes'), 'tephra://notebook/attachments/a%20b.png')
})

test('and an empty base means the notebook root, which is the safe answer', () => {
  // What is true for the moment before main has answered. A picture that cannot
  // be placed draws as broken rather than as some other file.
  assert.equal(imageSrc('attachments/x.png', ''), 'tephra://notebook/attachments/x.png')
})

// ── what a document is named (MH1) ─────────────────────────

/**
 * **The bug this pins**: three copies of this rule lived in `App.tsx`,
 * `notebook-service.ts` and `x/fileset.ts`, and MH1 found them apart the way
 * such things always are — a docket showed in the sidebar as `house.docket`
 * while the titlebar called it *The house*, because only some of the copies had
 * learned the new suffix.
 */
test('every suffix this app puts on a document comes off', async () => {
  const { nameOf } = await import('../../../src/shared/slug.ts')
  assert.equal(nameOf('dockets/house.docket.md'), 'house')
  assert.equal(nameOf('notes/offer.md'), 'offer')
  assert.equal(nameOf('blog-posts.todo.md'), 'blog-posts')
  assert.equal(nameOf('sections/house-deal.fileset.md'), 'house-deal')
  // A directory document wears its kind on the directory (D59).
  assert.equal(nameOf('tasks.todo'), 'tasks')
  assert.equal(nameOf('notebook.stream'), 'notebook')
})
