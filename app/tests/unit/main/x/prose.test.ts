// The two coordinate systems (D44).
//
// A mapping that is subtly wrong corrupts files quietly and shows its symptom
// nowhere near its cause, so this is tested on its own, exhaustively, against
// bodies with real marker syntax in them.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { HANDLE, Prose, stripHandles } from '../../../../src/main/x/prose.ts'
import { proseMarkers } from '../../../../src/main/x/prose.ts'
import type { DocumentOffset, ProseOffset } from '../../../../src/shared/document-api.ts'
import type { DocumentText } from '../../../../src/shared/document-api.ts'
import { rt } from '../../../support/text.ts'

const START = (s: string): string => `<!--tephra:tag-start ${s}-->`
const END = (s: string): string => `<!--tephra:tag-end ${s}-->`
const MARK = (s: string): string => `<!--tephra:mark ${s}-->`

const of = (raw: DocumentText): Prose => Prose.of(raw, proseMarkers(raw))

/** The two coordinate spaces are different types on purpose; these say which. */
const rawAt = (n: number): DocumentOffset => n as DocumentOffset
const proseAt = (n: number): ProseOffset => n as ProseOffset

test('prose is the body with the syntax taken out and handles standing in', () => {
  const p = of(rt(`One ${START('s')}two three${END('s')} four.\n`))
  assert.equal(p.text, `One ${HANDLE}two three four.\n`)
  assert.equal(p.text.includes('tephra'), false)
})

test('a bookmark is a handle; the end of a range is nothing at all', () => {
  assert.equal(of(rt(`a ${MARK('x')}b`)).text, `a ${HANDLE}b`)
  assert.equal(of(rt(`a ${END('x')}b`)).text, 'a b')
})

test('every prose offset survives a round trip', () => {
  for (const raw of [
    `One ${START('s')}two${END('s')} three.\n`,
    `${MARK('x')}At the very beginning.\n`,
    `At the very end.${END('s')}`,
    `${START('a')}${START('b')}adjacent${END('b')}${END('a')}\n`,
    'no markers at all\n',
    `${MARK('only')}`,
  ].map(rt)) {
    const p = of(raw)
    for (let i = 0; i <= p.text.length; i++) {
      assert.equal(p.toProse(rawAt(p.toDocument(proseAt(i)))), i, `prose ${i} of ${JSON.stringify(raw)}`)
    }
  }
})

test('a raw offset inside a marker collapses to where the marker sits', () => {
  const raw = rt(`One ${START('s')}two${END('s')}\n`)
  const p = of(raw)
  const inside = raw.indexOf(START('s')) + 5
  assert.equal(p.toProse(rawAt(inside)), 4, 'there is nothing inside a marker to point at')
  // And every offset within the marker gives the same answer.
  const first = raw.indexOf(START('s'))
  for (let i = first; i < first + START('s').length; i++) assert.equal(p.toProse(rawAt(i)), 4)
})

test('the trailing boundary: leftmost, so typing at the end extends the range', () => {
  const raw = rt(`One two${END('s')} three.\n`)
  const p = of(raw)
  const atEnd = p.text.indexOf(' three')
  assert.equal(p.toDocument(proseAt(atEnd)), raw.indexOf(END('s')), 'inside the range, before the marker')
  assert.equal(p.toDocumentAfter(proseAt(atEnd)), raw.indexOf(END('s')) + END('s').length, 'and the other side is reachable')
})

test('a handle is one character, and the offset after it is past its bytes', () => {
  const raw = rt(`a${MARK('x')}b`)
  const p = of(raw)
  assert.equal(p.text, `a${HANDLE}b`)
  assert.equal(p.handleAt(proseAt(1))?.from, 1)
  assert.equal(p.handleAt(proseAt(0)), null)
  assert.equal(p.handleAt(proseAt(2)), null)
  assert.equal(p.toDocument(proseAt(2)), raw.length - 1, 'after the handle is after the whole comment')
})

test('prose length is the body less what the markers took', () => {
  const raw = rt(`x${MARK('a')}y${START('b')}z${END('b')}\n`)
  const p = of(raw)
  const spent = proseMarkers(raw).reduce((n, m) => n + (m.to - m.from) - m.width, 0)
  assert.equal(p.text.length, raw.length - spent)
})

test('a deletion sweeping across a range end is carved around it', () => {
  // The bug this exists for: taking the tag-end with an ordinary deletion
  // leaves an unmatched tag-start, which runs to the end of the DAY.
  const raw = rt(`One two${END('s')} three four.\n`)
  const p = of(raw)
  const from = raw.indexOf('two')
  const to = raw.indexOf('four')
  const pieces = p.carve(rawAt(from), rawAt(to))
  assert.equal(pieces.length, 2, 'one deletion becomes two, with the marker between them')
  const kept = raw.slice(pieces[0]!.to, pieces[1]!.from)
  assert.equal(kept, END('s'))
})

test('a handle is NOT carved out — deleting one is a gesture with its own meaning', () => {
  const raw = rt(`One ${MARK('x')}two three.\n`)
  const p = of(raw)
  assert.deepEqual(p.carve(rawAt(0), rawAt(raw.length)), [{ from: 0, to: raw.length }])
})

test('markers wholly inside a range are found, partial ones are not', () => {
  const raw = rt(`One ${START('s')}two${END('s')} three.\n`)
  const p = of(raw)
  assert.equal(p.within(rawAt(0), rawAt(raw.length)).length, 2)
  assert.equal(p.within(rawAt(0), rawAt(raw.indexOf('two'))).length, 1)
  assert.equal(p.within(rawAt(raw.indexOf(START('s')) + 3), rawAt(raw.length)).length, 1, 'a half-covered marker is not covered')
})

test('handles cannot arrive from outside', () => {
  assert.equal(stripHandles(`pasted ${HANDLE}text`), 'pasted text')
})
