// **Foundation. Depends on `CorpusService`, `DurabilityService`, `Bus` and
// `FixedPoints`.**
//
// What day the app is filing into, and the zone it computes dates in (D62, D63).
//
// **One place decides this.** `StreamDocument.today()` reads the system clock
// afresh, which is right for a static helper and wrong for an app that has to
// agree with itself: this service polls, announces, and answers from what it
// announced, so a window opened at 23:59 and the message that arrives at 00:00
// cannot disagree about which day it is now.
//
// **Seeded before it is observable, which it was not.** The day cannot be known
// without I/O — it takes the newest written day, that file's mtime, and the
// notebook's zone — so a synchronous `today` is a lie until the seed lands. The
// old comment claimed *every door into this object awaits `#seeded` first*, and
// six of about a hundred and fifty actually did; `todoAdd`, `todoToday` and
// `todoItems` all read the day without waiting. `ready()` is the honest version,
// and the callers gate on it in one place rather than a hundred and fifty.
//
// **It reports rather than calls.** Crossing a boundary has to rebuild what
// derives from the day, and noticing the machine has moved has to re-offer the
// zone — both of which live far above this service. The roll is **published as a
// `day:` key** to the fixed-point runner, like any other change to an input; the
// zone offer subscribes to `onChecked`. Either way the dependency points down
// while the news travels up (D83).
//
// **No IPC channels**: `today` and the zone verbs are the app service's doors,
// and this is what they call.

import { DayClock } from './x/day-clock.ts'
import { dayFile } from './w/layout.ts'
import { readSettings, writeSettings } from './w/settings.ts'
import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import type { Bus } from './bus.ts'
import type { FixedPoints } from './fixed-point.ts'
import { dayKey } from './change-keys.ts'
import { compareDateKeys, isKnownZone } from '../shared/dates.ts'
import type { DateKey, Unsubscribe } from '../shared/document-api.ts'
import { CHANNEL } from '../shared/ipc.ts'

/** How often to notice midnight. Tests make it small. */
const DAY_CHECK_MS = 30_000

export interface DayOptions {
  /** The clock, so a test can be at any hour it likes without waiting. */
  readonly now?: () => Date
  readonly dayCheckMs?: number
  readonly idleMs?: number
}

export class DayService {
  readonly #corpus: CorpusService
  readonly #durable: DurabilityService
  readonly #bus: Bus

  #clock: DayClock
  readonly #now: () => Date
  readonly #idleMs: number | undefined
  readonly #seeded: Promise<void>
  #dayTimer: ReturnType<typeof setInterval> | null = null

  /** A memo of how far the closing has got; the files are the truth. */
  #closedThrough: DateKey | null = null
  /** The last writing day anybody was told about. */
  #announced: DateKey | null = null

  #onChecked: (() => void)[] = []

  /**
   * Where a day roll is published.
   *
   * **The day is an input to derived state**, so it reports a change like any
   * other writer rather than keeping a private list of subscribers to call. The
   * first cut had `onRolled`, awaited, and one subscriber that reconciled; a key
   * says the same thing, is waited on the same way, and shows up in a divergence
   * report naming the day instead of saying only that somebody asked (D83).
   */
  readonly #fixed: FixedPoints

