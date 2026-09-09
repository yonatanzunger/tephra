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

import type { Notebook } from '../../w/notebook.ts'
import type { RelPath } from '../../w/layout.ts'
import type { CorpusIndex } from './corpus-index.ts'
import type { DateKey } from '../../../shared/document-api.ts'
import type { Cursor, Ordering, Query, Scope, Search } from '../../../shared/search-api.ts'

/**
 * One stretch of one file that the scope admits, named before anything is read.
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
  _index: CorpusIndex,
  _scope: Scope,
  _order: Ordering,
): Promise<readonly Candidate[]> {
  throw new Error('MS1')
}

export class Scanner implements Search {
  readonly #notebook: Notebook
  readonly #index: CorpusIndex

  constructor(notebook: Notebook, index: CorpusIndex) {
    this.#notebook = notebook
    this.#index = index
  }

  /** Begin a query. Reads nothing; see `Cursor`. */
  open(_query: Query): Cursor {
    void this.#notebook
    void this.#index
    throw new Error('MS1')
  }
}
