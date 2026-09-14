// **Foundation. Depends on nothing** — not the corpus, not the notebook, not a
// document. It knows about strings and functions, and that is the whole of it.
//
// Derived state is rebuilt by *fixed-point functions*: each asks what should be
// true and makes it so (D77). One that writes can make more work for itself or
// for another, so running it once is not enough — it has to be run until nothing
// changes. This is the thing that does the running.
//
// **How it knows it has finished, without understanding any of it.** It never
// asks a function *did you change anything?*, because a function that has to
// report its own changes is one somebody will eventually forget to make report.
// Instead it is *told* what changed, by key, from wherever the change was made;
// a function's own writes come back through the same door as anybody else's. So
// the end condition is simply: a round ran and nobody said anything changed.
//
// **Convergence is not guaranteed and cannot be**, because these are arbitrary
// functions. What this can do is notice: keys are recorded per round, and a key
// that keeps coming back round after round is the signature of two functions
// undoing each other's work. Past a threshold the run is abandoned and reported
// rather than spun for ever — and because these functions are idempotent,
// triggering again simply carries on, so an abandoned run costs nothing but the
// report it leaves behind.
//
// **Each function still needs its own convergence proof.** Two shapes qualify:
// *monotone accumulation on a finite set* — only ever adding facts, which
// converges by saturation whatever order it runs in — and *a well-founded
// measure*, where every write strictly advances something that cannot advance
// for ever. A function should say in its own comment which of the two it relies
// on. This file is the warning, not the guarantee.
//
// **Two classes, because there are two jobs.** `FixedPointRunner` runs exactly
// one function and owns everything about it — its queue, its rounds, whether it
// is running. `FixedPoints` holds the table of them and routes changes. A runner
// per function is what keeps two functions' queues, histories and thresholds
// from being merged into one muddle in which neither can be reasoned about.

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * One thing that rebuilds derived state, and when to run it.
 *
 * **This is the API.** Everything else in this file is machinery for running
 * these.
 */
export interface FixedPointFunction {
  /**
   * What to call this one, in the table and in a report.
   *
   * **Identity as well as label**: the table is keyed by it, so two functions
   * may not share a name — and a run abandoned without saying which function
   * would not settle is a run nobody can debug.
   */
  readonly name: string

  /**
   * Which changes should wake it.
   *
   * **The routing, and therefore the isolation.** A key that does not match
   * never reaches this function, so it can be neither woken nor blamed for a
   * change in data it has nothing to do with. Written against the key format
   * writers emit — see `FixedPoints.changed`.
   *
   * **A pattern, or a predicate.** A string is matched as a regular expression,
   * which covers nearly every real case — `'^docket:'` — without anybody
   * writing a closure; a function is there for what a pattern cannot express.
   * A string is compiled on the way in, so there is only ever one thing to call.
   */
  readonly trigger: string | ((key: string) => boolean)

  /**
   * The work: ask what should be true, and make it so.
   *
   * **Its writes are observed, not reported**, which is why it returns nothing.
   * Whatever it changes comes back as a `changed` call from the layer that did
   * the writing, and that is what tells the runner another round is needed.
   *
   * **It must be idempotent**, because it will be run again whenever anything
   * it triggers on moves — including its own writes. And it should say, in its
   * own comment, why it converges: see the note at the head of this file.
   */
  readonly pass: () => Promise<void>
}

/**
 * What one run did.
 *
 * **One report for both endings, because the useful information is the same.**
 * A run that settled and a run that was abandoned differ in one field; the
 * rounds and their keys are what you want to read either way — as a log line
 * when it went well, and as the debugging trail when it did not.
 */
export interface RunReport {
  /** The function that ran. */
  readonly pass: string

  /** How many rounds it took. */
  readonly rounds: number

  /**
   * The key that kept coming back, or null if the run settled.
   *
   * Non-null means the run was **abandoned**: a key came back in more rounds
   * than `ROUND_LIMIT` allows, which is the signature of two functions undoing
   * each other's work. Nothing was rolled back — the writes already made stand,
   * and because these functions are idempotent, triggering again carries on.
   */
  readonly diverged: string | null

  /**
   * One line, ready to log.
   *
   * Formatted here rather than by each caller, because this is where the
   * knowledge of what the numbers mean lives.
   */
  readonly summary: string

  /**
   * Which keys woke this function in each round, oldest round first.
   *
   * **One entry per round, not per write**, and within a round each key appears
   * once however many times it was reported — fifty writes to one field in a
   * single round are one thing changing, as far as convergence goes.
   *
   * So reading *down* the list shows what came back **after** a round had
   * already handled it, which is the signature of two functions undoing each
   * other's work; and reading *across* a round shows what else moved at the same
   * time, which is usually the other half of the pair.
   */
  readonly history: readonly (readonly string[])[]
}

