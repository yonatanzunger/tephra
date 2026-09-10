// Search by scanning (MS1, D65, D66).
//
// **The v1 implementation of `Search`**, and named for how it works because it
// is not the only way to answer the same question: an index-backed one arrives
// in v2 (D23), implementing the same interface with the same result stream.
//
// **Inside the floor, because it reads files** — the same reason `corpus-index`
// is (D54), and the layering test said so before the first line of it ran: a
// search that asked the Corpus for documents would load a gigabyte to answer a
// question about a few lines, which is the one thing the floor exists to let
// somebody avoid. It stands on two things and needs nothing else: the index,
// which answers a scope without a read, and the notebook, which hands over bytes
// when there is no way around reading them.
//
// **Three steps, and the whole architecture is in them.**
//
// 1. **Narrow.** The scope becomes a list of candidate ranges, from the index,
//    with no file opened. `#wombats` does not filter the results of a corpus
//    scan; it stops the other files from ever being read.
// 2. **Order.** The candidates are put in the order asked for — chronological
//    from an origin, in a direction — before anything is read, which is what
//    lets the first hit come back without the last one being known.
// 3. **Scan.** Each candidate is read in turn and its lines tested against the
//    phrase. The only step that touches a disk, and the only one an index would
//    ever replace.
//
// **What a text index changes later, and it is less than it sounds.** A phrase
// becomes answerable in step 1, so it moves out of the scan and step 3 has
// nothing left to do for it. Regex never moves — regex over raw text is what it
// is — and lands as one more thing step 3 knows how to test.
//
// **Pull, not push.** A cursor reads exactly as far as it must to answer the
// question it was asked. The walk asks for one hit and never scans past where
// somebody stopped walking; a pane asks for a screenful and stops when it is
// full. Cancellation is closing the cursor and backpressure is free — where a
// pushed stream of batches would have had to invent both.

import { documentRoot, type RelPath } from '../../w/layout.ts'
import { parseFile } from '../frontmatter.ts'
import { compareDateKeys } from '../../../shared/dates.ts'
import { plainLine } from '../../../shared/plain.ts'
import { matchesIn, phraseRegex } from '../../../shared/phrase.ts'
import { isEmpty } from '../../../shared/search-api.ts'
import type { Notebook } from '../../w/notebook.ts'
import type { CorpusIndex, IndexedFile } from './corpus-index.ts'
import type { DateKey } from '../../../shared/document-api.ts'
import type { Cursor, Hit, Ordering, Progress, Query, Scope, Search } from '../../../shared/search-api.ts'
import type { Located } from '../../../shared/nav-api.ts'

/**
 * One stretch of one file that the scope admits, named before anything is read.
 *
 * **A candidate *range*, because what it is a candidate of is the point.** It is
 * not a candidate file and not a candidate hit: it is the piece of a file the
 * scope lets a hit come from.
 *
 * **Why it is a range and not a file.** A tag delimits a range (D11), so a scope
 * of `#wombats` admits the tagged spans of a day and not the whole day — and
 * scanning the whole file instead would report hits from outside the tagged text
 * as though they were inside it. A date scope admits whole files, which is the
 * same type with `from` and `to` unset.
 *
 * **Why it carries `when`.** Step 2 orders candidates *before* step 3 reads any
 * of them, and ordering a day file against a note means having one number for
 * both: `whenOf` gives a day file noon on its date and everything else its
 * mtime. Without that, ordering would have to wait for the scan, and the first
 * hit could not come back before the last was known.
 *
 * **And why it is the unit of everything else.** It is what `Progress` counts,
 * and it is where a cursor stops and resumes when somebody pulls one hit at a
 * time.
 *
 * `from`/`to` are into the file's body; null means the whole of it.
 */
export interface Candidate {
  readonly file: RelPath
  readonly date: DateKey | null
  /** `whenOf`: noon on a day file's date, an mtime for anything else. */
  readonly when: number
  readonly from: number | null
  readonly to: number | null
}

/**
 * Steps 1 and 2: the scope's candidate ranges, in the ordering asked for.
 *
 * **Exported because it is the claim worth testing directly.** That narrowing
 * *prevents reads* is provable here by inspecting what comes out, with no
 * filesystem in the picture at all — and so is the ordering, which is otherwise
 * only observable through a scan that could be wrong for its own reasons.
 *
 * **An empty result means the scan is over before it starts**, and is a
 * perfectly ordinary answer: a tag nobody has used yet, a date range with
 * nothing in it.
 */
