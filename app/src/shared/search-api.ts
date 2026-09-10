// What a search asks for, and what it gets back (MS1, MS2, D65, D66).
//
// **Type-only, and shared, because the engine lives in main and the field and
// the pane live in the renderer**: these are the words they have in common. The
// notation is `query-text.ts`, the engine is `main/x/documents/search.ts`, and
// neither of them appears here.
//
// **A query has two parts that are not alike, and keeping them apart is the
// whole design.** `scope` says *where to look* and is answerable from the corpus
// index without reading a byte of prose. `find` says *what to look for* and can
// only be answered by reading text. The engine narrows by the first and scans
// what survives with the second — which is what makes "foo in #wombats" open
// only wombats files rather than twenty years of them.
//
// **Scope is a struct and not a node in the tree**, and that is a deliberate
// limit rather than an oversight. In principle a tag is just another predicate
// and could sit in the tree with everything else; in practice that buys `#a or
// #b` at the price of a query planner, because a narrowing term under an `or`
// narrows nothing and the engine would have to work out when it may still narrow
// at all. This is a notebook, not a database. Scope conjoins, always.

import type { DateKey, DocumentId } from './document-api.ts'
import type { Located } from './nav-api.ts'

/** Where a hit is. Re-exported because a `Hit` carries one and callers need it. */
export type { Located }

// ── what to look for ───────────────────────────────────────

/**
 * Where to look. Every field conjoins, and an unset field does not constrain.
 *
 * **Answerable from the index**, which is the property that defines membership:
 * a thing belongs here when it can be decided without opening a file. That is
 * why this grows — a kind, a fileset, an author if there is ever more than one —
 * and why the phrase never joins it, at least until there is a text index.
 *
 * **Narrowing yields RANGES, not files, and a whole file is the coarsest one.**
 * A tag delimits a range (D11), so *"foo in #wombats"* means foo **inside**
 * wombats-tagged text — not foo anywhere in a file that happens to mention
 * wombats, which is a worse answer to the same question. `dates` narrows to whole
 * day files, `tags` to spans within them, and a future text index would narrow to
 * lines: one mechanism, three granularities.
 */
export interface Scope {
  /** One document, or the whole corpus. D66: never a window. */
  readonly document: DocumentId | null
  /**
   * Tagged with all of these. Empty does not constrain.
   *
   * **Normalised by `subjectKey`, not as typed** — subjects compare
   * case-insensitively and whitespace-normalised (format-spec), so `#House Deal`
   * and `#house deal` are one scope and not two. Deliberately a plain string
   * rather than a `SegmentKey`: a segment key is a *segment address* within a
   * document — a `DateKey`, or `content` — and a subject is not one.
   */
  readonly tags: readonly string[]
  /**
   * **Half-open: `from` inclusive, `until` exclusive.** Ranges compose — union,
   * intersection, adjacency — only when one end is open, and a whole month is
   * then `2026-03-01` to `2026-04-01` with no month-length arithmetic anywhere.
   *
   * *The notation is inclusive and this is not*, which is the ordinary division:
   * `2026-03-01..2026-03-15` reads as "through the fifteenth" to a person, and
   * `parseQuery` is where that becomes the sixteenth. One day is `until =
   * addDays(from, 1)`.
   */
  readonly dates: { readonly from: DateKey; readonly until: DateKey } | null
}

export const EVERYWHERE: Scope = { document: null, tags: [], dates: null }

export const scopeIsEmpty = (scope: Scope): boolean =>
  scope.document === null && scope.tags.length === 0 && scope.dates === null

/** A leaf: one run of text to find. */
export interface Term {
  readonly text: string
}

/**
 * What to look for: a node of the query tree.
 *
 * **A union of one, on purpose.** v1 has only `phrase`; `and`, `or`, `not` and
 * `regex` join later as further arms, which is an addition rather than a
 * restructure. Writing the union now and the notation later is the cheap order.
 *
 * **`phrase` and a future `and` are structurally alike and interpreted
 * differently, and that distinction gets more important rather than less as
 * search gets cleverer.** An `and` is a request that these words be present, and
 * an engine may be as approximate about it as it likes — stemming, fuzzy
 * matching, synonyms, any order. A `phrase` is a request to **take this
 * literally**: these terms, in this order, adjacent. The two look the same inside
 * the struct and mean opposite things about how much licence the engine has, so
 * they are different node kinds rather than one node with a flag.
 *
 * **Which is why v1 is phrase-only and not and-only.** A scan is exact, so the
 * one node whose meaning a scan can honour completely is the literal one — and
 * *"I know I wrote that down"* is a phrase you half-remember, not a bag of words.
 */
export type QueryNode = {
  readonly op: 'phrase'
  /**
   * The terms, in order. **Never sorted, never deduped.**
   *
   * Order is the whole meaning of a phrase, and it stays meaningful in a future
   * `and` for a different reason: term order and adjacency are most of what
   * proximity scoring is made of. `goal/scope.md`'s backfill rule applied to a
   * data structure — a mechanism may be deferred, discarded information cannot
   * be recovered.
   */
  readonly of: readonly Term[]
}

export const NOTHING: QueryNode = { op: 'phrase', of: [] }

/**
 * What comes out first.
 *
 * **Chronological is the only one v1 has, and it is a parameter rather than an
 * assumption** — the traversal takes its direction from here instead of being
 * written to walk backwards, so `ranked` is an addition and not a surgery.
 *
 * *Ranked arrives with the index* (D65 as amended, D23). Chronological order
 * streams because the candidate set is enumerable in that order and the first
 * hit costs what the last one does. Ranking has to see every candidate before it
 * knows which comes first, so **a scan cannot rank-stream at all**; what makes
 * ranked streaming possible is an index traversable in impact order.
 */
