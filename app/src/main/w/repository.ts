// Durable versioned storage for a notebook.
//
// **A git repository is one implementation of this, not the definition of it.**
// The distinction matters more than it looks: the moment the API says `commit`
// and returns a forty-character string, every layer above starts thinking in
// git, and the choice of git stops being a decision and becomes an assumption.
// D34 already schedules a revisit at v2a — that revisit is only cheap if the
// seam is here.
//
// What Tephra actually needs from storage is small: save the current state,
// list what has been saved, read something out of an earlier state, and move
// the working tree to a state. Everything else in git is machinery.
//
// The vocabulary is the app's: **versions**, not commits; **reasons**, not
// messages; `VersionId`, not `oid`. `RelPath` stays, because paths are the one
// thing W legitimately speaks (`architecture.md`) — X translates them into days
// and documents, and nothing above X ever sees one.

import type { RelPath } from './layout.ts'
import type { VersionId } from '../../shared/document-api.ts'
import type { Version } from '../../shared/history-api.ts'

/**
 * Where to move the working tree.
 *
 * `'latest'` is the magic target and the one that matters most: it is what a
 * second machine asks for the first time it opens a notebook it has just
 * received, before it knows a single version id.
 */
export type VersionTarget = VersionId | 'latest'

export interface Repository {
  /**
   * Save the notebook's current state, and return the version it became.
   *
   * **Null when nothing had changed** — the common answer on a quiet timer, and
   * not an error. A store that recorded a version every time it was asked would
   * fill its own history with nothing.
   */
  save(reason: string): Promise<VersionId | null>

  /** The newest version, or null in a store that has never been saved to. */
  latest(): Promise<VersionId | null>

  /**
   * **The ancestry of one version, newest first — not "all versions".**
   *
   * The set of versions is a TREE, not a list. What is linear is the walk back
   * from a particular point, and once branching exists (below) there will be
   * versions that no walk from `'latest'` ever reaches. Saying "versions newest
   * first" invites exactly the wrong mental model, and the code that assumes it
   * would look correct until the first branch existed.
   *
   * `from` defaults to `'latest'` because that is the common question, not
   * because it is the only one.
   */
  versions(from?: VersionTarget, limit?: number): Promise<readonly Version[]>

  /**
   * The versions that touched one file, newest first — again an ancestry walk,
   * filtered, and again linear only because a walk is.
   */
  versionsTouching(file: RelPath, from?: VersionTarget, limit?: number): Promise<readonly Version[]>

  /**
   * A file's contents at a version. Null if it did not exist then — which is a
   * different answer from an empty file, and callers rely on the difference.
   */
  contentAt(version: VersionId, file: RelPath): Promise<string | null>

  /**
   * Make the working tree match a version.
   *
   * This is a W-layer capability, not the user-facing restore. What it means to
   * *a document* to be restored — which spans move, what happens to the undo
   * stack — is X's business and arrives in M2 (`history-api.ts`).
   */
  moveTo(target: VersionTarget): Promise<void>
}

// ── what will join this interface, and why here ─────────────────────────
//
// Not built, and listed so the shape is anticipated rather than discovered.
// **Branching and merging belong to storage**, not to X, for the same reason
// `save` does: they are operations on the version tree, and the tree is what
// this interface exists to own. A merge implemented above this line would need
// the layer above to know how versions relate to one another, which is exactly
// the knowledge the seam is here to contain.
//
//   branches(): Promise<readonly BranchName[]>
//   branch(name, from?): Promise<void>
//   switchTo(branch): Promise<void>
//   merge(branch): Promise<MergeOutcome>
//
// **The division of labour on merging is already decided and is worth keeping
// straight.** The *deep* part — three-way content reconciliation, producing
// either a merged file or the fact that it cannot be produced — is storage's,
// and for day files it is an append-union that D34 notes is ours to implement
// whichever library is underneath. The *policy* is not: D12 says divergence is
// surfaced and never auto-resolved, and a picker is X's to raise. So `merge`
// reports an outcome; it never decides what the reader meant.
//
// This is v2a work (D32): the repository is local in v1, so v2a adds
// distribution rather than versioning.
