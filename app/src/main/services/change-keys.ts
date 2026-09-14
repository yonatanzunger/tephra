// **Foundation. Depends on nothing but the notebook's layout.**
//
// What a change is *called*, so that a fixed-point function's trigger can be
// written against it (D83).
//
// **One place, because a format is a contract.** A format that is documented and
// then assembled by hand wherever a change happens is an invariant kept by
// memory, and note 61 records what that comes to: the comment stays true and the
// code drifts out from under it. Every key in the app is built by one of the
// functions here.
//
// ## The format
//
// `<kind>:<what>` — the kind first, because that is what a trigger almost always
// wants to say, so the common pattern is `'^docket:'` and needs no knowledge of
// how a notebook lays its files out.
//
// | key | means | written by |
// |---|---|---|
// | `docket:dockets/house.docket.md` | a docket was written to | the corpus, on any write |
// | `todo:tasks.todo.md` | the task list was written to | the corpus, on any write |
// | `stream:notebook.stream` | the notebook's prose was written to | the corpus, on any write |
// | `day:2026-09-14` | the writing day moved | the day service, when it rolls |
// | `asked:reconcile` | somebody asked, though nothing moved | startup, and an explicit request |
//
// A finer key is allowed after a `#` — `docket:…#matter-7f3a#start` — and
// nothing produces one yet. It would be for the divergence report's benefit
// rather than for routing: a report naming the field that kept changing is a
// report you can act on, where one naming the document is a place to start
// looking.

import { kindOf } from '../w/layout.ts'
import type { DateKey, DocumentId } from '../../shared/document-api.ts'

/** A document was written to. */
export function documentKey(id: DocumentId): string {
  return `${kindOf(id) ?? 'document'}:${id as string}`
}

/**
 * The writing day moved (D62).
 *
 * **A real key rather than a private callback.** The day service used to
 * announce a roll and have somebody subscribe in order to reconcile; the roll is
 * a change to an input like any other, so it says so the same way — and the
 * divergence report then names the day rather than saying only that somebody
 * asked.
 */
export function dayKey(day: DateKey): string {
  return `day:${day as string}`
}

/**
 * The key for *ask again, though nothing moved*.
 *
 * Startup and an explicit request are two of D77's three triggers and neither is
 * a data change — but giving them a key keeps one path into the machinery
 * instead of two, and it shows up in a report, where a first round reading
 * `asked:` says the run began because somebody asked.
 */
export const ASKED_KEY = 'asked:reconcile'
