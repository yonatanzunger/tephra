// Crossing between the bytes on disk and the prose a person edits (D44).
//
// **Shared, and that is the point.** Main holds the bodies and the renderer
// holds the buffer, and both have to answer "where is this position in the
// other coordinate system". Two implementations of one quantity is the failure
// this codebase keeps meeting — the frame computed its measure twice, the
// generation had two homes — and here it showed up as tag underlines drawn in
// the wrong place, because the renderer was still adding a segment offset to a
// raw offset.
//
// The map needs no text: only where the markers are and how wide the body is.

import { HANDLE, type BufferPosition, type Offset, type ProseOffset } from './document-api.ts'

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
  readonly from: Offset
  readonly to: Offset
  readonly width: ProseWidth
}

/**
 * Crossing between a segment's prose and the window's buffer.
 *
 * The one place a segment start is added to a local offset, and it is a named
 * function rather than a `+` so that the two operands have to BE the right
 * kinds. Everything that went wrong with markers in the buffer went wrong at an
 * addition that looked innocent.
 */
export const inWindow = (start: BufferPosition, local: ProseOffset): BufferPosition =>
  (start + local) as BufferPosition

/** The inverse: where a buffer position falls within its segment's prose. */
export const inSegment = (at: BufferPosition, start: BufferPosition): ProseOffset =>
  (at - start) as ProseOffset

export class ProseMap {
  readonly #rawLength: number
  /** Ascending, non-overlapping. */
  readonly #markers: readonly Marker[]
  /** Prose offset at which each marker sits, parallel to `#markers`. */
  readonly #at: readonly number[]
  readonly proseLength: number

  private constructor(rawLength: number, markers: readonly Marker[], at: readonly number[], proseLength: number) {
    this.#rawLength = rawLength
    this.#markers = markers
    this.#at = at
    this.proseLength = proseLength
  }

  static of(rawLength: number, markers: readonly Marker[]): ProseMap {
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
    return new ProseMap(rawLength, sorted, at, prose + (rawLength - cursor))
  }

  get markers(): readonly Marker[] {
    return this.#markers
  }

  /**
   * Where a raw offset lands in prose.
   *
   * An offset INSIDE a marker has no prose position of its own, so it collapses
   * to where the marker sits. Callers that care about the difference are asking
   * the wrong question: there is nothing inside a marker to point at.
   */
  toProse(raw: Offset): ProseOffset {
    const at = clamp(raw, 0, this.#rawLength)
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
   * Where a prose offset lands in the raw body.
   *
   * **Leftmost, and that is the trailing-boundary rule.** A prose position with
   * a zero-width marker sitting at it is one visual place and two raw offsets —
   * before the marker or after it. Answering "before" means text inserted at
   * the end of a tagged range lands INSIDE the range, so continuing a tagged
   * sentence keeps the subject. Use `toRawAfter` where the other side is wanted.
   */
  toRaw(prose: ProseOffset): Offset {
    return this.#toRaw(clamp(prose, 0, this.proseLength), false)
  }

  /** As `toRaw`, but past any zero-width marker sitting at that position. */
  toRawAfter(prose: ProseOffset): Offset {
    return this.#toRaw(clamp(prose, 0, this.proseLength), true)
  }

  #toRaw(prose: number, after: boolean): Offset {
    let added = 0
    for (let i = 0; i < this.#markers.length; i++) {
      const marker = this.#markers[i] as Marker
      const sits = this.#at[i] as number
      if (prose < sits) break
      if (prose === sits && !(after && marker.width === 0)) break
      if (prose === sits + marker.width && marker.width === 1) {
        // Immediately after a handle: past its bytes, before anything else.
        return marker.to
      }
      added += marker.to - marker.from - marker.width
    }
    return (prose + added) as Offset
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

  /** Every marker whose bytes fall inside a raw range, handles and boundaries alike. */
  within(from: Offset, to: Offset): readonly Marker[] {
    return this.#markers.filter(m => m.from >= from && m.to <= to)
  }

  /**
   * A raw range with the boundary markers inside it carved out.
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
  carve(from: Offset, to: Offset): readonly { from: Offset; to: Offset }[] {
    const out: { from: Offset; to: Offset }[] = []
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
export function proseText(raw: string, map: ProseMap): string {
  const parts: string[] = []
  let cursor = 0
  for (const marker of map.markers) {
    parts.push(raw.slice(cursor, marker.from))
    if (marker.width === 1) parts.push(HANDLE)
    cursor = marker.to
  }
  parts.push(raw.slice(cursor))
  return parts.join('')
}

/** Text arriving from outside — a paste, an import — may not carry handles. */
export const stripHandles = (text: string): string => text.split(HANDLE).join('')
