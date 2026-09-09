// The query notation (MS2, D66).
//
// **One text field, parsed** — T16's one-notation rule applied to queries, with
// the notations the corpus already has: `#wombats` is a tag because that is how
// a tag is written everywhere else, and everything left over is what you came to
// type. A form with checkboxes was the alternative and loses to the same
// argument the TODO line already won.
//
// **Two functions that are each other's inverse**, in one file, because they are
// two halves of one grammar and keeping the halves apart is how `links.ts` came
// to disagree with itself (D61).
//
//     parseQuery:  (text, params) → Query
//     formatQuery: Query → (text, params)
//
// **The pair is total in one direction and exact in the other.** `format` then
// `parse` is the identity on queries, and that is the property worth testing.
// `parse` then `format` is only identity up to normalisation — doubled spaces
// collapse, quotes that were not needed come off — because a person may type a
// query many ways and there is one way to write it down.
//
// **Anything the text cannot express is either in `params` or is a problem.**
// There is no third category. `params` holds the decisions of the *asking* — the
// document a command scoped to, the direction to walk, whether case matters —
// and a `Problem` is text that could not become part of the query at all.

import type { Query, QueryParams, Term } from './search-api.ts'

/**
 * Formed and wrong — `2026-13-02`, or a `/regex/` v1 has no engine for.
 *
 * **Said out loud, and searched for anyway.** The text still becomes part of the
 * phrase, so the query runs and finds what it can; the problem is what lets the
 * field say *that is not a date* instead of silently finding nothing. Dropping it
 * would lose characters somebody typed, which is the one thing a search box must
 * never do.
 */
export interface Problem {
  /** Into the query text. */
  readonly from: number
  readonly to: number
  readonly why: string
}

export interface Parsed {
  readonly query: Query
  readonly problems: readonly Problem[]
}

/**
 * Text and params to a query. Pure, total, and never throws.
 *
 * | Written | Means |
 * |---|---|
 * | `foo bar` | that phrase, literally |
 * | `#wombats` | inside text tagged so |
 * | `2026-03` | in that month |
 * | `2026-03-01..2026-03-15` | in that range, both days included |
 * | `"#wombats"` | the text `#wombats`, not a tag |
 *
 * **Everything unquoted that is not a selector is one phrase, in the order
 * typed.** v1 has no `and`, so there is nothing for the words to be conjoined
 * *as*; they are what you are trying to find, taken literally. Quoting exists to
 * escape a selector back into text, which is a smaller job than it had when
 * `foo bar` was a conjunction — and the same syntax will mean the same thing when
 * `and` arrives, at which point it also starts distinguishing the phrase from
 * the conjunction.
 *
 * **Tags and dates conjoin onto `params.scope`** rather than replacing it, so
 * *find in this document* stays scoped to it however the field is edited.
 *
 * **The date notation is inclusive and `Scope.dates` is half-open**; converting
 * one to the other happens here and nowhere else.
 *
 * **A partial token is not a problem.** `#wo` on the way to `#wombats` is a tag
 * nothing carries, which is a query with no results — the ordinary state of a
 * field somebody is still typing in, and not worth a diagnostic.
 */
export function parseQuery(_text: string, _params: QueryParams): Parsed {
  throw new Error('MS2')
}

/**
 * A query back to the text and params that would produce it.
 *
 * **The inverse, and it has to return both halves**, because a query holds
 * things the notation cannot spell: the document comes from a command and the
 * ordering from a keystroke. Returning only a string would make this a lossy
 * inverse that looked like a total one.
 *
 * **Round-tripping is what keeps term order honest.** A formatter that sorted or
 * merged terms would silently normalise away the order a phrase is made of, so
 * this is where that rule is testable rather than merely written down.
 */
export function formatQuery(_query: Query): { text: string; params: QueryParams } {
  throw new Error('MS2')
}

/** The date spellings, exported because the tests want them by name. */
export const MONTH = /^(\d{4})-(\d{2})$/
export const RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/
export const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Splitting text into a phrase's terms. One place, so both halves agree. */
export const termsOf = (text: string): readonly Term[] =>
  text.split(/\s+/).filter(word => word.length > 0).map(word => ({ text: word }))
