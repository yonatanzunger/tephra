// Crossing between the document's text and the prose a person edits (D44).
//
// **Shared, and that is the point.** Main holds the bodies and the renderer
// holds the buffer, and both have to answer "where is this position in the
// other coordinate system". Two implementations of one quantity is the failure
// this codebase keeps meeting — the frame computed its measure twice, the
// generation had two homes — and here it showed up as tag underlines drawn in
// the wrong place, because the renderer was still adding a segment offset to a
// document offset.
//
// The map needs no text: only where the markers are and how wide the body is.

import {
  HANDLE, type WindowPosition, type DocumentOffset, type ProseOffset, type ProseText, type DocumentText,
} from './document-api.ts'
import type { CommentThread } from './comments.ts'

export { HANDLE }

/**
 * How much prose a marker occupies.
 *
 * **A handle takes one character; a boundary takes none.** A bookmark and the
 * start of a tagged range are handles: they are what a person points at, steps
 * onto, and deletes to remove the tag, so they must be somewhere the caret can
 * be. The end of a tagged range is only a boundary — the underline already
 * shows where the range stops — so it occupies nothing and no keystroke can
 * reach it.
 *
 * That one character is why the removal gesture needs no keymap. An edit that
 * removes a handle is recognised as such wherever it came from: backspace, `x`,
 * a selection overtyped, or a keymap nobody has written yet.
 */
export type ProseWidth = 0 | 1

export interface Marker {
  readonly from: DocumentOffset
  readonly to: DocumentOffset
  readonly width: ProseWidth
  /**
   * Whether these bytes are **content elided from the passage** rather than
   * apparatus belonging to it (D89).
   *
   * Both take no prose width, and the difference decides which side of them a
   * caret is on. A `tag-end` is apparatus: a position at it belongs BEFORE it, so
   * continuing a tagged sentence keeps the subject (D44). A comment's thread
   * block is two hundred characters of somebody's writing that merely lives
   * here: a position at it belongs AFTER it, because text typed where a comment
   * card appears is the next paragraph and not a line of the comment.
   *
   * Reported from use as a crash, three times in one evening: typing after a
   * comment inserted a character at the start of its byline, which stopped the
   * block being a blockquote, which un-elided two hundred and ten characters,
   * which desynchronised the window.
   */
  readonly elides?: true
}

/**
 * Crossing between a segment's prose and the window's buffer.
 *
 * The one place a segment start is added to a local offset, and it is a named
 * function rather than a `+` so that the two operands have to BE the right
 * kinds. Everything that went wrong with markers in the buffer went wrong at an
 * addition that looked innocent.
 */
export const inWindow = (start: WindowPosition, local: ProseOffset): WindowPosition =>
  (start + local) as WindowPosition

/** The inverse: where a buffer position falls within its segment's prose. */
export const inSegment = (at: WindowPosition, start: WindowPosition): ProseOffset =>
  (at - start) as ProseOffset

export class ProseMap {
  readonly #documentLength: number
  /** Ascending, non-overlapping. */
  readonly #markers: readonly Marker[]
  /** Prose offset at which each marker sits, parallel to `#markers`. */
  readonly #at: readonly number[]
  readonly proseLength: number

  private constructor(documentLength: number, markers: readonly Marker[], at: readonly number[], proseLength: number) {
    this.#documentLength = documentLength
    this.#markers = markers
    this.#at = at
    this.proseLength = proseLength
  }

  static of(documentLength: number, markers: readonly Marker[]): ProseMap {
    const sorted = [...markers]
      .sort((a, b) => a.from - b.from || a.to - b.to)
      .filter((m, i, all) => i === 0 || m.from >= (all[i - 1] as Marker).to)
    const at: number[] = []
    let cursor = 0
    let prose = 0
    for (const marker of sorted) {
      prose += marker.from - cursor
      at.push(prose)
      prose += marker.width
      cursor = marker.to
    }
    return new ProseMap(documentLength, sorted, at, prose + (documentLength - cursor))
  }

  get markers(): readonly Marker[] {
    return this.#markers
  }

