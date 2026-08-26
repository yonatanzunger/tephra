// History as its own X object (D32).
//
// Document owns the VOLATILE half — undo, redo, rewindTo, session-scoped and
// fine-grained. This owns the DURABLE half: commits, and what a day looked like
// at one. Two objects, two coordinates, and D33 keeps them from being confused
// with each other — a SessionGeneration is a number that dies with the process,
// a VersionId is a string that outlives everything.
//
// **Read-only in v1.** `restore` is not implemented and says so rather than
// pretending, on the same rule M0 used for `untag` and `branch`. The v1 answer
// to "put that paragraph back" is the one `history-api.ts` already gives: read
// the old text and paste the part you want, which is what a person does anyway
// and needs no alignment machinery between two versions of a document.
//
// X, not W: this speaks in dates and versions. `Repository` speaks in paths and
// object ids, and **the mapping between them stops here** — nothing above this
// layer learns that a day is a file (`architecture.md`).

import { dayFile, parseDayFile, STREAM_DIR, type RelPath } from '../w/layout.ts'
import { compareDateKeys } from '../../shared/dates.ts'
import type { StreamDocument } from './stream-document.ts'
import type { RestoreReport } from '../../shared/history-api.ts'
import { parseFile } from './frontmatter.ts'
import type { Repository } from '../w/repository.ts'
import type { DateKey, DocumentText, VersionId } from '../../shared/document-api.ts'
import type { Version } from '../../shared/history-api.ts'

/** Enough parts to cover any real day; the split threshold is 1 MB (D20). */
const MAX_PARTS = 64

export class StreamHistory {
  readonly #repo: Repository

  constructor(repo: Repository) {
    this.#repo = repo
  }

  // No translation left to do: the store already speaks versions and reasons.
  // What X adds is the DAY — turning the reader's unit into a path, which is
  // the mapping that stops here and never travels upward.
  async versions(limit = 50): Promise<readonly Version[]> {
    return this.#repo.versions('latest', limit)
  }

  async versionsTouching(date: DateKey, limit = 50): Promise<readonly Version[]> {
    return this.#repo.versionsTouching(dayFile(date), 'latest', limit)
  }

  /**
   * A day as it read at that version — body only, parts joined.
   *
   * Frontmatter is stripped because it is storage metadata, not text anyone
   * wrote; handing it back would make "copy the paragraph out" mean "and then
   * delete the header". Parts are concatenated for the same reason a split is
   * invisible to the API (D20): the reader never agreed to know about them.
   */
  async readDay(version: VersionId, date: DateKey): Promise<string | null> {
    const bodies: string[] = []
    for (let part = 1; part <= MAX_PARTS; part++) {
      const text = await this.#repo.contentAt(version, dayFile(date, part))
      if (text === null) break
      bodies.push(parseFile(text).body)
    }
    return bodies.length === 0 ? null : bodies.join('')
  }

  async status(): Promise<{ readonly dirty: boolean; readonly lastCommit: VersionId | null }> {
    return { dirty: false, lastCommit: await this.#repo.latest() }
  }

  /** Which days existed at a version, in order. */
  async daysAt(version: VersionId): Promise<readonly DateKey[]> {
    const dates = new Set<DateKey>()
    for (const rel of await this.#repo.filesAt(version, STREAM_DIR as RelPath)) {
      const ref = parseDayFile(rel)
      if (ref !== null) dates.add(ref.date)
    }
    return [...dates].sort(compareDateKeys)
  }

  /**
   * Put the stream back the way it was at a version.
   *
   * **Whole documents, not spans.** Restoring part of an old version would need
   * a span addressing text inside a version that was never loaded, so it
   * carries no live `SessionGeneration` and cannot be a `DocumentPosition` at
   * all; making it work means aligning two versions of a document, which is a
   * real feature and a hard one. The v1 answer to "put that paragraph back" is
   * `readDay` and paste — what a person does anyway.
   *
   * **This does not rewrite history.** It computes what the days held then and
   * writes that as the present, so the restore is itself a new version and the
   * one before it is still there. Undoing a restore is another restore, which
   * is the same shape as the purge procedure's promise and for the same reason:
   * the repository is append-only until somebody deliberately rewrites it.
   *
   * **A day that did not exist then is removed**, not emptied. Leaving a file
   * behind with nothing but frontmatter would make "restored to the 14th" mean
   * "restored, plus some blank days", and a reader could not tell which of the
   * two happened.
   *
   * Takes the document rather than a `DocumentId`: resolving an id would need a
   * registry that does not exist, for a v1 that has one document.
   */
  async restore(version: VersionId, doc: StreamDocument): Promise<RestoreReport> {
    const then = await this.daysAt(version)
    const now = await doc.dates()

    const target = new Map<DateKey, DocumentText | null>()
    for (const date of then) target.set(date, ((await this.readDay(version, date)) ?? '') as DocumentText)
    for (const date of now) if (!target.has(date)) target.set(date, null)

    return { ...(await doc.restoreTo(target)), version }
  }
}
