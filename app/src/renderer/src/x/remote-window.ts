// The renderer's half of a DocumentWindow (D37).
//
// Document is authoritative and lives in main. This holds the text, the span
// list and the segment placement, which is exactly what the synchronous half of
// the API needs — toDocument, toBuffer, spansAt, snap, advance and distance all
// answer without a round trip, which is the whole reason the split is drawn
// here rather than anywhere else.
//
// The buffer updates SYNCHRONOUSLY on edit; the promise resolves when main says
// the change is durable. The editor fires and does not await.

import type {
  BufferEdit, BufferPosition, DateKey, Document, DocumentPosition, DocumentWindow,
  EditOrigin, Offset, SegmentKey, SessionGeneration, Span, SpanKind, TypedSpan, Unsubscribe,
} from '@shared/document-api.ts'
import type { WindowSnapshot } from '@shared/ipc.ts'
import { applyEdits } from './apply-edits.ts'

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
  #text: string
  #span: Span
  #generation: SessionGeneration
  #spans: readonly TypedSpan[]
  #placement: Placement

  readonly #changeHandlers = new Set<(edits: readonly BufferEdit[], origin: EditOrigin) => void>()
  readonly #resetHandlers = new Set<() => void>()

  /**
   * Which edit this is, locally. An editor fires without awaiting, so several
   * are in flight at once and their acks describe intermediate states — ack #1
   * reports main's length after one edit while this buffer already holds five.
   * Only the newest ack describes a state both sides agree on.
   */
  #seq = 0

  constructor(doc: Document, snapshot: WindowSnapshot) {
    this.id = snapshot.id
    this.#doc = doc
    this.#text = snapshot.text
    this.#span = snapshot.span
    this.#generation = snapshot.generation
    this.#spans = snapshot.spans
    this.#placement = snapshot.placement
  }

  get document(): Document {
    return this.#doc
  }
  get generation(): SessionGeneration {
    return this.#generation
  }
  get text(): string {
    return this.#text
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
  toDocument(at: BufferPosition): DocumentPosition {
    const offset = clamp(at as number, 0, this.#text.length)
    for (let i = this.#placement.length - 1; i >= 0; i--) {
      const p = this.#placement[i] as Placement[number]
      if (offset >= p.start) {
        return { segment: p.date as SegmentKey, offset: (offset - p.start) as Offset, generation: this.#generation }
      }
    }
    const first = this.#placement[0]
    return {
      segment: (first?.date ?? '') as SegmentKey,
      offset: 0 as Offset,
      generation: this.#generation,
    }
  }

  toBuffer(at: DocumentPosition): BufferPosition | null {
    for (const p of this.#placement) {
      if (p.date === at.segment) return (p.start + (at.offset as number)) as BufferPosition
    }
    return null
  }

  // ── editing ────────────────────────────────────────────────

  async edit(edits: readonly BufferEdit[], origin: EditOrigin = 'user'): Promise<void> {
    // Synchronously, before anything is awaited: the editor has already painted
    // this and must not be told about it again.
    this.#text = applyEdits(this.#text, edits)
    const seq = ++this.#seq

    const ack = await window.tephra.doc.edit({
      id: this.id,
      edits,
      origin,
      generation: this.#generation,
    })

    // Superseded: more edits were fired while this one was in flight, so this
    // ack describes a state that is already historical. The newest one governs.
    if (seq !== this.#seq) return

    if (ack.length !== this.#text.length) {
      // Main is authoritative. Continuing on a buffer that no longer describes
      // the document is how an edit lands in the wrong place later.
      this.#resync()
      throw new DesyncError(ack.length, this.#text.length)
    }

    this.#generation = ack.generation
    this.#spans = ack.spans
    this.#placement = ack.placement
  }

  // ── queries ────────────────────────────────────────────────

  spans(kind?: SpanKind): readonly TypedSpan[] {
    return kind === undefined ? this.#spans : this.#spans.filter(s => s.kind === kind)
  }

  spansAt(at: BufferPosition): readonly TypedSpan[] {
    const position = this.toDocument(at)
    const offset = position.offset as number
    return this.#spans.filter(
      s =>
        s.span.begin.segment === position.segment &&
        offset >= (s.span.begin.offset as number) &&
        offset <= (s.span.end.offset as number),
    )
  }

  snap(from: BufferPosition, to: BufferPosition): { from: BufferPosition; to: BufferPosition } {
    const text = this.#text
    const a = clamp(from as number, 0, text.length)
    const b = clamp(to as number, 0, text.length)
    const start = text.lastIndexOf('\n', a - 1) + 1
    const nl = text.indexOf('\n', b)
    return { from: start as BufferPosition, to: (nl === -1 ? text.length : nl + 1) as BufferPosition }
  }

  advance(from: BufferPosition, chars: number): BufferPosition | null {
    const next = (from as number) + chars
    return next < 0 || next > this.#text.length ? null : (next as BufferPosition)
  }

  distance(a: BufferPosition, b: BufferPosition): number {
    return (b as number) - (a as number)
  }

  // ── changes from elsewhere ─────────────────────────────────

  onChanged(handler: (edits: readonly BufferEdit[], origin: EditOrigin) => void): Unsubscribe {
    this.#changeHandlers.add(handler)
    return () => this.#changeHandlers.delete(handler)
  }

  onReset(handler: () => void): Unsubscribe {
    this.#resetHandlers.add(handler)
    return () => this.#resetHandlers.delete(handler)
  }

  /** Called by the document when main pushes a change for this window. */
  applyRemote(
    edits: readonly BufferEdit[],
    origin: EditOrigin,
    text: string,
    generation: SessionGeneration,
    spans: readonly TypedSpan[],
    placement: Placement,
  ): void {
    this.#text = text
    this.#generation = generation
    this.#spans = spans
    this.#placement = placement
    for (const handler of this.#changeHandlers) handler(edits, origin)
  }

  remoteReset(): void {
    for (const handler of this.#resetHandlers) handler()
  }

  #resync(): void {
    for (const handler of this.#resetHandlers) handler()
  }

  async extend(_direction: 'earlier' | 'later', _chars?: number): Promise<void> {
    throw new Error('extend arrives with Pane, in the next milestone')
  }

  release(): void {
    void window.tephra.doc.release(this.id)
    this.#changeHandlers.clear()
    this.#resetHandlers.clear()
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

export type { DateKey }
