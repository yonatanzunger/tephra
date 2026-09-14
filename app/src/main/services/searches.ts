// Running searches, and who they belong to (MS3, D65, D66).
//
// **A cursor is a live object and the wire carries none**, so this is the table
// between them: the renderer holds an id, main holds the cursor, and the id is
// meaningless anywhere else.
//
// **Every cursor belongs to a window, and dies with it.** A search is a thing
// somebody is looking at; a window closing is that person stopping looking. The
// alternative — cursors that outlive their window and are closed politely by a
// renderer that no longer exists — is a leak that only shows up after a long
// session, which is the worst kind.
//
// **And it resolves the origin**, which is the one translation on this path. A
// query's origin is a `Located`: a file, and an offset into its body. The
// renderer says where the caret is in the words it speaks — a segment and an
// offset — because which file a day lives in is the floor's business and not
// something the surface should have to know (D54).

import { dayFile, STREAM_DIR } from '../w/layout.ts'
import { parseQuery } from '../../shared/query-text.ts'
import { EVERYWHERE } from '../../shared/search-api.ts'
import type { DateKey, DocumentId, SegmentKey } from '../../shared/document-api.ts'
import type { SearchBatch, SearchOpened, SearchRequest } from '../../shared/ipc.ts'
import type { Cursor, Located, QueryId, Search } from '../../shared/search-api.ts'

/** One owner's cursors. A window id, in practice. */
type Owner = number

export class Searches {
  readonly #search: Search
  readonly #open = new Map<QueryId, { cursor: Cursor; owner: Owner }>()
  #next = 0

  constructor(search: Search) {
    this.#search = search
  }

  open(owner: Owner, request: SearchRequest): SearchOpened {
    const { query, problems } = parseQuery(request.text, {
      scope: { ...EVERYWHERE, document: request.document },
      order: { kind: 'chronological', origin: originOf(request), direction: request.direction },
      fold: request.fold,
    })
    const id = `q${(this.#next += 1)}` as QueryId
    this.#open.set(id, { cursor: this.#search.open(query), owner })
    return { id, problems }
  }

  async next(id: QueryId, count: number): Promise<SearchBatch> {
    const held = this.#open.get(id)
    // **An unknown id is exhausted, not an error.** The renderer's cursor and
    // this table go out of step for perfectly ordinary reasons — a window closed
    // while a pull was in flight — and a rejected promise there would be an
    // error dialog about nothing.
    if (held === undefined) return { hits: [], progress: { read: 0, total: 0, done: true } }
    const hits = await held.cursor.next(count)
    return { hits, progress: held.cursor.progress() }
  }

  close(id: QueryId): void {
    this.#open.get(id)?.cursor.close()
    this.#open.delete(id)
  }

  /** A window went away, and everything it was looking at went with it. */
  closeFor(owner: Owner): void {
    for (const [id, held] of [...this.#open]) {
      if (held.owner === owner) {
        held.cursor.close()
        this.#open.delete(id)
      }
    }
  }

  /** For tests and diagnostics: how many are still running. */
  get running(): number {
    return this.#open.size
  }
}

function originOf(request: SearchRequest): Located | 'now' {
  if (request.origin === null) return 'now'
  const file = fileOf(request.document, request.origin.segment)
  if (file === null) return 'now'
  return { file, date: dateOf(request.origin.segment), from: request.origin.offset, to: request.origin.offset }
}

/**
 * Which file a position is in.
 *
 * **A day is a file named by its date; everything else is its own path**, which
 * is the same rule `documentRoot` reads in the other direction. A day file that
 * has been split carries later parts, and the first part is the one the index
 * knows — so the offset is into the day, which is what a `Located` means for
 * the stream everywhere else.
 */
function fileOf(document: DocumentId | null, segment: SegmentKey): string | null {
  const date = dateOf(segment)
  if (date !== null) return dayFile(date, 1, (document as string | null) ?? STREAM_DIR)
  return document === null ? null : (document as string)
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const dateOf = (segment: SegmentKey): DateKey | null =>
  DAY.test(segment as string) ? (segment as string as DateKey) : null