/**
 * How many rounds one key may recur in before a run is abandoned.
 *
 * **Rounds, not reports, and the difference is the whole of it.** A legitimate
 * function can write the same field hundreds of times in one round: a recurring
 * matter whose notebook was shut for a year advances through every interval it
 * missed, each advance a real write to the same date. All of that lands in ONE
 * round, so it counts once. Oscillation is the opposite shape — a key that comes
 * back *after* a round in which it was already handled — and that is what this
 * counts.
 *
 * Generous on purpose, and now with a measurement behind it: an ordinary
 * recurring docket flow — generate, finish, advance, generate again, over four
 * instances — reaches **2** rounds on its busiest key (measured 2026-09-14, in
 * `docket.test.ts`). A pair undoing each other's work reaches 25 in under a
 * second. The gap between the two is what makes the number safe to pick.
 */
const ROUND_LIMIT = 25

/** How a runner takes its turn. See `FixedPointRunner`'s `#gate`. */
type Gate = <T>(work: () => Promise<T>) => Promise<T>

/**
 * Runs one function to a fixed point.
 *
 * **One function, and everything about it**: its queue of unhandled keys, its
 * rounds, whether it is running. All private here, so two functions can never
 * confuse each other's books — which is the reason this is a class per function
 * rather than a table inside a single loop.
 */
class FixedPointRunner {
  readonly #fn: FixedPointFunction
  readonly #matches: (key: string) => boolean

  /** Keys reported and not yet taken into a round. */
  #queued: string[] = []

  /** Resolves when the current run ends; null while quiescent. */
  #running: Promise<void> | null = null

  /** The keys of each round of the current run, oldest first. */
  #history: string[][] = []

  #onRun: ((report: RunReport) => void)[] = []

  #highWater = 0

  /**
   * How to take a turn.
   *
   * **Injected, because exclusivity is shared where state is not.** Two
   * different functions reading and writing the same document race exactly as
   * two copies of one function did — note 51, where both read *this step has
   * made nothing* before either wrote, and both generated — so only one may be
   * *executing* at a time even though each keeps its own books. `FixedPoints`
   * supplies the single turnstile, and is the only thing that builds a runner.
   */
  readonly #gate: Gate

  /**
   * Whether we are inside *any* function's work right now.
   *
   * Shared for the same reason the turnstile is: a write made inside function
   * A's work that wakes function B must not wait either, or it would be waiting
   * for the turn A is holding.
   */
  readonly #inPass: AsyncLocalStorage<true>

  constructor(fn: FixedPointFunction, gate: Gate, inPass: AsyncLocalStorage<true>) {
    this.#fn = fn
    const trigger = fn.trigger
    this.#matches =
      typeof trigger === 'string' ? (key: string): boolean => new RegExp(trigger).test(key) : trigger
    this.#gate = gate
    this.#inPass = inPass
  }

  get name(): string {
    return this.#fn.name
  }

  /** The most rounds any one key has needed here, so we learn what is normal. */
  get highWater(): number {
    return this.#highWater
  }

  /** Whether this key concerns this function at all. */
  matches(key: string): boolean {
    return this.#matches(key)
  }

  onRun(told: (report: RunReport) => void): (() => void) {
    this.#onRun.push(told)
    return () => {
      this.#onRun = this.#onRun.filter(one => one !== told)
    }
  }

