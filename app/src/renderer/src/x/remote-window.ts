// The renderer's half of a DocumentWindow (D37).
//
// Document is authoritative and lives in main. This holds the text, the span
// list and the segment placement, which is exactly what the synchronous half of
// the API needs — toDocument, toWindow, spansAt, snap, advance and distance all
// answer without a round trip, which is the whole reason the split is drawn
// here rather than anywhere else.
//
// The buffer updates SYNCHRONOUSLY on edit; the promise resolves when main says
// the change is durable. The editor fires and does not await.

import type {
  WindowEdit, WindowPosition, DateKey, Document, DocumentPosition, DocumentWindow,
  EditOrigin, DocumentOffset, ProseText, SegmentKey, SessionGeneration, Span, SpanKind, TypedSpan, Unsubscribe,
} from '../../../shared/document-api.ts'
import type { WindowSnapshot } from '../../../shared/ipc.ts'
import { applyEdits } from './apply-edits.ts'
import { inSegment, inWindow, inWindowProse, ProseMap, type Prose } from '../../../shared/prose.ts'

type Placement = WindowSnapshot['placement']

export class DesyncError extends Error {
  constructor(expected: number, got: number) {
    super(`window desynchronised: main has ${expected} characters, renderer has ${got}`)
    this.name = 'DesyncError'
  }
}

export class RemoteWindow implements DocumentWindow {
  readonly id: number
  readonly #doc: Document
  #text: ProseText
  #span: Span
  #generation: SessionGeneration
  #spans: readonly TypedSpan[]
  #placement: Placement
  readonly #maps = new WeakMap<Placement[number], ProseMap>()
  #boundaries: { earlier: boolean; later: boolean }

  readonly #changeHandlers = new Set<(edits: readonly WindowEdit[], origin: EditOrigin) => void>()
  readonly #resetHandlers = new Set<() => void>()
  readonly #spansHandlers = new Set<() => void>()

  /**
   * Which edit this is, locally. An editor fires without awaiting, so several
   * are in flight at once and their acks describe intermediate states — ack #1
   * reports main's length after one edit while this buffer already holds five.
   * Only the newest ack describes a state both sides agree on.
   */
  #seq = 0

  /**
   * How many announcements from main this buffer has applied (D88).
   *
   * Sent with every edit so main can refuse one composed before an announcement
   * that had not arrived — the offsets in it were computed against text that has
   * since moved. Set from the snapshot, and advanced only when a push is
   * actually applied, because a number that ran ahead of the text would defeat
   * the check it exists for.
   */
  #heard: number

  constructor(doc: Document, snapshot: WindowSnapshot) {
    this.id = snapshot.id
    this.#doc = doc
    this.#text = snapshot.text
    this.#span = snapshot.span
    this.#generation = snapshot.generation
    this.#spans = snapshot.spans
    this.#placement = snapshot.placement
    this.#boundaries = snapshot.boundaries
    this.#heard = snapshot.heard
  }

  get document(): Document {
    return this.#doc
  }
  get generation(): SessionGeneration {
    return this.#generation
  }
  get text(): ProseText {
    return this.#text
  }

  /**
   * The window's prose (D50), assembled from the snapshot's parts by the same
   * rule main uses — the placement says where each segment starts, and its
   * annotations are shifted by that.
   */
  get prose(): Prose<WindowPosition> {
    return {
      text: this.#text,
      annotations: this.#placement.flatMap(p => inWindowProse(p.annotations, p.start)),
    }
  }
  get span(): Span {
    return this.#span
  }

  // ── coordinates, synchronous by construction ───────────────

