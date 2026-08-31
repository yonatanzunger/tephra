// What the sidebar asks about, and what it gets back (D51, D52).
//
// Type-only, and shared, because the index lives in main and the nav lives in
// the renderer: these are the words they have in common. The store, the scan
// and the cache are all on the other side of this file.

import type { DateKey, DocumentId } from './document-api.ts'

/** A file-relative path inside the notebook. Mirrors `w/layout.ts`'s RelPath. */
export type NotebookPath = string

/** Where something is: the file it is in, and offsets within that file's body. */
export interface Located {
  readonly file: NotebookPath
  /** The day, when the file is one. Null for notes and filesets. */
  readonly date: DateKey | null
  readonly from: number
  readonly to: number
}

/**
 * A row's identity, with no position in it (D11, D51).
 *
 * What a pinned entry stores and what `occurrences` resolves — an annotation's
 * identity without its location, which is why a curated row and a built-in row
 * are the same row.
 */
export type Reference =
  | { readonly kind: 'anchor'; readonly name: string }
  | { readonly kind: 'tag'; readonly subject: string }
  | { readonly kind: 'date'; readonly date: DateKey }
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'file'; readonly path: NotebookPath }
  /** A curated section, which is a fileset by name (D53). */
  | { readonly kind: 'section'; readonly name: string }
  /** Somewhere else entirely: the browser's problem, not the corpus's. */
  | { readonly kind: 'url'; readonly href: string }

export interface Subject {
  readonly subject: string
  readonly count: number
  readonly first: Located
}

export interface OutlineNode {
  readonly at: Located
  readonly title: string
  readonly level: number
  readonly children: readonly OutlineNode[]
}

export interface ThreadRow {
  readonly id: string
  readonly resolved: boolean
  readonly at: Located
}

export interface IndexStatus {
  /** Files whose spans are known: either cached and fresh, or scanned. */
  readonly known: number
  readonly total: number
  readonly building: boolean
}

// ── curated sections (D53) ───────────────────────────────────

/** One line of a fileset: what it points at, what it is called, what it is for. */
export interface SectionRow {
  readonly label: string
  /** The human-authored text after the link. Never regenerated (R20). */
  readonly summary: string | null
  readonly target: Reference
  /** A section entry's contents, once resolved. Null when it is not one. */
  readonly children: SectionTree | null
  /**
   * The target does not exist.
   *
   * **Shown anyway** (D53): the corpus is hand-edited and synced, so a dangling
   * reference is ordinary — and the entry is the only remaining record of what
   * was meant.
   */
  readonly missing: boolean
}

export interface SectionTree {
  readonly title: string
  /**
   * The file to EDIT — null when there is none to edit.
   *
   * Null for a section that is missing, and for a directory's listing that
   * nobody has curated: it is derived from what is in the directory, so there
   * is no line anywhere to unpin (D53).
   */
  readonly path: NotebookPath | null
  /**
   * What the entries are relative to.
   *
   * **Not the same question as `path`, and the difference is why this exists.**
   * A relative link resolves against the file it is written in, which for a
   * derived listing is the file it WOULD be written in — `notes/_index.
   * fileset.md`, whether or not anyone has made it. Folding the two together
   * meant a derived entry resolved from the stream's depth instead, landed
   * outside the notebook, and reported itself as missing.
   */
  readonly base?: NotebookPath
  readonly entries: readonly SectionRow[]
}

/**
 * What happened when a reference was followed (D51: one verb, several theres).
 *
 * **A document is an outcome, not a failure.** A `.md` file inside the notebook
 * used to come back `unsupported`, because the app had one document and no way
 * to open another; now main says which document it is and the pane goes there
 * (D54). A URL and a PDF still leave the app, which is the same verb pointing
 * somewhere the app does not own.
 */
export type Followed =
  | 'opened'
  | 'missing'
  | 'unsupported'
  | { readonly document: DocumentId }
