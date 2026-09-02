// What day it is, and what day the notebook is on (D62).
//
// **Two dates, because they are two questions.** `clockDay` is what the
// calendar says; `writingDay` is the day the notebook is writing into, and it
// waits for you to stop. A passage typed at 00:30 while you are still going
// belongs to the evening you are still in, and files under it.
//
// **A level, not an edge.** This publishes state rather than firing an event.
// A subsystem asks `openDay < writingDay` whenever it likes and gets the same
// answer every time — nothing to deliver, consume, acknowledge or reset, and a
// window that was closed when the day rolled asks on the way back in and is
// told the same thing. Three windows cannot race, because they are all reading
// rather than reacting.
//
// **The seed comes from the corpus, and that is what makes it right.** The
// ordinary case is the app being closed overnight, so there is nothing in
// memory to carry across the boundary; a live timer only covers the window you
// left open, which is the rare one. Given the newest day that has content and
// when it was last written, the same rule reconstructs the answer after a
// close, a crash, a sleeping laptop or a week away.

import { compareDateKeys, dateKeyAt, DEFAULT_ZONE } from '../../shared/dates.ts'
import type { DateKey } from '../../shared/document-api.ts'

/**
 * How long a person has to have stopped before the day can end.
 *
 * **The question is "have they got up from the desk", not "how long is a
 * pause".** It only has to be right about somebody who has walked away, and it
 * is generous in the direction that costs nothing: waiting too long means the
 * boundary lands later, while acting too early cuts a sentence in half.
 */
export const IDLE_MS = 30 * 60_000

/** The newest day that has content, and when it was last written. */
export interface DaySeed {
  readonly day: DateKey
  /** Epoch ms. A file's mtime is a perfectly good answer. */
  readonly writtenAt: number
}

export interface DayClockOptions {
  readonly idleMs?: number
  readonly now?: () => Date
  /** The notebook's zone (D63). Unset means the fixed UTC−8 D38 chose. */
  readonly zone?: string
}

export class DayClock {
  #writingDay: DateKey
  #lastWriteAt: number
  #zone: string
  readonly #idleMs: number
  readonly #now: () => Date

  /**
   * **The seed is handed in rather than fetched**, so this knows nothing about
   * the corpus and can be driven a day at a time in a test. Finding the newest
   * day is the service's job; deciding what it means is this one's.
   */
  constructor(seed: DaySeed | null, options: DayClockOptions = {}) {
    this.#idleMs = options.idleMs ?? IDLE_MS
    this.#now = options.now ?? (() => new Date())
    this.#zone = options.zone ?? DEFAULT_ZONE
    // **Never later than now.** The seed's timestamp is a file's mtime, and a
    // file can claim to have been written in the future — a machine whose clock
    // is fast, or one whose files arrived from a machine that was. Untreated,
    // that reads as "somebody is writing right now" and holds the day open for
    // as long as the skew lasts. A write time in the future is not evidence
    // about the present.
    this.#lastWriteAt = Math.min(seed?.writtenAt ?? 0, this.#now().getTime())

    const clock = this.clockDay
    if (seed === null) {
      // A notebook with nothing in it is on today, whatever today is.
      this.#writingDay = clock
    } else if (this.#now().getTime() - this.#lastWriteAt >= this.#idleMs) {
      // They have been away. Whichever is later: a corpus can hold a day ahead
      // of this machine's clock, and the writing day never goes backwards.
      this.#writingDay = later(clock, seed.day)
    } else {
      // Still mid-session. The day they are in is the day they were writing in,
      // whatever the calendar has done since.
      this.#writingDay = seed.day
    }
  }

  /** What the calendar says now. What the interface means by "today". */
  get clockDay(): DateKey {
    return dateKeyAt(this.#now(), this.#zone)
  }

  get zone(): string {
    return this.#zone
  }

  /**
   * Somebody said where they are now (D63).
   *
   * **The writing day is left exactly where it was**, which is what keeps a
   * flight west from re-dating going forward: moving east makes `clockDay` jump
   * ahead and the next `tick` follows it, while moving west makes `clockDay`
   * fall behind and nothing happens until the calendar catches up. One short
   * day, or one long one, and never a day that goes backwards (D9).
   */
  moveTo(zone: string): void {
    this.#zone = zone
  }

  /** The day the notebook is writing into. The filing date (D38 as amended). */
  get writingDay(): DateKey {
    return this.#writingDay
  }

  /** Somebody typed. The only input the idle rule needs. */
  wrote(at: number = this.#now().getTime()): void {
    if (at > this.#lastWriteAt) this.#lastWriteAt = at
  }

  /**
   * Advance the writing day if the calendar has moved on and writing has
   * stopped. True when it moved, which is when a boundary has to be crossed.
   *
   * Idempotent: called every thirty seconds by the poll and again on every
   * question anybody asks, it advances once and then answers false.
   */
  tick(): boolean {
    const clock = this.clockDay
    if (compareDateKeys(clock, this.#writingDay) <= 0) return false
    if (this.#now().getTime() - this.#lastWriteAt < this.#idleMs) return false
    this.#writingDay = clock
    return true
  }

  /** For tests and diagnostics: how long since anything was written. */
  idleFor(): number {
    return this.#now().getTime() - this.#lastWriteAt
  }
}

const later = (a: DateKey, b: DateKey): DateKey => (compareDateKeys(a, b) >= 0 ? a : b)