  /**
   * A boundary offset belongs to the LATER segment — a day body ends with a
   * newline, so that offset renders at the first column of the next day, and
   * text typed there must land in the file the reader sees it under. The end of
   * the window belongs to the last segment, which is what makes appending work.
   */
  toDocument(at: WindowPosition): DocumentPosition {
    const offset = clamp(at as number, 0, this.#text.length) as WindowPosition
    for (let i = this.#placement.length - 1; i >= 0; i--) {
      const p = this.#placement[i] as Placement[number]
      if (offset >= p.start) {
        // Through the map, NOT by subtraction. `offset - p.start` is a prose
        // offset within the segment, and returning it as an `DocumentOffset` claims it
        // counts document offsets — which it only does when the segment has no markers.
        // With one marker present it is short by that marker's width, so
        // tagging a phrase wrote its markers twenty-seven characters early and the
        // second tag of a paragraph landed inside the first.
        return {
          segment: p.date as SegmentKey,
          offset: this.#map(p).toDocument(inSegment(offset, p.start)),
          generation: this.#generation,
        }
      }
    }
    const first = this.#placement[0]
    return {
      segment: (first?.date ?? '') as SegmentKey,
      offset: 0 as DocumentOffset,
      generation: this.#generation,
    }
  }

  toWindow(at: DocumentPosition): WindowPosition | null {
    for (const p of this.#placement) {
      if (p.date === at.segment) {
        // Through the SAME map main uses (D44). Adding a document offset to a prose
        // start is how tag underlines ended up drawn where no marker had ever
        // been accounted for.
        return inWindow(p.start, this.#map(p).toProse(at.offset))
      }
    }
    return null
  }

  /** Cached per placement entry: rebuilt only when a snapshot replaces it. */
  #map(p: Placement[number]): ProseMap {
    let map = this.#maps.get(p)
    if (map === undefined) {
      map = ProseMap.of(p.length, p.markers)
      this.#maps.set(p, map)
    }
    return map
  }

  // ── editing ────────────────────────────────────────────────

  async edit(edits: readonly WindowEdit[], origin: EditOrigin = 'user'): Promise<void> {
    // Synchronously, before anything is awaited: the editor has already painted
    // this and must not be told about it again.
    this.#text = applyEdits(this.#text, edits)
    const seq = ++this.#seq

    const ack = await window.tephra.doc.edit({
      id: this.id,
      edits,
      origin,
      generation: this.#generation,
      heard: this.#heard,
    })

    // Superseded: more edits were fired while this one was in flight, so this
    // ack describes a state that is already historical. The newest one governs.
    if (seq !== this.#seq) return

    // **Refused** (D88): composed against a buffer main had already moved on
    // from, so it was not applied and this buffer is now wrong in a way it
    // cannot repair by arithmetic. Re-read, and do not raise: the state after a
    // re-read is correct, and one lost keystroke is the cheap half of the trade
    // — the expensive half was a character landing somewhere else and taking a
    // comment's blockquote with it.
    if (ack.refused === true) {
      // **Adopt main's text first, then re-render.** A reset re-renders from
      // THIS buffer, and this buffer is what was just judged stale — so
      // resyncing without adopting left the window unable to accept another
      // keystroke, every one of them refused for the same reason as the last.
      if (ack.text !== undefined) this.#text = ack.text
      this.#generation = ack.generation
      this.#heard = ack.heard
      this.#placement = ack.placement
      this.#setSpans(ack.spans)
      this.#resync()
      return
    }

    if (ack.length !== this.#text.length) {
      // Main is authoritative. Continuing on a buffer that no longer describes
      // the document is how an edit lands in the wrong place later.
      this.#resync()
      throw new DesyncError(ack.length, this.#text.length)
    }

    this.#generation = ack.generation
    this.#heard = ack.heard
    this.#placement = ack.placement
    this.#setSpans(ack.spans)
  }

  /**
   * Replace the spans, telling anyone drawing from them if they actually moved.
   *
   * Compared rather than announced unconditionally: an acknowledgement arrives
   * for every keystroke, and dispatching a redraw per keystroke would put work
   * on the typing path for something that changes a few times an hour.
   */
  #setSpans(next: readonly TypedSpan[]): void {
    const same =
      next.length === this.#spans.length &&
      next.every((span, i) => {
        const old = this.#spans[i] as TypedSpan
        return (
          span.kind === old.kind &&
          span.name === old.name &&
          span.span.begin.segment === old.span.begin.segment &&
          (span.span.begin.offset as number) === (old.span.begin.offset as number) &&
          (span.span.end.offset as number) === (old.span.end.offset as number)
        )
      })
    this.#spans = next
    if (same) return
    for (const handler of this.#spansHandlers) handler()
  }

  // ── queries ────────────────────────────────────────────────

  spans(kind?: SpanKind): readonly TypedSpan[] {
    return kind === undefined ? this.#spans : this.#spans.filter(s => s.kind === kind)
  }

  spansAt(at: WindowPosition): readonly TypedSpan[] {
    const position = this.toDocument(at)
    const offset = position.offset as number
    return this.#spans.filter(
      s =>
        s.span.begin.segment === position.segment &&
        offset >= (s.span.begin.offset as number) &&
        offset <= (s.span.end.offset as number),
    )
  }

  snap(from: WindowPosition, to: WindowPosition): { from: WindowPosition; to: WindowPosition } {
    const text = this.#text
    const a = clamp(from as number, 0, text.length)
    const b = clamp(to as number, 0, text.length)
    const start = text.lastIndexOf('\n', a - 1) + 1
    const nl = text.indexOf('\n', b)
    return { from: start as WindowPosition, to: (nl === -1 ? text.length : nl + 1) as WindowPosition }
  }

  advance(from: WindowPosition, chars: number): WindowPosition | null {
    const next = (from as number) + chars
    return next < 0 || next > this.#text.length ? null : (next as WindowPosition)
  }

  distance(a: WindowPosition, b: WindowPosition): number {
    return (b as number) - (a as number)
  }

  // ── changes from elsewhere ─────────────────────────────────

  onChanged(handler: (edits: readonly WindowEdit[], origin: EditOrigin) => void): Unsubscribe {
    this.#changeHandlers.add(handler)
    return () => this.#changeHandlers.delete(handler)
  }

  onSpansChanged(handler: () => void): Unsubscribe {
    this.#spansHandlers.add(handler)
    return () => this.#spansHandlers.delete(handler)
  }

  onReset(handler: () => void): Unsubscribe {
    this.#resetHandlers.add(handler)
    return () => this.#resetHandlers.delete(handler)
  }

  /** Called by the document when main pushes a change for this window. */
  applyRemote(
    edits: readonly WindowEdit[],
    origin: EditOrigin,
    text: ProseText,
    generation: SessionGeneration,
    heard: number,
    spans: readonly TypedSpan[],
    placement: Placement,
    boundaries: { earlier: boolean; later: boolean },
  ): void {
    this.#text = text
    this.#generation = generation
    // **Advanced only here**, where the text it describes is actually in hand.
    this.#heard = heard
    this.#placement = placement
    this.#boundaries = boundaries
    this.#setSpans(spans)
    for (const handler of this.#changeHandlers) handler(edits, origin)
  }

  remoteReset(): void {
    for (const handler of this.#resetHandlers) handler()
  }

  #resync(): void {
    for (const handler of this.#resetHandlers) handler()
  }

  /**
   * Grow the region. The resulting prepend or append arrives as an ordinary
   * pushed change, which is what lets the editor map the cursor through it.
   */
  async extend(direction: 'earlier' | 'later', chars = 20_000): Promise<void> {
    await window.tephra.doc.extend({ id: this.id, direction, chars })
  }

  get boundaries(): { earlier: boolean; later: boolean } {
    return this.#boundaries
  }

  release(): void {
    void window.tephra.doc.release(this.id)
    this.#changeHandlers.clear()
    this.#resetHandlers.clear()
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

export type { DateKey }
