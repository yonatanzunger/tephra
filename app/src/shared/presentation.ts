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
  /**
   * `byExtent` is the screen's answer, and it is a fourth value rather than a
   * renderer's private choice **because it is a placement decision** — which is
   * this module's whole job (D50). What is new is that the question needs a
   * second thing about the annotation besides its kind: how much of the
   * document it covers.
   */
  readonly tag: 'absent' | 'inline' | 'margin' | 'byExtent'
  readonly comment: 'absent' | 'inline' | 'margin' | 'footnote' | 'endOfSection'
}

/** Desktop: the rail is where a comment goes, because there is room for it. */
export const DESKTOP: Presentation = {
  date: 'seam', heading: 'inline', anchor: 'margin', tag: 'byExtent', comment: 'margin',
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
export type Slot = 'none' | 'flow' | 'margin' | 'spine' | 'foot' | 'section' | 'head'

/**
 * How much text a tag has to cover before it stops being a phrase.
 *
 * **Two different acts wear the same notation.** Tagging a few words points at
 * them — *these words* — and an underline is exactly right for that. Tagging
 * three paragraphs claims territory, and the same underline then lands on every
 * line of the section: reported from use as visually jarring, and it is the
 * notation's own virtue that does it, since overlapping subjects stack into
 * three rules under every line.
 *
 * **Counted in characters, and deliberately not in lines.** A rule that asked
 * *does this wrap?* would be a rule about the window: widen it and a region
 * silently becomes a phrase, which is a notation that changes while you are not
 * looking at it. The extent of a span is a fact about the document, so the
 * decision can live here (D50) instead of in whichever renderer happens to know
 * its own geometry.
 *
 * Roughly two lines at a reading measure. A round number that can be moved once
 * somebody has lived with it, not a threshold anything is derived from.
 */
export const REGION = 160

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
      // A phrase points and a region claims, so they are drawn differently.
      if (how[annotation.kind] === 'byExtent') {
        slot = (annotation.at.to as number) - (annotation.at.from as number) > REGION
          ? 'spine'
          : 'flow'
      }
      // Paper has a margin for a tag but no spine to draw one in; a surface
      // that paginates is asked for the name and not for the extent.
      if (surface.paginates && slot === 'spine') slot = 'margin'
      if (!surface.paginates && (slot === 'foot' || slot === 'head')) slot = 'section'
      const cue = slot === 'foot' || slot === 'section' ? String(++numbered) : null
      return { annotation, slot, cue }
    })
}
