import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dateKeyAt, asDateKey, startOfDay, compareDateKeys, addDays, daysBetween,
  REFERENCE_ZONE_OFFSET_MINUTES,
} from '../../../src/shared/dates.ts'
import type { DateKey } from '../../../src/shared/document-api.ts'

const key = (s: string): DateKey => s as DateKey

test('the reference zone is a fixed UTC-8 (D38)', () => {
  assert.equal(REFERENCE_ZONE_OFFSET_MINUTES, -480)
})

test('filing date is computed in the reference zone, not UTC', () => {
  // 2026-03-15 03:00 UTC is still 2026-03-14 19:00 in the reference zone.
  assert.equal(dateKeyAt(new Date('2026-03-15T03:00:00Z')), '2026-03-14')
  // 2026-03-15 08:00 UTC is 00:00 reference — the day has just rolled.
  assert.equal(dateKeyAt(new Date('2026-03-15T08:00:00Z')), '2026-03-15')
  // One minute earlier is still the previous day.
  assert.equal(dateKeyAt(new Date('2026-03-15T07:59:59Z')), '2026-03-14')
})

test('the day rolls at the same instant all year — no DST discontinuity', () => {
  // A fixed offset means the boundary never moves. In March (PDT) and in
  // December (PST) the roll is the same UTC instant, which is the whole point
  // of not using a named zone: no hour is ever doubled or skipped.
  assert.equal(dateKeyAt(new Date('2026-07-04T07:59:00Z')), '2026-07-03')
  assert.equal(dateKeyAt(new Date('2026-07-04T08:00:00Z')), '2026-07-04')
  assert.equal(dateKeyAt(new Date('2026-12-04T07:59:00Z')), '2026-12-03')
  assert.equal(dateKeyAt(new Date('2026-12-04T08:00:00Z')), '2026-12-04')
})

test('a European working day lands on one reference date', () => {
  // The travel case that motivated the choice: UTC-8 is nine hours behind CET,
  // so 09:00–24:00 in Zurich maps entirely onto the same-numbered day.
  const zurichMorning = new Date('2026-03-14T08:00:00Z') // 09:00 CET
  const zurichMidnight = new Date('2026-03-14T22:59:00Z') // 23:59 CET
  assert.equal(dateKeyAt(zurichMorning), '2026-03-14')
  assert.equal(dateKeyAt(zurichMidnight), '2026-03-14')
  // Only writing before ~09:00 local falls back a day — the residual oddity.
  assert.equal(dateKeyAt(new Date('2026-03-14T06:00:00Z')), '2026-03-13') // 07:00 CET
})

test('asDateKey validates shape and reality', () => {
  assert.equal(asDateKey('2026-03-14'), '2026-03-14')
  assert.equal(asDateKey('2026-3-14'), null, 'must be zero-padded')
  assert.equal(asDateKey('not-a-date'), null)
  assert.equal(asDateKey('2026-02-30'), null, 'shape is right but the day does not exist')
  assert.equal(asDateKey('2026-13-01'), null)
  assert.equal(asDateKey('2024-02-29'), '2024-02-29', 'leap day is real')
})

test('startOfDay is the reference-zone midnight as a real instant', () => {
  assert.equal(startOfDay(key('2026-03-14')).toISOString(), '2026-03-14T08:00:00.000Z')
})

test('date keys sort chronologically as strings', () => {
  assert.ok(compareDateKeys(key('2026-03-14'), key('2026-03-15')) < 0)
  assert.ok(compareDateKeys(key('2026-12-31'), key('2027-01-01')) < 0)
  assert.equal(compareDateKeys(key('2026-03-14'), key('2026-03-14')), 0)
})

test('day arithmetic crosses month and year boundaries', () => {
  assert.equal(addDays(key('2026-03-14'), 1), '2026-03-15')
  assert.equal(addDays(key('2026-03-31'), 1), '2026-04-01')
  assert.equal(addDays(key('2026-01-01'), -1), '2025-12-31')
  assert.equal(addDays(key('2024-02-28'), 1), '2024-02-29')
  assert.equal(daysBetween(key('2026-03-14'), key('2026-03-21')), 7)
  assert.equal(daysBetween(key('2026-03-21'), key('2026-03-14')), -7)
})
