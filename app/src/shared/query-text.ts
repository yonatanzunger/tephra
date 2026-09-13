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

import { addDays, asDateKey, compareDateKeys } from './dates.ts'
import { readTag, subjectKey, tagMark } from './tags.ts'
import type { DateKey } from './document-api.ts'
import type { Query, QueryParams, Scope, Term } from './search-api.ts'

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
export function parseQuery(text: string, params: QueryParams): Parsed {
  const problems: Problem[] = []
  const tags = [...params.scope.tags]
  const terms: Term[] = []
  let dates: Dates | null = params.scope.dates

  for (const token of tokenize(text)) {
    if (token.kind === 'tag') {
      const key = subjectKey(token.name)
      if (key.length > 0 && !tags.includes(key)) tags.push(key)
      continue
    }
    if (!token.literal) {
      const found = datesOf(token.text)
      if (found === 'bad') {
        problems.push({ from: token.from, to: token.to, why: 'not a date' })
      } else if (found !== null) {
        dates = meet(dates, found)
        continue
      } else if (REGEX.test(token.text)) {
        problems.push({ from: token.from, to: token.to, why: 'regular expressions are not supported yet' })
      }
    }
    terms.push({ text: token.text })
  }

  const scope: Scope = { document: params.scope.document, tags, dates }
  return {
    query: { scope, find: { op: 'phrase', of: terms }, order: params.order, fold: folds(terms, params.fold) },
    problems,
  }
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
export function formatQuery(query: Query): { text: string; params: QueryParams } {
  const parts = [
    ...query.find.of.map(term => (needsQuote(term.text) ? quote(term.text) : term.text)),
    ...query.scope.tags.map(spellTag),
    ...(query.scope.dates === null ? [] : [spellDates(query.scope.dates)]),
  ]
  return {
    text: parts.join(' '),
    params: {
      // **What the text now carries comes out of the params**, which is what
      // makes the pair an inverse rather than a doubling: parsing this text with
      // these params adds the tags and dates exactly once.
      scope: { document: query.scope.document, tags: [], dates: null },
      order: query.order,
      // Never `auto`. Auto is a rule for reading what a person typed, and this is
      // not what a person typed: the resolved answer round-trips, the rule may
      // not.
      fold: query.fold ? 'insensitive' : 'sensitive',
    },
  }
}

/** The date spellings, exported because the tests want them by name. */
export const MONTH = /^(\d{4})-(\d{2})$/
export const RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/
export const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Splitting text into a phrase's terms. One place, so both halves agree. */
export const termsOf = (text: string): readonly Term[] =>
  text.split(/\s+/).filter(word => word.length > 0).map(word => ({ text: word }))


// ── the grammar's working parts ────────────────────────────

type Dates = { readonly from: DateKey; readonly until: DateKey }

/**
 * One piece of the text, as the tokenizer found it.
 *
 * **Left to right in one pass**, rather than splitting on whitespace and
 * classifying afterwards: `#'house deal'` has a space in it and so does a quoted
 * phrase, so whitespace is not a boundary until you know what you are inside of.
 */
type Token =
  | { kind: 'tag'; name: string; from: number; to: number }
  | { kind: 'word'; text: string; from: number; to: number; literal: boolean }

const QUOTED = /^"((?:[^"\\]|\\.)*)"/
const TAG_AT = tagMark('y')
const REGEX = /^\/.+\/[a-z]*$/

function tokenize(text: string): readonly Token[] {
  const out: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '"') {
      const q = QUOTED.exec(text.slice(i))
      // **A quoted run is literal**: what is inside it is words, never a
      // selector. That is the whole job quoting has left now that everything
      // unquoted is already a phrase.
      const inner = q === null ? text.slice(i + 1) : (q[1] as string).replace(/\\(.)/g, '$1')
      const to = q === null ? text.length : i + q[0].length
      for (const word of inner.split(/\s+/).filter(w => w.length > 0)) {
        out.push({ kind: 'word', text: word, from: i, to, literal: true })
      }
      // **An unclosed quote is not a problem.** It is a field halfway through
      // being typed in, and what has been typed so far is what to search for.
      if (q === null) break
      i = to
      continue
    }
    if (ch === '#') {
      TAG_AT.lastIndex = i
      const t = TAG_AT.exec(text)
      if (t !== null) {
        out.push({ kind: 'tag', name: readTag(t).trim(), from: i, to: i + t[0].length })
        i += t[0].length
        continue
      }
    }
    let j = i
    while (j < text.length && !/\s/.test(text[j] as string)) j += 1
    out.push({ kind: 'word', text: text.slice(i, j), from: i, to: j, literal: false })
    i = j
  }
  return out
}

