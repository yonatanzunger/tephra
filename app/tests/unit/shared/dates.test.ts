import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dateKeyAt, asDateKey, dayLabel, weekdayOf, compareDateKeys, addDays, daysBetween,
  msUntilNextDay, isKnownZone, stampAt, DEFAULT_ZONE,
} from '../../../src/shared/dates.ts'
import type { DateKey } from '../../../src/shared/document-api.ts'

const key = (s: string): DateKey => s as DateKey

test('an unset notebook still means the fixed UTC-8 D38 chose', () => {
  // `Etc/GMT+8` is UTC−8 year-round with no DST rule — the sign is POSIX's
  // convention, not a typo — so a corpus written under D38 reads as it was
  // written while every date in the app takes one zone-aware path (D63).
  assert.equal(DEFAULT_ZONE, 'Etc/GMT+8')
  assert.equal(dateKeyAt(new Date('2026-03-14T07:59:00Z')), '2026-03-13', 'a minute before midnight')
  assert.equal(dateKeyAt(new Date('2026-03-14T08:00:00Z')), '2026-03-14', 'and a minute after')
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

test('a different zone puts the same instant on a different day', () => {
  // 23:30 in Zurich on the 14th is 14:30 in California on the same day — but
  // 00:30 Zurich on the 15th is still the 14th in California, which is the
  // whole of why the zone belongs to the notebook (D63).
  const at = new Date('2026-03-14T23:30:00Z')
  assert.equal(dateKeyAt(at, 'Europe/Zurich'), '2026-03-15', 'past midnight in Zurich')
  assert.equal(dateKeyAt(at, 'America/Los_Angeles'), '2026-03-14', 'and still afternoon in California')
})

test('a DST day is 23 or 25 hours and is still one day with one name', () => {
  // The US springs forward on 2026-03-08. Every instant of that day is still
  // that day, and the count to the next one is still one.
  const zone = 'America/Los_Angeles'
  assert.equal(dateKeyAt(new Date('2026-03-08T09:59:00Z'), zone), '2026-03-08')
  assert.equal(dateKeyAt(new Date('2026-03-08T10:01:00Z'), zone), '2026-03-08')
  assert.equal(daysBetween(key('2026-03-08'), key('2026-03-09')), 1)
  // And the wait to the boundary is the real one — 23 hours, not 24.
  const from = new Date('2026-03-08T08:00:00Z') // midnight PST, the day begins
  assert.ok(Math.abs(msUntilNextDay(from, zone) - 23 * 3_600_000) < 90_000)
})

test('a weekday is a property of the date, not of where you are', () => {
  assert.equal(weekdayOf(key('2026-03-14')), 6, 'a Saturday')
  assert.equal(weekdayOf(key('2026-09-04')), 5, 'a Friday')
})

test('a zone this machine has never heard of is not silently UTC', () => {
  assert.equal(isKnownZone('Europe/Zurich'), true)
  assert.equal(isKnownZone('Etc/GMT+8'), true)
  assert.equal(isKnownZone('Middle/Earth'), false)
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

// ── a formatter that refuses what it cannot read ───────
//
// `dayLabel` used to bail only when there were fewer than three hyphen-parts,
// so it answered confidently for text that was never a date — and a heading
// reading `AI-driven, market-shaping` became a Timeline row reading
// `NaN driven, market`. The caller that could do that is fixed; a formatter
// that invents a label will find another caller eventually.
test('a label is only made from something shaped like a date', () => {
  assert.equal(dayLabel('2026-09-04' as DateKey), '4 Sep')
  assert.equal(dayLabel('AI-driven, market-shaping' as DateKey), 'AI-driven, market-shaping')
  assert.equal(dayLabel('content/uploads/2023-05-12-thing' as DateKey), 'content/uploads/2023-05-12-thing')
  assert.equal(dayLabel('**Introduction**' as DateKey), '**Introduction**')
})

// ── the byline's instant (D62, D63) ────────────────────────────────────────

test('A BYLINE IS STAMPED IN THE NOTEBOOK\'S ZONE, not in UTC', () => {
  // **The bug this replaced.** Comments were stamped
  // `new Date().toISOString().slice(0, 16)`, so a comment written at 18:30 on
  // the 13th in Los Angeles was written down as `2026-09-14T01:30` — tomorrow,
  // and the wrong hour. Third of a family: completion stamps were taken from
  // the wall clock while `today` came from the service, and `dueOn` computed in
  // UTC so a task finished at 17:42 in a GMT+8 notebook came due *tomorrow*.
  const at = new Date('2026-09-14T01:30:00Z')
  assert.equal(at.toISOString().slice(0, 16), '2026-09-14T01:30', 'what UTC would have said')
  assert.equal(stampAt(at, 'America/Los_Angeles'), '2026-09-13T18:30')
  assert.equal(stampAt(at, 'Etc/GMT-8'), '2026-09-14T09:30')
})

test('and midnight is 00:00, which is the classic way to get this wrong', () => {
  // `hour12: false` yields **24**:00 for midnight in several engines; `hourCycle:
  // 'h23'` is the one that says 00. 16:00 UTC is exactly midnight in UTC+8.
  assert.equal(stampAt(new Date('2026-09-14T16:00:00Z'), 'Etc/GMT-8'), '2026-09-15T00:00')
  assert.equal(stampAt(new Date('2026-09-14T04:00:00Z'), 'Etc/GMT-8'), '2026-09-14T12:00')
})

test('and it agrees with dateKeyAt about which day it is', () => {
  // Two functions that answer *which date is this instant in* must not differ,
  // which is the whole reason the stamp is not assembled from two sources.
  for (const zone of ['America/Los_Angeles', 'Etc/GMT-8', 'Europe/London']) {
    for (const iso of ['2026-09-14T01:30:00Z', '2026-09-14T16:00:00Z', '2026-01-01T23:59:00Z']) {
      const at = new Date(iso)
      assert.equal(stampAt(at, zone).slice(0, 10), dateKeyAt(at, zone), `${zone} ${iso}`)
    }
  }
})