  constructor(
    corpus: CorpusService,
    durable: DurabilityService,
    bus: Bus,
    fixed: FixedPoints,
    options: DayOptions = {},
  ) {
    this.#corpus = corpus
    this.#durable = durable
    this.#bus = bus
    this.#fixed = fixed
    this.#now = options.now ?? (() => new Date())
    this.#idleMs = options.idleMs

    // Seeded properly once the stream can be asked what the newest day is; a
    // clock with no seed is on today, which is right for a notebook with
    // nothing in it and is corrected by the seed for one that has.
    this.#clock = new DayClock(null, {
      now: this.#now,
      ...(this.#idleMs === undefined ? {} : { idleMs: this.#idleMs }),
    })
    // What the unseeded clock says is the baseline. **If the seed moves the
    // writing day, that IS a boundary** — the app was closed when it happened
    // and this is the moment it is noticed — so it has to be announced like any
    // other, which it will be, because it will differ from this.
    this.#announced = this.#clock.writingDay
    this.#seeded = this.#seed()
    this.#watch(options.dayCheckMs ?? DAY_CHECK_MS)
  }

  /**
   * Resolved once the day is the real one rather than the guess.
   *
   * **Gate writes on this, not reads.** A read that is a day stale corrects
   * itself on the next poll; a write files text under the wrong date and does
   * not. Callers hold one gate — the mutation queue — rather than remembering
   * at a hundred and fifty doors, which is what went wrong before.
   */
  ready(): Promise<void> {
    return this.#seeded
  }

  /**
   * What day the notebook was on when it was last closed.
   *
   * **Read from the corpus, because the ordinary case is an app that was not
   * running** (D62). The newest day with a file, and when that file was last
   * written, is enough to reconstruct the answer — after a close, a crash, a
   * sleeping laptop or a week away, none of which a live timer survives.
   */
  async #seed(): Promise<void> {
    const { zone } = await readSettings(this.#corpus.notebook)
    const stream = await this.#corpus.stream
    const days = await stream.dates()
    const newest = days[days.length - 1]
    const stamp =
      newest === undefined ? null : await this.#corpus.notebook.stamp(dayFile(newest))
    this.#clock = new DayClock(
      newest === undefined ? null : { day: newest, writtenAt: stamp?.mtime ?? 0 },
      { now: this.#now, zone, ...(this.#idleMs === undefined ? {} : { idleMs: this.#idleMs }) },
    )
  }

  // ── what day it is ───────────────────────────────────────────

  /** What day the app is filing into. */
  get today(): DateKey {
    return this.#clock.writingDay
  }

  /**
   * What the calendar says, as against what the notebook is writing into (D62).
   *
   * The interface counts from this — a due date's *in three days*, the
   * sidebar's marker — while the filing date is `today`. They differ exactly
   * while somebody is still writing past midnight, and a band that still says
   * *tomorrow* at 00:30 is telling the truth about the evening they are in.
   */
  get clockDay(): DateKey {
    return this.#clock.clockDay
  }

  /**
   * The moment to stamp a completion with.
   *
   * **The same clock that answers `today`**, which is the point: a stamp taken
   * from the wall while the day came from the service is two sources of truth
   * about the same instant, and they disagree exactly when it matters — under a
   * frozen clock in a test, and for the thirty seconds either side of midnight
   * that D62 exists to keep coherent.
   */
  get moment(): number {
    return Math.floor(this.#now().getTime() / 1000)
  }

  /** Somebody typed; the writing day stays open while they are at it (D62). */
  wrote(): void {
    this.#clock.wrote()
  }

  // ── the zone (D63) ───────────────────────────────────────────

  /** What zone this notebook's dates are computed in. */
  get zone(): string {
    return this.#clock.zone
  }

  /**
   * Say where you are now, and keep it with the notebook.
   *
   * **Chosen, never detected.** The system's zone is offered when it differs
   * and applied only here, because a zone that changes itself is what D38
   * rightly rejected — travel would otherwise re-date the day you are in.
   */
  async setZone(zone: string): Promise<void> {
    if (!isKnownZone(zone)) throw new Error(`this machine does not know the zone ${zone}`)
    await this.#seeded
    await writeSettings(this.#corpus.notebook, { zone })
    this.#clock.moveTo(zone)
    this.#durable.touched()
    // A zone change can put the calendar past the writing day, which is an
    // ordinary boundary and crossed the ordinary way.
    await this.crossTheDay()
    this.#bus.announce(CHANNEL.dayRolled, this.#clock.writingDay)
  }

  // ── the boundary ─────────────────────────────────────────────

  /**
   * Told on every poll, boundary or not.
   *
   * The same poll notices the machine moving: changing the system zone is not
   * an event anything reports, so noticing it means looking — and the thing
   * that already looks at the clock every thirty seconds is this.
   */
  onChecked(told: () => void): Unsubscribe {
    this.#onChecked.push(told)
    return () => {
      this.#onChecked = this.#onChecked.filter(one => one !== told)
    }
  }

  /**
   * Cross a boundary if there is one to cross, and say so.
   *
   * **The infrastructural half happens before the announcement**, which is what
   * keeps three windows from racing to do it and what means no window ever sees
   * a half-crossed boundary (D62). The announcement is still all the renderer
   * gets: where the caret should go is the renderer's, because it is the only
   * side that knows whether somebody is mid-sentence (D35).
   */
  async crossTheDay(): Promise<void> {
    await this.#seeded
    this.#clock.tick()
    const writing = this.#clock.writingDay

    // **Not "did it just advance" — "is every day before this one closed".**
    // The tick is an edge and the invariant is a level, which is the whole
    // shape of D62; asking the edge missed the commonest case of all, an app
    // opened the next morning where the seed had already moved the writing day
    // and no tick was ever going to fire.
    if (this.#closedThrough === null || compareDateKeys(writing, this.#closedThrough) > 0) {
      const stream = await this.#corpus.stream
      const before = (await stream.dates()).filter(day => compareDateKeys(day, writing) < 0)
      const last = before[before.length - 1]
      if (last !== undefined && (await this.#corpus.mutate(() => stream.endDay(last)))) {
        this.#durable.touched()
      }
      // A memo, not the truth: the files are the truth, and this only saves the
      // scan on the ninety-nine polls out of a hundred with nothing to do.
      this.#closedThrough = writing
    }

    // **Announced when it DIFFERS, not when it just moved.** Using the tick's
    // edge lost the announcement whenever the seed landed after a boundary had
    // already passed: the seeded clock was born on the new day, so nothing ever
    // "advanced" and nobody was told. The same level-rather-than-edge mistake
    // this design was written to avoid, made in the one place that was still an
    // event (D62).
    if (writing !== this.#announced) {
      this.#announced = writing
      this.#bus.announce(CHANNEL.dayRolled, writing)
      // **Unattended, at the boundary** (H5): what derives from the day is not
      // contingent on anybody doing a thing, because the whole point is that it
      // happens while nobody is looking.
      //
      // **Awaited**: the boundary is not crossed until what derives from the new
      // day agrees with it, which is the same no-half-crossed-boundary rule the
      // rest of this method is built on. Failures cannot travel out of here — a
      // pass that throws is the runner's business and does not take the roll
      // with it.
      await this.#fixed.changed(dayKey(writing))
    }

    for (const told of this.#onChecked) told()
  }

  #watch(everyMs: number): void {
    this.#dayTimer = setInterval(() => void this.crossTheDay(), everyMs)
    // The clock must never be the reason a process stays alive.
    this.#dayTimer.unref?.()
  }
}