  /**
   * Where a document offset lands in prose.
   *
   * An offset INSIDE a marker has no prose position of its own, so it collapses
   * to where the marker sits. Callers that care about the difference are asking
   * the wrong question: there is nothing inside a marker to point at.
   */
  toProse(at_: DocumentOffset): ProseOffset {
    const at = clamp(at_, 0, this.#documentLength)
    let shed = 0
    for (let i = 0; i < this.#markers.length; i++) {
      const marker = this.#markers[i] as Marker
      if (at <= marker.from) break
      if (at < marker.to) return this.#at[i] as ProseOffset // inside it
      shed += marker.to - marker.from - marker.width
    }
    return (at - shed) as ProseOffset
  }

  /**
   * Where a prose offset lands in the document's text.
   *
   * **Leftmost, and that is the trailing-boundary rule.** A prose position with
   * a zero-width marker sitting at it is one visual place and two document offsets —
   * before the marker or after it. Answering "before" means text inserted at
   * the end of a tagged range lands INSIDE the range, so continuing a tagged
   * sentence keeps the subject. Use `toDocumentAfter` where the other side is wanted.
   *
   * **Except past an elided block** (D89), which is content and not apparatus:
   * there, leftmost would put text inside somebody's comment. The rule is about
   * which side of two characters of machinery a caret is on; it was never about
   * which side of a paragraph.
   */
  toDocument(prose: ProseOffset): DocumentOffset {
    return this.#toDocument(clamp(prose, 0, this.proseLength), false)
  }

  /** As `toDocument`, but past any zero-width marker sitting at that position. */
  toDocumentAfter(prose: ProseOffset): DocumentOffset {
    return this.#toDocument(clamp(prose, 0, this.proseLength), true)
  }

  #toDocument(prose: number, after: boolean): DocumentOffset {
    let added = 0
    for (let i = 0; i < this.#markers.length; i++) {
      const marker = this.#markers[i] as Marker
      const sits = this.#at[i] as number
      if (prose < sits) break
      // **An elided block is always passed**, whatever the caller asked for: a
      // prose position at it is after the block, because there is nothing in
      // the block a caret in the passage could mean (D89).
      if (prose === sits && !((after || marker.elides === true) && marker.width === 0)) break
      if (prose === sits + marker.width && marker.width === 1) {
        // Immediately after a handle: past its bytes, before anything else.
        return marker.to
      }
      added += marker.to - marker.from - marker.width
    }
    return (prose + added) as DocumentOffset
  }

