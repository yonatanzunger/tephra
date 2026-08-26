// What the sidebar asks about, and what it gets back (D51, D52).
//
// Type-only, and shared, because the index lives in main and the nav lives in
// the renderer: these are the words they have in common. The store, the scan
// and the cache are all on the other side of this file.

import type { DateKey } from './document-api.ts'

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