export async function candidatesFor(
  index: CorpusIndex,
  scope: Scope,
  order: Ordering,
): Promise<readonly Candidate[]> {
  const files = await index.files()
  const out: Candidate[] = []
  for (const file of files) {
    if (!admits(scope, file)) continue
    for (const range of rangesIn(scope, file)) {
      out.push({ file: file.file, date: file.date, when: file.when, ...range })
    }
  }
  const back = order.direction === 'past'
  out.sort((a, b) => (back ? cmp(b, a) : cmp(a, b)))
  if (order.origin === 'now') return out
  // **The origin drops candidates lying wholly the wrong way**, and no more than
  // that: the range the cursor is standing in still holds hits on both sides of
  // it, and telling those apart is a question about lines rather than ranges. The
  // scan finishes the job.
  const from = place(order.origin, files)
  if (from === null) return out
  return out.filter(c => !beyond(c, from, back))
}

/**
 * Is this candidate wholly the wrong side of the origin?
 *
 * **Different files compare by day, the same file by offset**, and the two ends
 * of a range are not interchangeable here: walking back, a range starting before
 * the origin may still hold hits before it, so its *start* is what decides;
 * walking forward, a range ending after the origin may still hold hits after it,
 * so its *end* does. Using one end for both was the first draft, and it dropped
 * the very range the cursor was standing in.
 */
function beyond(c: Candidate, origin: Candidate, back: boolean): boolean {
  const byFile = c.when - origin.when || (c.file < origin.file ? -1 : c.file > origin.file ? 1 : 0)
  if (byFile !== 0) return back ? byFile > 0 : byFile < 0
  return back ? start(c) > start(origin) : end(c) < start(origin)
}

/** Does the scope's document and date range admit this file at all? */
function admits(scope: Scope, file: IndexedFile): boolean {
  if (scope.document !== null && (documentRoot(file.file) ?? file.file) !== scope.document) return false
  if (scope.dates === null) return true
  // **An undated file is not in any date range.** A note has no day, and putting
  // it in every range would make "what did I write in March" mean something else.
  if (file.date === null) return false
  return compareDateKeys(file.date, scope.dates.from) >= 0 &&
    compareDateKeys(file.date, scope.dates.until) < 0
}

/**
 * The ranges of one file the scope's tags admit.
 *
 * **Tags conjoin, so this intersects**: a range must lie inside a span of *every*
 * tag asked for. No tags means the whole file, which is the same answer written
 * as one unbounded range.
 */
function rangesIn(scope: Scope, file: IndexedFile): readonly { from: number | null; to: number | null }[] {
  if (scope.tags.length === 0) return [{ from: null, to: null }]
  let ranges: { from: number; to: number }[] | null = null
  for (const subject of scope.tags) {
    const spans = file.tags.filter(tag => tag.subject === subject)
    if (spans.length === 0) return []
    ranges = ranges === null
      ? spans.map(span => ({ from: span.from, to: span.to }))
      : ranges.flatMap(range => spans
          .map(span => ({ from: Math.max(range.from, span.from), to: Math.min(range.to, span.to) }))
          .filter(overlap => overlap.from < overlap.to))
    if (ranges.length === 0) return []
  }
  return ranges ?? []
}

const start = (c: Candidate): number => c.from ?? 0
const end = (c: Candidate): number => c.to ?? Number.MAX_SAFE_INTEGER

/** Oldest first, and within one file the earliest range first. */
const cmp = (a: Candidate, b: Candidate): number =>
  a.when - b.when || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || start(a) - start(b)

/**
 * The origin as something a candidate can be compared to.
 *
 * **It has to carry `when`, and the first draft did not** — it compared bare
 * offsets, so a candidate starting at 0 in a *newer* file counted as being before
 * an origin halfway down an older one, and walking backwards returned the future.
 * Position in this corpus is a day first and an offset second, which is the same
 * ordering `cmp` uses and the reason it is reused here rather than restated.
 *
 * Null when the origin's file is not in the index at all: there is then nothing
 * to be on either side of, and the ordering alone has already said everything.
 */
function place(origin: Located, files: readonly IndexedFile[]): Candidate | null {
  const file = files.find(f => f.file === origin.file)
  return file === undefined
    ? null
    : { file: file.file, date: file.date, when: file.when, from: origin.from, to: origin.to }
}

export class Scanner implements Search {
  readonly #notebook: Notebook
  readonly #index: CorpusIndex

  constructor(notebook: Notebook, index: CorpusIndex) {
    this.#notebook = notebook
    this.#index = index
  }

