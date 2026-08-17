// How much of the stream is loaded, and in what unit.
//
// NOT DAYS. A day is between ~100 KB and 1 MB — the split threshold — so a
// day-denominated extent means anywhere from 1.4 MB to 14 MB for a fortnight.
// That is not merely imprecise: it walks past the point Spike A measured, which
// is the untested region D36's deferral depends on staying out of. Days measure
// elapsed time; what has to be bounded is resident load.
//
// NOT CHARACTERS EITHER, as the thing a policy is written in. Nobody scrolls
// back "two hundred thousand characters"; they scroll back a bit. So policy is
// expressed in SCREENS, converted to characters at the moment of use, using a
// rate measured continuously from the editor itself.

declare const ScreensBrand: unique symbol

/** A screenful of content — the unit a person actually scrolls in. */
export type Screens = number & { readonly [ScreensBrand]: void }

export const screens = (n: number): Screens => n as Screens

/**
 * A sample below this is a screen dominated by a figure or a table, not a
 * measure of text density; one such screen must not drag the estimate down and
 * strand the reader at a boundary. Above it is denser than any real prose.
 */
const MIN_SAMPLE = 300
const MAX_SAMPLE = 6000

/** Before the editor has reported anything: roughly a screen of prose at 74ch. */
const INITIAL_ESTIMATE = 2200

/** Weight on each new sample. Low enough that one odd screen does not swing it. */
const ALPHA = 0.2

/**
 * Converts screens to characters, calibrated from what the editor reports.
 *
 * `Pane.viewportChanged(visible)` already carries the character extent of one
 * screen — `to - from` is, by definition, how many characters a screenful holds
 * right now. So the rate needs no layout knowledge, no font metrics and no
 * guessing: it is measured, continuously, from a signal the API already sends.
 * It adapts to window size, font size and content density for free.
 */
export class ScreenMetric {
  #charsPerScreen = INITIAL_ESTIMATE
  #samples = 0

  /** Feed one viewport observation, in characters. */
  observe(visibleChars: number): void {
    if (!Number.isFinite(visibleChars) || visibleChars <= 0) return
    const sample = Math.min(MAX_SAMPLE, Math.max(MIN_SAMPLE, visibleChars))
    this.#charsPerScreen =
      this.#samples === 0 ? sample : this.#charsPerScreen * (1 - ALPHA) + sample * ALPHA
    this.#samples++
  }

  get charsPerScreen(): number {
    return this.#charsPerScreen
  }

  get calibrated(): boolean {
    return this.#samples > 0
  }

  toChars(n: Screens): number {
    return Math.round(n * this.#charsPerScreen)
  }
}

/**
 * Q7's four options are settings of this, not four implementations (D35).
 *
 *   option 1 — fixed extent, explicit extend    autoExtendOnApproach: false
 *   option 2 — auto-extending, no eviction      autoExtendOnApproach: true, cap: null
 *   option 4 — continuous within a cap          autoExtendOnApproach: true, cap: set
 *   option 3 — sliding window with eviction     evict: true
 *
 * Three of the four are flags. Only eviction is new code, because it is the one
 * that makes scroll anchoring mandatory, and that code is isolated inside
 * DocumentWindow.
 */
export interface ExtentPolicy {
  /** Load this much on open — small, so opening is instant. */
  readonly initial: Screens
  /** Extend to this in the background while the reader orients. */
  readonly target: Screens
  /** Stop growing here; beyond the cap, jumping is the affordance. */
  readonly cap: Screens | null
  /** Extend when the viewport comes within this of a loaded boundary. */
  readonly extendWhenWithin: Screens
  readonly autoExtendOnApproach: boolean
  /** Drop the far end to hold memory constant. */
  readonly evict: boolean
  /**
   * THE SAFETY BOUND, and the reason this type is not simply a screen count.
   *
   * Whatever the screen arithmetic produces, never hold more than this. Spike A
   * measured flat cost at 1.05 MB and nothing above that has been tested, so
   * this is the edge of measured ground — the thing D36 defers measuring past.
   * A screen-denominated target on sparse content could otherwise ask for far
   * more than was ever tried.
   *
   * Raise it only alongside the measurement D36 defers, not by feel.
   */
  readonly maxChars: number
}

/**
 * v1: fixed extent, explicit extend (Q7 option 1).
 *
 * `autoExtendOnApproach: false` is load-bearing, not conservative housekeeping.
 * D36 defers measuring where the editor degrades, and that deferral is sound
 * only because a window that does not grow on its own never approaches the
 * unmeasured ceiling. The reopening trigger is precise: before this flag is set
 * true, do the measurement.
 */
export const V1_EXTENT_POLICY: ExtentPolicy = {
  initial: screens(2),
  target: screens(8),
  cap: null,
  extendWhenWithin: screens(1),
  autoExtendOnApproach: false,
  evict: false,
  maxChars: 1_000_000,
}

/** How many characters to load for a policy target, honouring the hard bound. */
export function charsFor(policy: ExtentPolicy, want: Screens, metric: ScreenMetric): number {
  return Math.min(policy.maxChars, metric.toChars(want))
}
