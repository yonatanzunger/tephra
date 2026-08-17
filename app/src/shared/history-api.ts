// History — the durable half, transcribed from solution/history-architecture.md.
//
// TYPES ONLY. Two objects, two jobs, two coordinates, and they are genuinely
// different things rather than one thing described twice (D32):
//
//   Document.undo / redo / rewindTo(generation)  volatile, session, fine-grained
//   History.restore(version)                     durable, permanent, commit-grained
//
// W supplies the git mechanics; X supplies the concept.

import type { DocumentId, VersionId } from './document-api.ts'

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
  restore(version: VersionId, doc: DocumentId): Promise<void>
  status(): Promise<{ readonly dirty: boolean; readonly lastCommit: VersionId | null }>
}