/**
 * A month, a day, or a span of days.
 *
 * **Inclusive as written and half-open as returned**, which is the one place
 * that conversion happens. `'bad'` is date-shaped and impossible — reported, and
 * then searched for as ordinary words.
 */
function datesOf(word: string): Dates | 'bad' | null {
  const month = MONTH.exec(word)
  if (month !== null) {
    const from = asDateKey(`${month[1]}-${month[2]}-01`)
    const until = asDateKey(monthAfter(month[1] as string, month[2] as string))
    return from === null || until === null ? 'bad' : { from, until }
  }
  const range = RANGE.exec(word)
  if (range !== null) {
    const from = asDateKey(range[1] as string)
    const last = asDateKey(range[2] as string)
    if (from === null || last === null || compareDateKeys(from, last) > 0) return 'bad'
    return { from, until: addDays(last, 1) }
  }
  if (DAY.test(word)) {
    const day = asDateKey(word)
    return day === null ? 'bad' : { from: day, until: addDays(day, 1) }
  }
  return null
}

const monthAfter = (year: string, month: string): string => {
  const n = Number(month)
  return n === 12 ? `${Number(year) + 1}-01-01` : `${year}-${String(n + 1).padStart(2, '0')}-01`
}

/**
 * Two ranges in one query mean both of them.
 *
 * **Intersection, because scope conjoins** — and half-open ranges intersect by
 * taking the later start and the earlier end, which is the arithmetic that
 * inclusive ends would have made fiddly and off-by-one-prone. An empty result is
 * `from === until`, a perfectly good half-open range admitting nothing, so there
 * is no special case anywhere downstream.
 */
const meet = (a: Dates | null, b: Dates): Dates => {
  if (a === null) return b
  const from = compareDateKeys(a.from, b.from) >= 0 ? a.from : b.from
  const until = compareDateKeys(a.until, b.until) <= 0 ? a.until : b.until
  return compareDateKeys(from, until) >= 0 ? { from, until: from } : { from, until }
}

/**
 * **The convention every search box has**: a query typed in lower case folds, one
 * with a capital in it does not. Read from the phrase alone — tags compare
 * case-insensitively however they are written, and a date has no case to read.
 */
const folds = (terms: readonly Term[], how: QueryParams['fold']): boolean =>
  how === 'auto' ? !terms.some(term => term.text !== term.text.toLowerCase()) : how === 'insensitive'

/** Would this word be read back as something other than itself? */
const needsQuote = (word: string): boolean =>
  word.startsWith('#') || datesOf(word) !== null || REGEX.test(word) || /["\s]/.test(word)

const quote = (word: string): string => `"${word.replace(/(["\\])/g, '\\$1')}"`

/** A tag back into whichever of the two spellings fits it. */
const spellTag = (tag: string): string => (/^[A-Za-z0-9][\w-]*$/.test(tag) ? `#${tag}` : `#'${tag}'`)

/** A half-open range back into the inclusive notation that produced it. */
function spellDates(dates: Dates): string {
  if (compareDateKeys(dates.from, dates.until) >= 0) {
    // **An empty range has no spelling of its own**, because the notation cannot
    // write a range that admits nothing — so this writes what *produced* one:
    // two days that do not overlap, which intersect back to exactly this range.
    // A backwards `a..b` would have been shorter and does not parse.
    return `${dates.from} ${addDays(dates.from, -1)}`
  }
  const last = addDays(dates.until, -1)
  if (dates.from === last) return dates.from
  const [year, month, day] = dates.from.split('-') as [string, string, string]
  if (day === '01' && monthAfter(year, month) === (dates.until as string)) return `${year}-${month}`
  return `${dates.from}..${last}`
}
