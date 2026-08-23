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

import { dayFile } from '../w/layout.ts'
import { parseFile } from './frontmatter.ts'
import type { Repository } from '../w/repository.ts'
import type { DateKey, VersionId } from '../../shared/document-api.ts'
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

  /** M2. Throwing beats pretending — the same rule M0 applied to `branch`. */
  async restore(): Promise<never> {
    throw new Error('History.restore arrives in M2; read the version and copy what you need')
  }
}
