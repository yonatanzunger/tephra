import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  offsetOf, positionOf, comparePositions, spanOf, pointAt, isEmpty, contains,
  intersects, StalePositionError,
} from '../../../src/shared/positions.ts'
import type { SegmentKey, SessionGeneration, DocumentOffset } from '../../../src/shared/document-api.ts'

const seg = (s: string): SegmentKey => s as SegmentKey
const gen = (n: number): SessionGeneration => n as SessionGeneration
const at = (s: string, o: number, g = 1) => positionOf(seg(s), o as DocumentOffset, gen(g))

const PLAIN = 'hello world'
const EMOJI = 'a😀b' // 'a' + surrogate pair (2 units) + 'b' = length 4

test('offsetOf accepts the ends and everything between', () => {
  assert.equal(offsetOf(0, PLAIN), 0)
  assert.equal(offsetOf(PLAIN.length, PLAIN), PLAIN.length)
  assert.equal(offsetOf(5, PLAIN), 5)
})

test('offsetOf rejects out-of-range and non-integer offsets', () => {
  assert.throws(() => offsetOf(-1, PLAIN), RangeError)
  assert.throws(() => offsetOf(PLAIN.length + 1, PLAIN), RangeError)
  assert.throws(() => offsetOf(1.5, PLAIN), RangeError)
})

test('offsetOf refuses to split a surrogate pair', () => {
  // 'a😀b' — units are [a][hi][lo][b]. DocumentOffset 2 lands mid-emoji.
  assert.equal(EMOJI.length, 4)
  assert.equal(offsetOf(1, EMOJI), 1) // before the emoji
  assert.equal(offsetOf(3, EMOJI), 3) // after it
  assert.throws(() => offsetOf(2, EMOJI), /surrogate pair/)
})

test('positions order by segment, then offset', () => {
  assert.ok(comparePositions(at('2026-03-14', 0), at('2026-03-15', 0)) < 0)
  assert.ok(comparePositions(at('2026-03-14', 10), at('2026-03-14', 3)) > 0)
  assert.equal(comparePositions(at('2026-03-14', 7), at('2026-03-14', 7)), 0)
})

test('comparing across generations throws rather than answering', () => {
  // Two positions from different generations index different texts, so any
  // ordering between them is meaningless. This is the T1 shape made loud.
  assert.throws(() => comparePositions(at('2026-03-14', 0, 1), at('2026-03-14', 5, 2)),
    StalePositionError)
  assert.throws(() => spanOf(at('2026-03-14', 0, 1), at('2026-03-14', 5, 2)),
    StalePositionError)
})

test('a point is a zero-length span', () => {
  const p = pointAt(at('2026-03-14', 4))
  assert.ok(isEmpty(p))
  assert.equal(comparePositions(p.begin, p.end), 0)
})

test('containment is half-open', () => {
  const s = spanOf(at('2026-03-14', 2), at('2026-03-14', 6))
  assert.ok(contains(s, at('2026-03-14', 2)), 'begin is contained')
  assert.ok(contains(s, at('2026-03-14', 5)))
  assert.ok(!contains(s, at('2026-03-14', 6)), 'end is not contained')
  assert.ok(!contains(s, at('2026-03-14', 1)))
})

test('spans that merely touch do not intersect', () => {
  const a = spanOf(at('2026-03-14', 0), at('2026-03-14', 4))
  const b = spanOf(at('2026-03-14', 4), at('2026-03-14', 8))
  const c = spanOf(at('2026-03-14', 3), at('2026-03-14', 8))
  assert.ok(!intersects(a, b), 'abutting spans share no extent')
  assert.ok(intersects(a, c))
  assert.ok(intersects(c, a), 'symmetric')
})

test('spans in different segments do not intersect', () => {
  const a = spanOf(at('2026-03-14', 0), at('2026-03-14', 9))
  const b = spanOf(at('2026-03-15', 0), at('2026-03-15', 9))
  assert.ok(!intersects(a, b))
})
