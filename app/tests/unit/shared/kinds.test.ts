// What a document of each kind can be asked (D54).
//
// **These are compile-time claims, checked by `@ts-expect-error`.** The runtime
// assertions below are almost incidental: what is being tested is that the
// TYPES say a fileset has no extent in dates, because the whole point of moving
// `extent` and `dateAt` off `Document` was that implementing them elsewhere
// meant returning null forever — a type saying "not applicable" in the one
// vocabulary that cannot say it.
//
// A `@ts-expect-error` that stops erroring fails the build, so a later change
// that quietly puts a day-shaped method back on every document cannot pass.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isStream, ONLY_SEGMENT } from '../../../src/shared/document-api.ts'
import type { Document, DocumentMeta, StreamDocumentApi } from '../../../src/shared/document-api.ts'

/** Enough of a document to typecheck against; nothing here is called. */
const asDocument = (kind: DocumentMeta['kind']): Document =>
  ({ meta: { kind } } as unknown as Document)

test('a document in general has no extent and no date at a position', () => {
  const doc = asDocument('fileset')

  // @ts-expect-error — `extent` is the stream's (D54)
  void doc.extent
  // @ts-expect-error — `dateAt` is the stream's (D54)
  void doc.dateAt

  assert.equal(doc.meta.kind, 'fileset')
})

test('a stream has both, and narrowing is how a caller gets to them', () => {
  const doc = asDocument('stream')
  assert.equal(isStream(doc), true)
  if (isStream(doc)) {
    const stream: StreamDocumentApi = doc
    assert.equal(typeof stream.meta.kind, 'string')
  }
})

test('and narrowing declines everything else', () => {
  for (const kind of ['markdown', 'fileset', 'todo'] as const) {
    assert.equal(isStream(asDocument(kind)), false, `${kind} is not a stream`)
  }
})

test('a one-segment document has a segment key, and it is the same one for all', () => {
  // Said once, rather than every implementation choosing its own arbitrary
  // string for a component that carries no information (D27).
  assert.equal(ONLY_SEGMENT, 'content')
})
