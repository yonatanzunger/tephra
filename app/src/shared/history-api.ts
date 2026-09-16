// History — the durable half, transcribed from solution/parts/history-architecture.md.
//
// TYPES ONLY. Two objects, two jobs, two coordinates, and they are genuinely
// different things rather than one thing described twice (D32):
//
//   Document.undo / redo / rewindTo(generation)  volatile, session, fine-grained
//   History.restore(version)                     durable, permanent, commit-grained
//
// W supplies the git mechanics; X supplies the concept.

import type { DateKey, DocumentId, VersionId } from './document-api.ts'

export interface Version {
  readonly id: VersionId
  readonly at: Date
  readonly reason: string | null
}

export interface History {
  commit(reason?: string): Promise<VersionId>
  versions(range?: { since?: Date; until?: Date }): Promise<readonly Version[]>
  /** The document's text as it was at that version. */
  read(version: VersionId, doc: DocumentId): Promise<string>

  // ── the stream needs a smaller unit than "the document" ──────
  //
  // Added when this met the implementation. For a single-file document — a
  // note, a pinned list, a fileset — `read(version, doc)` is exactly right. For
  // the STREAM it is not: the stream is one document by design (D8), so
  // "the document at a version" is twenty years of text, which is not something
  // anyone wants handed to them.
  //
  // A day is the unit a reader actually addresses, and it is the unit the
  // storage layer already splits on. This is not a second addressing scheme —
  // a DateKey is the stream's own ordering axis (D9), the same one navigation
  // and positions use.

  /**
   * A day's text as it was at that version, with frontmatter stripped: what the
   * reader saw, not what the file held. Null if the day did not exist then.
   *
   * Parts are concatenated (D20), so a day that has since been split reads back
   * as the single day it always appeared to be.
   */
  readDay(version: VersionId, date: DateKey): Promise<string | null>

  /** The versions that touched one day, newest first. */
  versionsTouching(date: DateKey, limit?: number): Promise<readonly Version[]>
  /**
   * WHOLE DOCUMENTS ONLY. Restoring part of an old version would need a span
   * addressing text inside a version that was never loaded, so it carries no
   * live SessionGeneration and cannot be a DocumentPosition at all. Making it
   * work would mean aligning two versions of a document — a real feature and a
   * hard one. The v1 answer is `read` the old text and paste the part you want,
   * which is what a person does anyway and needs no alignment machinery.
   *
   * A restore TRUNCATES THE UNDO STACK, on the same rule as a divergence
   * resolution: mapping an undo through a large external change is not well
   * defined, and a wrong answer there is silent corruption. The recovery path
   * if a restore was wrong is another restore, not ⌘Z.
   */
  restore(version: VersionId, doc: DocumentId): Promise<RestoreReport>
  status(): Promise<{ readonly dirty: boolean; readonly lastCommit: VersionId | null }>
}

/** What a restore did, so the reader is told rather than left to notice. */
export interface RestoreReport {
  readonly version: VersionId
  /** Days whose text was put back. */
  readonly restored: number
  /** Days that did not exist at that version and were removed. */
  readonly removed: number
}