export type Ordering = {
  readonly kind: 'chronological'
  /**
   * Where to start. `'now'` means the newest thing in the corpus.
   *
   * A `Located` origin is what makes *"the previous mention, from where my cursor
   * is standing"* the same query as *"the most recent mention"* — one differs
   * from the other only here.
   */
  readonly origin: Located | 'now'
  readonly direction: 'past' | 'future'
}

export interface Query {
  readonly scope: Scope
  readonly find: QueryNode
  readonly order: Ordering
  /**
   * Case-folding, and it belongs to the query rather than to a node.
   *
   * **Nobody wants one word of a search folded and another not.** It is a
   * property of the asking, like the ordering is, which is also why it is
   * resolved from `QueryParams` rather than written in the text.
   */
  readonly fold: boolean
}

/**
 * Everything about a query that its text cannot say.
 *
 * **The other half of the notation's input**, and the reason `parseQuery` takes
 * two arguments: which document a command scoped itself to, which way to walk,
 * and whether case matters are all decisions of the *asking* rather than of the
 * asked. A field's contents plus these is exactly a `Query`, which is the
 * property `formatQuery` inverts.
 */
export interface QueryParams {
  /** What the command scoped to. Tags and dates in the text conjoin onto it. */
  readonly scope: Scope
  readonly order: Ordering
  /**
   * `auto` is the convention every search box has and nobody has to be taught:
   * a query typed in lower case folds, one with a capital in it does not. The
   * other two are a person overriding it, which is a control on the field.
   */
  readonly fold: 'auto' | 'sensitive' | 'insensitive'
}

/**
 * A query with nothing in it matches nothing, rather than everything.
 *
 * **An empty search box is not a request for the whole corpus**, which is worth
 * being explicit about because the engine would otherwise dutifully begin
 * streaming twenty years the moment somebody focused the field.
 *
 * **A scope on its own is not empty.** `#wombats` alone is the subject view: its
 * candidate ranges are the results, with nothing to filter them by. That is D9's
 * unification arriving as a consequence rather than as a feature.
 */
export const isEmpty = (query: Query): boolean =>
  query.find.of.length === 0 && scopeIsEmpty(query.scope)

// ── what comes back ────────────────────────────────────────

/**
 * One result.
 *
 * **A line is the UNIT, and a match is the hit.** *Where* the terms have to
 * appear together needs an answer once there can be more than one of them: the
 * file is far too coarse at twenty pages a day, and the line is what a markdown
 * paragraph already is. But a line with two matches in it is two hits — the walk
 * steps through both — so a caller drawing a list groups them by `lineFrom`.
 *
 * **And it is a wrapper rather than a bare `Located` on purpose.** The pane wants
 * surrounding text regardless, and ranking will want a score; wrapping from the
 * start makes both additive, where streaming raw locations would make the first
 * of them a change to every signature that touches a result.
 */
export interface Hit {
  /** The match itself — what a jump lands on and what gets highlighted. */
  readonly at: Located
  /** The whole line, plain: markers and bullets stripped, links left alone. */
  readonly line: string
  /**
   * Where that line starts, into the file's body.
   *
   * **Because a hit is one MATCH and a row is one line**, and those are
   * different counts: a paragraph mentioning the surveyor twice is two hits, and
   * the walk should step through both — but a results pane that draws the
   * sentence twice is showing noise. This is what lets a reader group them
   * without guessing from the text, which two identical lines in one file would
   * defeat.
   */
  readonly lineFrom: number
  /**
   * Where the match sits inside `line`. Truncating the lead is the pane's job.
   *
   * **Null when there is nothing to point at** — a query with a scope and no
   * terms has candidate ranges as its results, so the hit is the range's first
   * line and no part of it is the match.
   */
  readonly within: { readonly from: number; readonly to: number } | null
  /** For display and for ordering across dated and undated files (`whenOf`). */
  readonly when: number
}

/** How far a running query has got, for a pane that wants to say so. */
export interface Progress {
  /** Candidate ranges read so far. */
  readonly read: number
  /** Candidates after narrowing — the denominator, known before any read. */
  readonly total: number
  readonly done: boolean
}

/** A running query, across the process boundary. Branded: closing the wrong one is silent. */
export type QueryId = string & { readonly __query: unique symbol }

/**
 * A running query, read from by pulling.
 *
 * **Nothing is read until the first `next`.** Opening a cursor costs one pass
 * over the index, which is memory-resident, so a query abandoned before anybody
 * looks at it costs no I/O at all — which matters, because a field somebody is
 * typing in opens one per keystroke.
 */
export interface Cursor {
  /**
   * The next hits, in the query's ordering. Fewer than asked for means
   * exhausted; empty means exhausted with none left.
   *
   * **Reads only as far as it must**, and resumes where it stopped. Two calls
   * for one hit each read exactly what one call for two would have.
   */
  next(count: number): Promise<readonly Hit[]>
  /** Stop. Idempotent, and safe to call while a `next` is outstanding. */
  close(): void
  progress(): Progress
}

/**
 * Whatever can answer a query.
 *
 * **One method, because there is one operation.** Everything that differs
 * between *find in this document* and *search Tephra* is in the `Query` — a
 * scope and an ordering (D66) — so there is nothing here for a second entry
 * point to do. **And an interface rather than a class** because there will be a
 * second implementation: the scan is v1's, and an index-backed one arrives in v2
 * answering the same shape (D23).
 */
export interface Search {
  open(query: Query): Cursor
}