  /**
   * Record a key, and make sure a run is going.
   *
   * Answers when this function has settled — or when its run was abandoned,
   * which is also an ending. **Whether the caller should WAIT on that answer is
   * not this object's decision**: it belongs to whoever knows whether we are
   * inside somebody's work, which is `FixedPoints`.
   */
  note(key: string): Promise<void> {
    this.#queued.push(key)
    if (this.#running !== null) return this.#running
    const run = this.#loop().finally(() => {
      this.#running = null
      this.#history = []
    })
    this.#running = run
    return run
  }

  /** Round after round, until a round leaves nothing queued. */
  async #loop(): Promise<void> {
    for (;;) {
      if (this.#queued.length === 0) {
        this.#report(null)
        return
      }
      // Taken before the work runs, so whatever the work itself reports belongs
      // to the NEXT round rather than to this one.
      const keys = this.#queued
      this.#queued = []
      this.#history.push([...new Set(keys)])

      const runaway = this.#runaway()
      if (runaway !== null) {
        // **Abandoned, not cleared.** Anything still queued stays queued, so a
        // later trigger carries on from here — right if the run was merely long,
        // and harmless if it was looping, since it will be abandoned and
        // reported again.
        this.#report(runaway)
        return
      }

      // **A function that throws does not take the run with it**, and is not
      // retried: its keys are spent. The next trigger will ask again, since
      // nothing depends on this run having happened — the rule the day boundary
      // already follows (D62).
      await this.#gate(() => this.#inPass.run(true, async () => this.#fn.pass())).catch(
        () => undefined,
      )
    }
  }

  /** The key that has come back too often, if there is one. */
  #runaway(): string | null {
    const seen = new Map<string, number>()
    for (const round of this.#history) {
      for (const key of round) seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    for (const [key, count] of seen) {
      if (count > this.#highWater) this.#highWater = count
      if (count > ROUND_LIMIT) return key
    }
    return null
  }

  /**
   * Say what the run did, settled or abandoned.
   *
   * **One place builds it**, so the two endings cannot come to describe
   * themselves differently — which they would, being written apart.
   */
  #report(diverged: string | null): void {
    const rounds = this.#history.length
    // A run woken by a key nobody had queued has no rounds and nothing to say.
    if (rounds === 0 && diverged === null) return
    const report: RunReport = {
      pass: this.#fn.name,
      rounds,
      diverged,
      history: this.#history.map(one => [...one]),
      summary:
        diverged === null
          ? `${this.#fn.name}: settled in ${rounds} round${rounds === 1 ? '' : 's'}`
          : `${this.#fn.name}: gave up after ${rounds} rounds — ${diverged} kept changing`,
    }
    for (const told of this.#onRun) told(report)
  }
}

/**
 * The table of fixed-point functions, and the routing of changes to them.
 *
 * **One of these per notebook**, not per process. The keys are
 * notebook-relative, so two notebooks sharing a table would trigger each
 * other's functions — and the integration suites build a fresh service per test
 * in one process, which is exactly that situation.
 */
export class FixedPoints {
  readonly #runners = new Map<string, FixedPointRunner>()
  #onRun: ((report: RunReport) => void)[] = []

  /**
   * One turn at a time, across every function.
   *
   * State is per function and **execution is not**: see a runner's `#gate`. The
   * chain survives a rejection, or one failed turn would wedge every turn after
   * it — the rule the document mutation queue already keeps.
   */
  #turnstile: Promise<unknown> = Promise.resolve()

  /** Shared, so a write inside ANY function's work is known to be re-entrant. */
  readonly #inPass = new AsyncLocalStorage<true>()

  readonly #gate: Gate = work => {
    const next = this.#turnstile.then(work, work)
    this.#turnstile = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** Add a function. Names are unique; registering one twice is a mistake. */
  register(fn: FixedPointFunction): (() => void) {
    if (this.#runners.has(fn.name)) {
      throw new Error(`a fixed-point function called ${fn.name} is already registered`)
    }
    const runner = new FixedPointRunner(fn, this.#gate, this.#inPass)
    runner.onRun(report => {
      for (const told of this.#onRun) told(report)
    })
    this.#runners.set(fn.name, runner)
    return () => {
      this.#runners.delete(fn.name)
    }
  }

  onRun(told: (report: RunReport) => void): (() => void) {
    this.#onRun.push(told)
    return () => {
      this.#onRun = this.#onRun.filter(one => one !== told)
    }
  }

  /** The most rounds any one key has needed anywhere. */
  get highWater(): number {
    let most = 0
    for (const runner of this.#runners.values()) most = Math.max(most, runner.highWater)
    return most
  }

  /**
   * Something changed.
   *
   * **The key names the data, with reasonable specificity**, so triggers can be
   * written against it — `docket:dockets/house.docket.md`, or the finer
   * `docket:dockets/house.docket.md#matter-7f3a#start`. A key no function is
   * waiting for costs nothing at all.
   *
   * From **outside** anybody's work, this resolves once every function the key
   * woke has settled. **A write is not undone by a function that will not
   * converge**, so it resolves rather than rejecting: the write succeeded, and
   * what failed is the rebuilding of what derives from it. Divergence is
   * reported separately.
   *
   * From **inside** somebody's work, it records the key and returns at once.
   * Waiting there would be waiting for the turn the caller is holding — and that
   * is true across functions as well as within one, which is why the async
   * context asking the question is shared.
   */
  async changed(key: string): Promise<void> {
    const woken = [...this.#runners.values()].filter(one => one.matches(key))
    if (woken.length === 0) return
    // Started either way: the work has to happen, whoever asked for it. What
    // differs is only whether this caller waits for it.
    const settling = woken.map(one => one.note(key).catch(() => undefined))
    if (this.#inPass.getStore() === true) {
      for (const one of settling) void one
      return
    }
    await Promise.all(settling)
  }
}
