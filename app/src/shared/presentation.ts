// How prose is drawn — one policy, for every renderer (D50).
//
// **Screen and paper share the decision and not the drawing.** A CodeMirror
// decoration and an `<aside>` have nothing in common, but *which annotations go
// in the margin, which become notes, which are left out, and how notes are
// numbered when there are notes* is one question with one answer. That answer
// is `place()`, and everything downstream of it is a renderer for slots.
//
// The alternative is what the codebase had until now: comments with a rail,
// tags with an underline, days with a block widget — three mechanisms grown a
// fortnight apart, no two of which could be asked the same question.

import type { Anchored, Annotation, Prose } from './prose.ts'

/**
 * A treatment per kind, and the unions are different on purpose.
 *
 * A day cannot be a footnote and a comment has no business being a running
 * head. One enum for all of them would make sixteen impossible states
 * expressible, in a type whose entire job is to be exhaustive over the possible
 * ones.
 */
export interface Presentation {
  /** `date` rather than `day`, to match `SpanKind` — one vocabulary (D50). */
  readonly date: 'absent' | 'seam' | 'pageHeader'
  readonly heading: 'inline'
  readonly anchor: 'absent' | 'margin'
  readonly tag: 'absent' | 'inline' | 'margin'
  readonly comment: 'absent' | 'inline' | 'margin' | 'footnote' | 'endOfSection'
}

/** Desktop: the rail is where a comment goes, because there is room for it. */
export const DESKTOP: Presentation = {
  date: 'seam', heading: 'inline', anchor: 'margin', tag: 'inline', comment: 'margin',
}

/** Mobile: the same renderer, and the only difference is where there is room (Q10). */
export const MOBILE: Presentation = {
  date: 'seam', heading: 'inline', anchor: 'margin', tag: 'inline', comment: 'inline',
}

/** Paper: notes at the foot of the page they were written about. */
export const PAPER: Presentation = {
  date: 'seam', heading: 'inline', anchor: 'margin', tag: 'margin', comment: 'footnote',
}

/** Nothing but the words — what `proseIn` did before it had a policy. */
export const CLEAN: Presentation = {
  date: 'absent', heading: 'inline', anchor: 'absent', tag: 'absent', comment: 'absent',
}

/**
 * Where a placed annotation is drawn.
 *
 * `foot` and `head` are paper's; a scrolling document has no page to sit at the
 * foot of, so a screen asked for a footnote gets `section` — notes closing the
 * day (D50). That substitution happens HERE rather than in either renderer,
 * because it is a decision and not a drawing.
 */
export type Slot = 'none' | 'flow' | 'margin' | 'foot' | 'section' | 'head'

export interface Placed<At extends Anchored> {
  readonly annotation: Annotation<At>
  readonly slot: Slot
  /** What stands at the anchor when the content sits somewhere else. */
  readonly cue: string | null
}

/** What a surface can actually draw. Paper paginates; a screen does not. */
export interface Surface {
  readonly paginates: boolean
}

export const PAPER_SURFACE: Surface = { paginates: true }
export const SCREEN_SURFACE: Surface = { paginates: false }

const SLOT_OF: Record<string, Slot> = {
  absent: 'none',
  inline: 'flow',
  seam: 'flow',
  margin: 'margin',
  footnote: 'foot',
  endOfSection: 'section',
  pageHeader: 'head',
}

/**
 * The annotations of one prose, each with the slot it goes in.
 *
 * Order is the order they are anchored in, which is what makes note numbering
 * come out in reading order without a second pass.
 */
export function place<At extends Anchored>(
  prose: Prose<At>,
  how: Presentation,
  surface: Surface = SCREEN_SURFACE,
): readonly Placed<At>[] {
  let numbered = 0
  return [...prose.annotations]
    .sort((a, b) => a.at.from - b.at.from || a.at.to - b.at.to)
    .map(annotation => {
      let slot = SLOT_OF[how[annotation.kind]] ?? 'none'
      if (!surface.paginates && (slot === 'foot' || slot === 'head')) slot = 'section'
      const cue = slot === 'foot' || slot === 'section' ? String(++numbered) : null
      return { annotation, slot, cue }
    })
}
