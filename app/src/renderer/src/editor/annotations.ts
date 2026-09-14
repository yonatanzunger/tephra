// What a surface reports about the annotations it has drawn (D44, D47, D50).
//
// **Screen facts, not document facts.** The document's own annotations are
// `shared/prose.ts`; these are where they landed on the page, which only the
// thing that drew them knows. The mark panel and the comment rail are app
// furniture that sits beside the text, so the types they speak in belong here
// rather than inside one surface's implementation.

import type { Span } from '../../../shared/document-api.ts'

/** What a mark stands for, once someone clicks it. */
export interface MarkInfo {
  /** Where on screen it is, so the panel can sit beside it. */
  readonly box: DOMRect
  /** The bookmark this mark IS, if it is one. */
  readonly anchor: string | null
  /**
   * The subject this mark opens, first, followed by any others covering the
   * same point.
   *
   * The mark belongs to exactly one span — a tag's start marker — but a passage
   * may carry several subjects at once, and the ones past the third are not
   * drawn at all (the extent stacks only three deep). So this is where they
   * become visible: the list is the answer to "what is this passage".
   */
  readonly tags: readonly { readonly name: string; readonly span: Span }[]
  /**
   * The comment threads this mark opens or sits inside.
   *
   * **The third thing that puts a handle in the text, and the one this type
   * used to leave out.** A marker is a bookmark, the start of a tagged range,
   * or the start of a commented one — and because only the first two were
   * asked about, clicking a comment's marker produced a panel saying *nothing
   * resolves here* about a mark the editor had drawn itself. Reported from use.
   *
   * Identification only: the thread's messages live in the rail, which is where
   * D50 puts them. This says what the mark IS, which is the panel's whole job.
   */
  readonly comments: readonly {
    readonly id: string
    readonly opening: string
    readonly author: string
    readonly resolved: boolean
  }[]
}

/** Where a comment thread's rule landed, so the rail can line up with it. */
export interface CommentAnchor {
  readonly id: string
  /** Pixels from the top of the scroller's content, so it scrolls for free. */
  readonly top: number
  readonly resolved: boolean
}
