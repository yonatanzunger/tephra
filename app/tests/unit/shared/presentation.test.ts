// Where each annotation is drawn — the one decision, asked of the one place
// that makes it (D50).
//
// These arrived with the tag spine, which is the first placement rule that
// needs a second fact about an annotation besides its kind. Until then every
// answer was a table lookup and a table lookup is hard to get wrong; an extent
// threshold is not.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLEAN, DESKTOP, MOBILE, PAPER, PAPER_SURFACE, REGION, SCREEN_SURFACE, place,
  type Presentation,
} from '../../../src/shared/presentation.ts'
import type { Annotation, Prose } from '../../../src/shared/prose.ts'
import type { ProseOffset, ProseText } from '../../../src/shared/document-api.ts'

const at = (from: number, to: number): { from: ProseOffset; to: ProseOffset } =>
  ({ from: from as ProseOffset, to: to as ProseOffset })

const tag = (subject: string, from: number, to: number): Annotation<ProseOffset> =>
  ({ kind: 'tag', at: at(from, to), subject })

const proseOf = (...annotations: Annotation<ProseOffset>[]): Prose<ProseOffset> =>
  ({ text: '' as ProseText, annotations })

const slotsOf = (
  prose: Prose<ProseOffset>,
  how: Presentation,
  surface = SCREEN_SURFACE,
): string[] => place(prose, how, surface).map(p => p.slot)

test('A PHRASE POINTS: a short tag keeps its rule under the words', () => {
  // An underline means *these words*, and for a handful of them it is right.
  assert.deepEqual(slotsOf(proseOf(tag('house', 0, 20)), DESKTOP), ['flow'])
})

test('AND A REGION CLAIMS: a long one goes to the spine instead', () => {
  // Reported from use: a subject over whole sections put an underline on every
  // line of them, and overlapping subjects put three there.
  assert.deepEqual(slotsOf(proseOf(tag('house', 0, REGION + 1)), DESKTOP), ['spine'])
})

test('and the threshold is a boundary, not a neighbourhood', () => {
  assert.deepEqual(slotsOf(proseOf(tag('house', 0, REGION)), DESKTOP), ['flow'])
  assert.deepEqual(slotsOf(proseOf(tag('house', 10, 10 + REGION + 1)), DESKTOP), ['spine'])
})

test('THE EXTENT IS A FACT ABOUT THE DOCUMENT, not about the window', () => {
  // The rule deliberately does not ask *does this wrap?*. A rule that did would
  // be a rule about the window: widen it and a region silently becomes a
  // phrase, which is a notation that changes while nobody is looking at it.
  // Nothing here is measured, so there is nothing for a resize to change.
  const wide = proseOf(tag('house', 0, REGION * 4))
  assert.deepEqual(slotsOf(wide, DESKTOP), ['spine'])
  assert.deepEqual(slotsOf(wide, DESKTOP), ['spine'], 'and it is the same answer twice')
})

test('the other kinds are unmoved by any of this', () => {
  const mixed = proseOf(
    { kind: 'date', at: at(0, 0), date: '2026-09-13' },
    { kind: 'anchor', at: at(1, 1), name: 'here' },
    tag('house', 2, REGION * 2),
    { kind: 'heading', at: at(3, 3), text: 'A day', level: 2 },
  )
  assert.deepEqual(slotsOf(mixed, DESKTOP), ['flow', 'margin', 'spine', 'flow'])
})

test('PAPER HAS NO SPINE TO DRAW IN, so it is asked for the name', () => {
  // A page cannot carry a rule down the side of a region it may not even
  // contain, so the substitution happens here rather than in the printer —
  // the same rule footnotes already follow on a surface that does not paginate.
  const long = proseOf(tag('house', 0, REGION * 3))
  assert.deepEqual(slotsOf(long, PAPER, PAPER_SURFACE), ['margin'])
  // And asking for the spine explicitly on paper gets the same answer.
  const asked: Presentation = { ...PAPER, tag: 'byExtent' }
  assert.deepEqual(slotsOf(long, asked, PAPER_SURFACE), ['margin'])
})

test('and a surface that says nothing still says nothing', () => {
  assert.deepEqual(slotsOf(proseOf(tag('house', 0, REGION * 3)), CLEAN), ['none'])
  assert.deepEqual(slotsOf(proseOf(tag('house', 0, 5)), CLEAN), ['none'])
})

test('MOBILE KEEPS ITS RULE, because it has no band to put a spine in', () => {
  assert.deepEqual(slotsOf(proseOf(tag('house', 0, REGION * 3)), MOBILE), ['flow'])
})

test('and reading order is what it is placed in, whatever the slots', () => {
  // Note numbering comes out right without a second pass because of this, so
  // it is worth a check of its own rather than being assumed by the ones above.
  const out = place(
    proseOf(tag('late', 90, 95), tag('early', 4, 9), tag('wide', 0, REGION * 2)),
    DESKTOP,
  )
  assert.deepEqual(
    out.map(p => (p.annotation.kind === 'tag' ? p.annotation.subject : '?')),
    ['wide', 'early', 'late'],
  )
})
