// The day boundary (MD1, D62).
//
// The rule has three customers and used to have three answers, so it gets its
// tests before any of them are wired to it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DayClock } from '../../../../src/main/x/day-clock.ts'
import type { DateKey } from '../../../../src/shared/document-api.ts'

/** A clock that can be moved by hand. Times are in the reference zone (D38). */
function at(iso: string): { now: () => Date; set: (to: string) => void } {
  let current = new Date(iso)
  return { now: () => current, set: to => (current = new Date(to)) }
}

const MINUTE = 60_000
const d = (s: string): DateKey => s as DateKey

// 08:00Z is midnight in the reference zone, so these are all "evening" times
// on the day named.
const EVENING = '2026-09-01T05:00:00Z' // 21:00 on 2026-08-31
const LATE = '2026-09-01T08:30:00Z' // 00:30 on 2026-09-01
const MORNING = '2026-09-01T17:00:00Z' // 09:00 on 2026-09-01

test('an empty notebook is on today', () => {
  const clock = new DayClock(null, { now: at(MORNING).now })
  assert.equal(clock.writingDay, '2026-09-01')
  assert.equal(clock.clockDay, '2026-09-01')
})

test('THE POINT: writing past midnight stays in the evening it started in', () => {
  // The calendar has rolled and the person has not stopped, so the notebook has
  // not either. This is the passage that used to be split mid-sentence across
  // two files, and the reason the day separator went missing.
  const time = at(LATE)
  const clock = new DayClock({ day: d('2026-08-31'), writtenAt: new Date(LATE).getTime() - 5 * MINUTE }, {
    now: time.now,
  })
  assert.equal(clock.clockDay, '2026-09-01', 'the calendar has moved on')
  assert.equal(clock.writingDay, '2026-08-31', 'and the notebook has not')
  assert.equal(clock.tick(), false)
})

test('and rolls over once they have got up from the desk', () => {
  const time = at(LATE)
  const clock = new DayClock({ day: d('2026-08-31'), writtenAt: new Date(LATE).getTime() - 5 * MINUTE }, {
    now: time.now,
  })
  assert.equal(clock.writingDay, '2026-08-31')

  time.set('2026-09-01T09:15:00Z') // 45 minutes later, still nothing typed
  assert.equal(clock.tick(), true, 'the boundary is crossed')
  assert.equal(clock.writingDay, '2026-09-01')
  assert.equal(clock.tick(), false, 'and crossing it again does nothing')
})

test('typing holds the day open, however long the night runs', () => {
  const time = at(LATE)
  const clock = new DayClock({ day: d('2026-08-31'), writtenAt: new Date(LATE).getTime() }, { now: time.now })

  // A 25-minute pause, then another sentence, then another 25 minutes: never
  // idle long enough, so it is all still the same evening.
  time.set('2026-09-01T08:55:00Z')
  assert.equal(clock.tick(), false)
  clock.wrote()
  time.set('2026-09-01T09:20:00Z')
  assert.equal(clock.tick(), false)
  assert.equal(clock.writingDay, '2026-08-31')

  // Then they stop.
  time.set('2026-09-01T10:00:00Z')
  assert.equal(clock.tick(), true)
  assert.equal(clock.writingDay, '2026-09-01')
})

test('THE SEED: an app closed overnight comes back on the right day', () => {
  // The ordinary case, and the one a live timer cannot cover — there is nothing
  // in memory to carry across a process that was not running.
  const clock = new DayClock(
    { day: d('2026-08-31'), writtenAt: new Date(EVENING).getTime() },
    { now: at(MORNING).now },
  )
  assert.equal(clock.writingDay, '2026-09-01', 'they wrote last night and slept')
})

test('and one closed mid-sentence comes back still in yesterday', () => {
  // Quit at 00:25 and reopen at 00:28: the calendar rolled, they never stopped,
  // and the notebook should not have rolled either.
  const time = at('2026-09-01T08:28:00Z')
  const clock = new DayClock(
    { day: d('2026-08-31'), writtenAt: new Date('2026-09-01T08:25:00Z').getTime() },
    { now: time.now },
  )
  assert.equal(clock.writingDay, '2026-08-31')
})

test('a day with nothing written in it is skipped, not stepped through', () => {
  // Away for a week. The boundary is crossed once, to today — there is no
  // sequence of empty days to walk.
  const clock = new DayClock(
    { day: d('2026-08-25'), writtenAt: new Date('2026-08-26T05:00:00Z').getTime() },
    { now: at(MORNING).now },
  )
  assert.equal(clock.writingDay, '2026-09-01')
})

