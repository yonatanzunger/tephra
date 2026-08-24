import { HANDLE } from '../../shared/document-api.ts'
// Two views of one body: the bytes on disk, and the prose a person edits.
//
// A marker's syntax never reaches the editor (D44). What the editor holds is
// PROSE — the text with `<!--tephra:…-->` taken out — and this is the arithmetic
// that crosses between the two coordinate systems.
//
// It is built and tested on its own, before anything is drawn on top of it,
// because a coordinate mapping that is subtly wrong corrupts files quietly and
// the symptom shows up nowhere near the cause.

/**
 * How much prose a marker occupies.
 *
 * **A handle takes one character; a boundary takes none.** A bookmark and the
 * start of a tagged range are handles: they are the thing you point at, step
 * onto, and delete to remove the tag, so they must be somewhere the caret can
 * be. The end of a tagged range is only a boundary — the underline already
 * shows where the range stops — so it occupies nothing and no keystroke can
 * reach it.
 *
 * That one character is why the removal gesture needs no keymap. An edit that
 * removes a handle is recognised as such wherever it came from: backspace, `x`,
 * a selection overtyped, or a keymap nobody has written yet.
 */
export type ProseWidth = 0 | 1

export { HANDLE }

export interface Marker {
  readonly from: number
  readonly to: number
  readonly width: ProseWidth
}

/**
 * The prose view of a body, with the arithmetic to cross between them.
 *
 * Immutable and cheap to rebuild: a segment's markers are already scanned for
 * `spans()`, and a body changing means rebuilding anyway.
 */
export class Prose {
  readonly text: string
  readonly #raw: string
  /** Ascending, non-overlapping. */
  readonly #markers: readonly Marker[]
  /** Prose offset at which each marker sits, parallel to `#markers`. */
  readonly #at: readonly number[]

  private constructor(raw: string, markers: readonly Marker[], text: string, at: readonly number[]) {
    this.#raw = raw
    this.#markers = markers
    this.text = text
    this.#at = at
  }

  static of(raw: string, markers: readonly Marker[]): Prose {
    const sorted = [...markers].sort((a, b) => a.from - b.from || a.to - b.to)
    const parts: string[] = []
    const at: number[] = []
    let cursor = 0
    let prose = 0

    for (const marker of sorted) {
      if (marker.from < cursor) continue // overlapping markers cannot both be honoured
      parts.push(raw.slice(cursor, marker.from))
      prose += marker.from - cursor
      at.push(prose)
      if (marker.width === 1) {
        parts.push(HANDLE)
        prose += 1
      }
      cursor = marker.to
    }
    parts.push(raw.slice(cursor))

    const kept = sorted.filter((m, i) => i === 0 || m.from >= (sorted[i - 1] as Marker).to)
    return new Prose(raw, kept, parts.join(''), at.slice(0, kept.length))
  }

  get markers(): readonly Marker[] {
    return this.#markers
  }

  /**
   * Where a raw offset lands in prose.
   *
   * An offset INSIDE a marker has no prose position of its own, so it collapses
   * to where the marker sits — before its handle, if it has one. Callers that
   * care about the difference are asking the wrong question: there is nothing
   * inside a marker to point at.
   */
  toProse(raw: number): number {
    const at = clamp(raw, 0, this.#raw.length)
    let shed = 0
    for (let i = 0; i < this.#markers.length; i++) {
      const marker = this.#markers[i] as Marker
      if (at <= marker.from) break
      if (at < marker.to) return (this.#at[i] as number) // inside it
      shed += marker.to - marker.from - marker.width
    }
    return at - shed
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
  toRaw(prose: number): number {
    return this.#toRaw(clamp(prose, 0, this.text.length), false)
  }

  /** As `toRaw`, but past any zero-width marker sitting at that position. */
  toRawAfter(prose: number): number {
    return this.#toRaw(clamp(prose, 0, this.text.length), true)
  }

  #toRaw(prose: number, after: boolean): number {
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
    return prose + added
  }

  /** The marker whose handle occupies this prose offset, if any. */
  handleAt(prose: number): Marker | null {
    for (let i = 0; i < this.#markers.length; i++) {
      if ((this.#at[i] as number) === prose && (this.#markers[i] as Marker).width === 1) {
        return this.#markers[i] as Marker
      }
    }
    return null
  }

  /** Every marker whose bytes fall inside a raw range, handles and boundaries alike. */
  within(from: number, to: number): readonly Marker[] {
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
  carve(from: number, to: number): readonly { from: number; to: number }[] {
    const out: { from: number; to: number }[] = []
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

/** Text arriving from outside — a paste, an import — may not carry handles. */
export const stripHandles = (text: string): string => text.split(HANDLE).join('')
