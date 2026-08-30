// How the MARKDOWN surface behaves for each kind that uses it (D54).
//
// **Variations of ONE view, not a list of capabilities.** Every entry is
// something that would be actively WRONG on the other kinds: day separators
// drawn through a note that has no days, a caret landing at the end of a
// document nobody is appending to.
//
// The line these must not cross: **a boolean varies a view, a file replaces
// one** (`editor/surface.ts`). A kind that wants a different SHAPE of surface —
// checkboxes it can click, a list it can drag — gets its own file beside
// `Markdown.tsx` and a line in the registry, rather than a fourth flag here and
// a fourth conditional inside `bind.ts`.
//
// The plain settings are the default rather than an entry, so a kind nobody has
// taught this about still opens as the markdown file it is (R26).

import type { DocumentMeta } from '../../../../../shared/document-api.ts'

export interface MarkdownOptions {
  /**
   * Whether typing into it does anything.
   *
   * **Not a kind's property — the DOCUMENT's** (`meta.readOnly`), which is why
   * this is set beside the per-kind flags rather than being one of them. A file
   * from outside the notebook is an ordinary markdown document that cannot be
   * written; the buffer should say so by not accepting keystrokes, rather than
   * by letting someone type a paragraph and then refusing to save it (MC6).
   */
  readonly editable: boolean
  /** Day separators and the date gutter. The stream has days; nothing else does. */
  readonly days: boolean
  /**
   * The annotation layer: tag extents, marks, comment anchors (D44).
   *
   * Off elsewhere because the gestures that make them are the stream's in v1 —
   * a note cannot be tagged yet, so drawing the layer would only ever show an
   * empty one.
   */
  readonly annotations: boolean
  /**
   * Where the caret goes when a window opens.
   *
   * `append` is the stream's rule — you are continuing, not arriving (Q7). A
   * note is a thing you came to READ or to edit in the middle, so it opens at
   * the top, the way every other editor opens a file.
   */
  readonly landing: 'append' | 'start'
}

const STREAM: MarkdownOptions = { days: true, annotations: true, landing: 'append', editable: true }
const PLAIN: MarkdownOptions = { days: false, annotations: false, landing: 'start', editable: true }

export function optionsFor(meta: DocumentMeta): MarkdownOptions {
  const base = meta.kind === 'stream' ? STREAM : PLAIN
  return meta.readOnly === true ? { ...base, editable: false } : base
}