test('the writing day never goes backwards', () => {
  // A corpus can hold a day ahead of this machine's clock — a device whose time
  // is wrong, or one that travelled. Dates are the stream's ordering axis and
  // re-dating is corruption (D9), so a day already written in stands.
  const clock = new DayClock(
    { day: d('2026-09-05'), writtenAt: new Date('2026-09-05T05:00:00Z').getTime() },
    { now: at(MORNING).now },
  )
  assert.equal(clock.writingDay, '2026-09-05')
  assert.equal(clock.tick(), false, 'and the clock catching up does not move it back')
})

test('the zone is the notebook\'s, and a different one is a different day', () => {
  const time = at('2026-09-01T05:00:00Z') // 21:00 in California, 07:00 in Zurich
  const west = new DayClock(null, { now: time.now, zone: 'America/Los_Angeles' })
  const east = new DayClock(null, { now: time.now, zone: 'Europe/Zurich' })
  assert.equal(west.clockDay, '2026-08-31')
  assert.equal(east.clockDay, '2026-09-01', 'the same instant, a day apart')
})

test('MOVING EAST costs one short day', () => {
  const time = at('2026-09-01T05:00:00Z')
  const clock = new DayClock({ day: d('2026-08-31'), writtenAt: new Date('2026-09-01T04:00:00Z').getTime() }, {
    now: time.now,
    zone: 'America/Los_Angeles',
  })
  assert.equal(clock.writingDay, '2026-08-31')
  clock.moveTo('Europe/Zurich')
  assert.equal(clock.clockDay, '2026-09-01', 'the calendar jumps ahead')
  assert.equal(clock.writingDay, '2026-08-31', 'and the notebook follows only once you stop')
  time.set('2026-09-01T06:00:00Z')
  assert.equal(clock.tick(), true)
  assert.equal(clock.writingDay, '2026-09-01')
})

test('MOVING WEST never re-dates: the writing day waits for the calendar', () => {
  // Flying the other way pulls the calendar BACK, and a writing day that went
  // with it would file new passages into a day already holding later content —
  // D9's corruption through the side door. It stays put instead (D63).
  const time = at('2026-09-01T05:00:00Z')
  const clock = new DayClock({ day: d('2026-09-01'), writtenAt: new Date('2026-09-01T04:00:00Z').getTime() }, {
    now: time.now,
    zone: 'Europe/Zurich',
  })
  assert.equal(clock.writingDay, '2026-09-01')

  clock.moveTo('America/Los_Angeles')
  assert.equal(clock.clockDay, '2026-08-31', 'the calendar falls back a day')
  assert.equal(clock.writingDay, '2026-09-01', 'and the notebook does NOT')
  time.set('2026-09-02T00:00:00Z')
  assert.equal(clock.tick(), false, 'still not past it')
  assert.equal(clock.writingDay, '2026-09-01')

  // One long day, and then it moves on normally.
  time.set('2026-09-02T08:00:00Z')
  assert.equal(clock.tick(), true)
  assert.equal(clock.writingDay, '2026-09-02')
})

test('a file claiming to have been written in the future does not hold the day open', () => {
  // Clock skew, or a file synced from a machine that is ahead. Untreated it
  // reads as "somebody is writing right now" for as long as the skew lasts.
  const time = at(MORNING)
  const clock = new DayClock(
    { day: d('2026-08-31'), writtenAt: new Date(MORNING).getTime() + 86_400_000 },
    { now: time.now },
  )
  assert.ok(clock.idleFor() >= 0, 'never negative, however far ahead the file claims to be')
  // It costs one idle period, not forever: the boundary is crossed as soon as
  // that much time has actually passed.
  assert.equal(clock.writingDay, '2026-08-31')
  time.set('2026-09-01T18:00:00Z')
  assert.equal(clock.tick(), true)
  assert.equal(clock.writingDay, '2026-09-01')
})

test('the idle threshold is what decides, and it is configurable for tests', () => {
  const time = at(LATE)
  const clock = new DayClock({ day: d('2026-08-31'), writtenAt: new Date(LATE).getTime() }, {
    now: time.now,
    idleMs: 10 * MINUTE,
  })
  time.set('2026-09-01T08:35:00Z') // five minutes
  assert.equal(clock.tick(), false)
  time.set('2026-09-01T08:45:00Z') // fifteen
  assert.equal(clock.tick(), true)
})

test('writing is recorded at the latest moment it happened', () => {
  const time = at(MORNING)
  const clock = new DayClock(null, { now: time.now })
  clock.wrote(new Date(MORNING).getTime())
  const late = new Date(MORNING).getTime() + MINUTE
  clock.wrote(late)
  clock.wrote(late - 10 * MINUTE) // an older edit arriving late must not rewind it
  assert.ok(clock.idleFor() <= 0)
})