  /** Begin a query. Reads nothing; see `Cursor`. */
  open(query: Query): Cursor {
    return new ScanCursor(this.#notebook, this.#index, query)
  }
}

/**
 * Step 3: the scan.
 *
 * **The candidates are found once, on the first pull, and then walked.** A
 * cursor that re-narrowed on every `next` would re-answer a question whose
 * answer cannot change while it is being read — and would make pulling one hit
 * at a time cost what pulling all of them does.
 */
class ScanCursor implements Cursor {
  readonly #notebook: Notebook
  readonly #index: CorpusIndex
  readonly #query: Query
  readonly #match: RegExp | null
  #candidates: readonly Candidate[] | null = null
  #at = 0
  #closed = false
  /** Hits found in the candidate being read, not yet handed over. */
  #held: Hit[] = []

  constructor(notebook: Notebook, index: CorpusIndex, query: Query) {
    this.#notebook = notebook
    this.#index = index
    this.#query = query
    this.#match = phraseRegex(query.find, query.fold)
  }

  async next(count: number): Promise<readonly Hit[]> {
    if (this.#closed || isEmpty(this.#query)) return []
    if (this.#candidates === null) {
      this.#candidates = await candidatesFor(this.#index, this.#query.scope, this.#query.order)
    }
    const out: Hit[] = []
    while (out.length < count) {
      if (this.#held.length > 0) {
        out.push(this.#held.shift() as Hit)
        continue
      }
      if (this.#closed || this.#at >= this.#candidates.length) break
      const candidate = this.#candidates[this.#at++] as Candidate
      this.#held = await this.#read(candidate)
    }
    return out
  }

  close(): void {
    this.#closed = true
    this.#held = []
  }

  progress(): Progress {
    const total = this.#candidates?.length ?? 0
    return {
      read: this.#at,
      total,
      done: this.#closed || (this.#candidates !== null && this.#at >= total && this.#held.length === 0),
    }
  }

  /** Every hit in one candidate range, already in the query's order. */
  async #read(candidate: Candidate): Promise<Hit[]> {
    const text = await this.#notebook.read(candidate.file)
    // **A file that has gone is not an error.** The index is a cache of the
    // corpus as it stands (D52), and a scan started a moment ago may reach a
    // file somebody has since deleted or renamed.
    if (text === null) return []
    const body = parseFile(text).body
    const from = candidate.from ?? 0
    const to = Math.min(candidate.to ?? body.length, body.length)
    const out: Hit[] = []
    for (const line of linesIn(body, from, to)) {
      if (this.#match === null) {
        // **A scope with no phrase**: the range itself is the answer, so the
        // first line of it is the hit and no part of that line is a match.
        out.push(hit(candidate, body, line, null))
        break
      }
      for (const at of matchesIn(body.slice(line.from, line.to), this.#match)) {
        // **The line is widened to its edges and the MATCH is not**, which is
        // the difference between *inside the tagged text* and *in a line the
        // tag touches*. A tag covering half a line makes the other half not a
        // result — but the half that is a result still gets shown whole, since
        // a hit reads as a line or it reads as nothing.
        const where = line.from + at.from
        if (where < from || where >= to) continue
        out.push(hit(candidate, body, line, at))
      }
    }
    const back = this.#query.order.direction === 'past'
    if (back) out.reverse()
    const origin = this.#query.order.origin
    if (origin === 'now' || origin.file !== candidate.file) return out
    // **Only in the origin's own file**, and this is the half `candidatesFor`
    // deliberately left undone: a range holds hits on both sides of a cursor
    // standing inside it, and which side a hit is on is a fact about the hit.
    return out.filter(h => (back ? h.at.from < origin.from : h.at.from > origin.from))
  }
}

/** The lines of `body` that lie in `[from, to)`, in file order. */
function* linesIn(body: string, from: number, to: number): Generator<{ from: number; to: number }> {
  let at = body.lastIndexOf('\n', from) + 1
  while (at < to) {
    const nl = body.indexOf('\n', at)
    const end = nl === -1 ? body.length : nl
    if (end > from) yield { from: at, to: end }
    if (nl === -1) return
    at = nl + 1
  }
}

function hit(
  candidate: Candidate,
  body: string,
  line: { from: number; to: number },
  at: { from: number; to: number } | null,
): Hit {
  const raw = body.slice(line.from, line.to)
  const plain = plainLine(raw)
  const located: Located = {
    file: candidate.file,
    date: candidate.date,
    from: line.from + (at?.from ?? 0),
    to: line.from + (at?.to ?? 0),
  }
  if (at === null) return { at: { ...located, to: line.to }, line: plain, within: null, when: candidate.when }
  // **The offsets are found twice, in two texts, on purpose.** `at` points into
  // the file, where the markers still are; `within` points into the line as a
  // reader sees it, which is shorter by however much machinery was in it. One
  // number cannot be both.
  const found = plain.indexOf(raw.slice(at.from, at.to))
  return {
    at: located,
    line: plain,
    within: found === -1 ? null : { from: found, to: found + (at.to - at.from) },
    when: candidate.when,
  }
}