  /** The marker whose handle occupies this prose offset, if any. */
  handleAt(prose: ProseOffset): Marker | null {
    for (let i = 0; i < this.#markers.length; i++) {
      if ((this.#at[i] as number) === prose && (this.#markers[i] as Marker).width === 1) {
        return this.#markers[i] as Marker
      }
    }
    return null
  }

  /** Every marker inside a range of document text, handles and boundaries alike. */
  within(from: DocumentOffset, to: DocumentOffset): readonly Marker[] {
    return this.#markers.filter(m => m.from >= from && m.to <= to)
  }

  /**
   * A range of document text with the boundary markers inside it carved out.
   *
   * An ordinary deletion sweeping across the end of a tagged range would take
   * the `tag-end` with it, and an unmatched `tag-start` runs to the end of its
   * segment — so deleting a sentence would silently tag the rest of the day.
   * Splitting the deletion around the marker leaves the pair intact and the
   * range simply shorter, which is what the person meant.
   *
   * Handles are NOT carved out: deleting one is a deliberate gesture with its
   * own meaning (D44), recognised before an edit ever gets here.
   */
  carve(from: DocumentOffset, to: DocumentOffset): readonly { from: DocumentOffset; to: DocumentOffset }[] {
    const out: { from: DocumentOffset; to: DocumentOffset }[] = []
    let cursor = from
    for (const marker of this.#markers) {
      if (marker.width !== 0 || marker.to <= from || marker.from >= to) continue
      if (marker.from > cursor) out.push({ from: cursor, to: marker.from })
      cursor = marker.to
    }
    if (cursor < to) out.push({ from: cursor, to })
    return out
  }
}

const clamp = (n: number, low: number, high: number): number => Math.max(low, Math.min(n, high))

/** The body with marker syntax removed and handles standing in their place. */
export function proseText(text: DocumentText, map: ProseMap): ProseText {
  const parts: string[] = []
  let cursor = 0
  for (const marker of map.markers) {
    parts.push(text.slice(cursor, marker.from))
    if (marker.width === 1) parts.push(HANDLE)
    cursor = marker.to
  }
  parts.push(text.slice(cursor))
  return parts.join('') as ProseText
}

/**
 * A string taken out of the editor buffer, which by construction holds prose.
 *
 * Not a conversion — the characters do not change — but a place to say WHERE
 * the claim comes from. Everything CodeMirror hands back is measured in the
 * same coordinates as the text it was given, so the only way this is wrong is
 * if the buffer were loaded with something other than a window's prose.
 */
export const fromBuffer = (text: string): ProseText => text as ProseText

/** Text arriving from outside — a paste, an import — may not carry handles. */
export const stripHandles = (text: string): string => text.split(HANDLE).join('')

/**
 * Prose on its way into the file.
 *
 * The only conversion in this direction, and it is not the identity: handles
 * exist in the buffer alone (D44), so text a person typed or pasted must have
 * them removed before it becomes bytes. The other direction needs the map and
 * lives in `proseText` — there is no way across that does not go through one of
 * these two.
 */
export const documentText = (prose: string): DocumentText => stripHandles(prose) as DocumentText

// ─────────────────────────────────────────────────────────────
// Prose: the document AS DISPLAYED (D50)
// ─────────────────────────────────────────────────────────────

/**
 * The two coordinate systems prose is addressed in, and never a third.
 *
 * A segment's prose is measured in `ProseOffset`, a window's in
 * `WindowPosition` (D48). Everything below is generic over which, so the same
 * value serves a day on its way to a printer and a region on its way to the
 * editor — with the compiler refusing to mix them.
 */
export type Anchored = ProseOffset | WindowPosition

export interface Anchor<At extends Anchored> {
  readonly from: At
  readonly to: At // from === to for a point, as everywhere else
}

/**
 * Everything the document holds that is not its text.
 *
 * **One union rather than four parallel mechanisms.** A day, a heading, a
 * bookmark, a tagged range and a comment thread differ in what they carry and
 * in how they are drawn, and in nothing else: they are anchored the same way,
 * they move through an edit the same way, and — the point of the exercise —
 * something has to choose where to put each of them, by the same rules.
 *
 * The discriminants are `SpanKind`'s, deliberately: the document API already
 * has a vocabulary for these, and a second one would be two names for one
 * thing (D50).
 *
 * **An annotation exists only in prose coordinates.** In the document's own
 * offsets this same fact is a `TypedSpan`, and a second representation of one
 * layer's facts is precisely what D48 is for. The translation happens inside
 * `proseOf`, where the map is, and nothing outside it can name the halfway
 * state.
 */
export type Annotation<At extends Anchored> =
  | { readonly kind: 'date'; readonly at: Anchor<At>; readonly date: string }
  | { readonly kind: 'heading'; readonly at: Anchor<At>; readonly text: string; readonly level: number }
  | { readonly kind: 'anchor'; readonly at: Anchor<At>; readonly name: string }
  | { readonly kind: 'tag'; readonly at: Anchor<At>; readonly subject: string }
  | { readonly kind: 'comment'; readonly at: Anchor<At>; readonly thread: CommentThread }

export type AnnotationKind = Annotation<ProseOffset>['kind']

/**
 * The document as displayed: the text, and everything anchored into it.
 *
 * **The map is deliberately NOT here, and D50 said it was.** Implementing the
 * window found the flaw: a map relates one prose to one document text, so it
 * belongs to whatever owns both — a `Segment` does, and a WINDOW DOES NOT. A
 * window spans several segments and crosses to the document through its
 * placement and their maps, so a single `map` field would have been a lie at
 * exactly the scope the editor uses. Nothing downstream missed it: the printer
 * never converted a coordinate, and the renderer builds its own maps from the
 * markers in the snapshot.
 *
 * Plain data, so it crosses a process boundary as itself.
 */
export interface Prose<At extends Anchored> {
  readonly text: ProseText
  readonly annotations: readonly Annotation<At>[]
}

/** One segment's prose, which does have a single map, because it has one body. */
export interface SegmentProse extends Prose<ProseOffset> {
  readonly map: ProseMap
}

/** Shift a segment's annotations into the window that segment sits in. */
export function inWindowProse(
  annotations: readonly Annotation<ProseOffset>[],
  start: WindowPosition,
): readonly Annotation<WindowPosition>[] {
  return annotations.map(a => ({
    ...a,
    at: { from: inWindow(start, a.at.from), to: inWindow(start, a.at.to) },
  }))
}
