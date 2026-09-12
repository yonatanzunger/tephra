// The horizon — everything bearing down, whatever its source (H8, D74, MH2).
//
// **A query, not a document and not stored state.** It is computed on demand
// from the two places dates actually live, which is why it needs no
// reconciliation of its own (D77): there is no derived copy to drift.
//
// **A logical object in its own right, which several things implement.** The
// horizon is not a view of dockets that happens to also read the task list: it
// owns what a row is, what window it spans, and what order rows come in, and a
// **source** is anything that can say *here is something dated*. Today there are
// two — a docket's matters, and the task list's due dates — and H7's deferred ICS
// feed is a third. Each source translates into this vocabulary; none of them
// gets to shape it. That is why the window, the kinds and the ordering live here
// and the interval arithmetic lives with the docket.
//
// **Its sources must be disjoint, and keeping them so is a source's own job.** A
// docket step that has already generated an item belongs to the task list's
// source and not the docket's, so nothing is counted twice — `matterHorizon` is
// where that is enforced, because only the docket knows what it generated.

import type { DateKey, DocumentId } from './document-api.ts'

/**
 * The stretch of days a horizon is asked about.
 *
 * **It runs behind as well as ahead** (H8), because something overdue is as much
 * a thing to have in mind as something coming — and because the way a deadline
 * is missed is by its row disappearing on the morning it mattered.
 */
export interface HorizonWindow {
  readonly from: DateKey
  readonly to: DateKey
}

/**
 * What sort of pressure a row is.
 *
 * **Declared here rather than borrowed from the docket**, even though two of the
 * three names match a step kind. The horizon's vocabulary is its own: a source
 * translates into these, and the day an ICS feed becomes a fourth source (H7)
 * nothing about the docket's step kinds should be what decides how its rows read.
 *
 * `task` — work a matter will ask for. `status` — awareness with no task, the
 * thing H6 exists for, which no TODO item can express. `due` — a task item's own
 * deadline.
 */
export type HorizonKind = 'task' | 'status' | 'due'

/** Whether a day is in the window at all. The one test every source applies. */
export const inHorizon = (day: DateKey, window: HorizonWindow): boolean =>
  day >= window.from && day <= window.to

/**
 * One row: a dated thing, and enough to say where it came from.
 *
 * **Read-only by construction** (D74's full view is read-only, and the compact
 * strip only navigates), so a row carries what it takes to *show* and to *go*,
 * and nothing to edit with.
 */
export interface HorizonRow {
  /** The day it lands on. The only ordering anybody wants. */
  readonly on: DateKey
  /** What it says, as written — markers and all, as the task list keeps them. */
  readonly text: string
  /** Where to go when it is followed: the docket, or the task list. */
  readonly doc: DocumentId
  /**
   * Which pressure this is.
   *
   * `task` — work a matter will ask for. `status` — awareness with no task, which
   * is the thing H6 exists for and which no TODO item can express. `due` — a
   * task item's own deadline, which is the band's existing content.
   */
  readonly kind: HorizonKind
  /** The matter it belongs to, for a docket row. Null for a task item. */
  readonly matter: string | null
  /**
   * The occurrence, for a docket row.
   *
   * **Shown, because two instances of one recurrence can land in one window**
   * and an unlabelled pair is worse than either alone. Null for a task item,
   * which has no instances.
   */
  readonly instance: DateKey | null
  /** The task item, for a task row — so the strip can scroll to it. */
  readonly item: string | null
  /** The matter, for a docket row — so following it can land on the matter. */
  readonly id: string | null
}

/**
 * Rows in the order a day should be read in.
 *
 * **Date first, and then the world before your own commitments.** Within a day,
 * awareness comes before work asked of you and both come before a deadline you
 * set, because reading a day should start with what is happening *to* you — the
 * volition/imposition cut H8 draws, applied to the sort rather than to a second
 * region. A tie breaks on the text so the order is total and a redraw cannot
 * shuffle rows about.
 */
export function orderHorizon(rows: readonly HorizonRow[]): readonly HorizonRow[] {
  const rank = (row: HorizonRow): number =>
    (row.kind === 'status' ? 0 : row.kind === 'task' ? 1 : 2)
  return [...rows].sort((a, b) =>
    (a.on < b.on ? -1 : a.on > b.on ? 1 : 0) || rank(a) - rank(b) || a.text.localeCompare(b.text))
}
