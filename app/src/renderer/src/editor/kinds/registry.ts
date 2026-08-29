// What the editing surface offers, per kind of document (D54).
//
// **Not a capability list for its own sake.** Every entry here is something that
// would be actively WRONG on the other kinds: day separators drawn through a
// note that has no days, a tag underline in a fileset whose links are its
// content, a caret landing at the end of a document nobody is appending to.
//
// Markdown is the default rather than an entry. A kind the renderer has not been
// taught about is still a markdown file and still opens — refusing would make an
// unknown kind worse than a known one (R26).

import type { DocumentKind } from '../../../../shared/document-api.ts'

export interface Surface {
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

const STREAM: Surface = { days: true, annotations: true, landing: 'append' }
const PLAIN: Surface = { days: false, annotations: false, landing: 'start' }

export function surfaceFor(kind: DocumentKind): Surface {
  return kind === 'stream' ? STREAM : PLAIN
}
