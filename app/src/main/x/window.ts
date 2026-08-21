// A loaded region of the stream, spanning one or more days.
//
// This is the whole editor-facing surface (D26) and the only code that knows
// both coordinate systems. In M0 it lives in main alongside Document; bullet 6
// splits it, keeping this half in the renderer so the synchronous methods stay
// synchronous across the process boundary (D37).
//
// A rendering affordance: it holds no history and owns nothing lost by closing.

import type {
  BufferEdit, BufferPosition, DateKey, Document, DocumentChange, DocumentPosition,
  DocumentWindow, Edit, EditOrigin, Offset, SessionGeneration, Span, SpanKind,
  TypedSpan, Unsubscribe,
} from '../../shared/document-api.ts'
import type { Segment } from './segment.ts'
import type { StreamDocument } from './stream-document.ts'

interface Placed {
  readonly segment: Segment
  /** Where this segment's body starts in the buffer. */
  readonly start: number
}

export class StreamWindow implements DocumentWindow {
  readonly #doc: StreamDocument
  #segments: Segment[]
  #placed: Placed[] = []
  #text = ''
  #generation: SessionGeneration

  readonly #changeHandlers = new Set<(edits: readonly BufferEdit[], origin: EditOrigin) => void>()
  readonly #resetHandlers = new Set<() => void>()

  /** Set while this window is the origin of a change, to suppress its own echo. */
  #originating = false

  constructor(doc: StreamDocument, segments: readonly Segment[]) {
    this.#doc = doc
    this.#segments = [...segments]
    this.#generation = doc.generation
    this.#rebuild()
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
    const first = this.#placed[0]
    const last = this.#placed[this.#placed.length - 1]
    if (first === undefined || last === undefined) {
      const today = this.#doc.positionAt('' as DateKey, 0)
      return { begin: today, end: today }
    }
    return {
      begin: this.#doc.positionAt(first.segment.date, 0),
      end: this.#doc.positionAt(last.segment.date, last.segment.length),
    }
  }

  // ── coordinates ────────────────────────────────────────────

  /**
   * Both units are UTF-16 code units, so this is addition (D24).
   *
   * A buffer position on a day boundary is ambiguous — it is both the end of
   * the earlier day and the start of the later one. It resolves to the START OF
   * THE LATER day, and the reason is what the reader can see.
   *
   * A day's body almost always ends with a newline, so the boundary offset sits
   * immediately after it — which renders as the first column of the later day's
   * first line. Text typed there appears to begin that day. Filing it in the
   * earlier day would store it in yesterday's file while showing it under
   * today's heading, and no amount of correctness elsewhere survives that.
   *
   * The end of the whole window is unaffected: there is no later segment, so it
   * belongs to the last one, which is what makes appending work.
   */
  toDocument(at: BufferPosition): DocumentPosition {
    const offset = Math.min(Math.max(0, at as number), this.#text.length)
    for (let i = this.#placed.length - 1; i >= 0; i--) {
      const placed = this.#placed[i] as Placed
      if (offset >= placed.start) {
        return this.#doc.positionAt(placed.segment.date, offset - placed.start)
      }
    }
    const first = this.#placed[0]
    return this.#doc.positionAt(first?.segment.date ?? ('' as DateKey), 0)
  }

  toBuffer(at: DocumentPosition): BufferPosition | null {
    for (const placed of this.#placed) {
      if (placed.segment.date === at.segment) {
        return (placed.start + (at.offset as number)) as BufferPosition
      }
    }
    return null
  }

  // ── editing ────────────────────────────────────────────────

  /**
   * TIMING CONTRACT (D37): this window's buffer is updated synchronously before
   * returning; the promise resolves when the change is durable. An editor fires
   * and does not await, but a rejection is a real failure and must surface.
   */
  async edit(edits: readonly BufferEdit[], origin: EditOrigin = 'user'): Promise<void> {
    const documentEdits = this.#toDocumentEdits(edits)
    this.#originating = true
    try {
      await this.#doc.replace(documentEdits, origin)
    } finally {
      this.#originating = false
    }
  }

  /**
   * Translate buffer edits into document space, splitting any that cross a day
   * boundary. A single deletion sweeping across midnight is two edits, one per
   * file, and getting that wrong writes half of it to the wrong day.
   */
  #toDocumentEdits(edits: readonly BufferEdit[]): Edit[] {
    const out: Edit[] = []
    for (const edit of edits) {
      const from = Math.min(edit.from as number, edit.to as number)
      const to = Math.max(edit.from as number, edit.to as number)

      const touched = this.#placed.filter(p => {
        const end = p.start + p.segment.length
        return from < end && to > p.start ? true : from === to && from >= p.start && from <= end
      })
      const spans = touched.length > 0 ? touched : [this.#placed[this.#placed.length - 1] as Placed]

      let payloadPlaced = false
      for (const placed of spans) {
        const segmentEnd = placed.start + placed.segment.length
        const localFrom = Math.max(from, placed.start) - placed.start
        const localTo = Math.min(to, segmentEnd) - placed.start
        if (localFrom > localTo) continue
        // The inserted text goes to the first touched segment; later segments in
        // a crossing edit only lose their prefix.
        const payload = payloadPlaced ? '' : edit.insert
        payloadPlaced = true
        out.push({
          span: {
            begin: this.#doc.positionAt(placed.segment.date, localFrom),
            end: this.#doc.positionAt(placed.segment.date, localTo),
          },
          payload,
        })
      }
    }
    return out
  }

  // ── queries ────────────────────────────────────────────────

  spansAt(at: BufferPosition): readonly TypedSpan[] {
    const position = this.toDocument(at)
    return this.spans().filter(
      s =>
        s.span.begin.segment === position.segment &&
        (position.offset as number) >= (s.span.begin.offset as number) &&
        (position.offset as number) <= (s.span.end.offset as number),
    )
  }

  spans(kind?: SpanKind): readonly TypedSpan[] {
    const out: TypedSpan[] = []
    for (const placed of this.#placed) {
      for (const s of placed.segment.spans()) {
        if (kind !== undefined && s.kind !== kind) continue
        const span: Span = {
          begin: this.#doc.positionAt(placed.segment.date, s.from),
          end: this.#doc.positionAt(placed.segment.date, s.to),
        }
        out.push(
          s.kind === 'heading'
            ? { kind: 'heading', name: s.name, level: s.level, span }
            : s.kind === 'date'
              ? { kind: 'date', name: placed.segment.date, span }
              : s.kind === 'anchor'
                ? { kind: 'anchor', name: s.name, span }
                : { kind: 'tag', name: s.name, span },
        )
      }
    }
    return out
  }

  snap(from: BufferPosition, to: BufferPosition): { from: BufferPosition; to: BufferPosition } {
    const text = this.#text
    const a = Math.min(Math.max(0, from as number), text.length)
    const b = Math.min(Math.max(0, to as number), text.length)
    const lineStart = text.lastIndexOf('\n', a - 1) + 1
    const nl = text.indexOf('\n', b)
    const lineEnd = nl === -1 ? text.length : nl + 1
    return { from: lineStart as BufferPosition, to: lineEnd as BufferPosition }
  }

  advance(from: BufferPosition, chars: number): BufferPosition | null {
    const next = (from as number) + chars
    if (next < 0 || next > this.#text.length) return null
    return next as BufferPosition
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

  /**
   * ECHO SUPPRESSION: a window is never told about a change it originated. The
   * editor has already applied it locally, and re-applying is exactly how text
   * gets duplicated.
   */
  documentChanged(change: DocumentChange): void {
    const before = this.#text
    this.#rebuild()
    this.#generation = change.to
    if (this.#originating) return

    const edits: BufferEdit[] = []
    for (const edit of change.edits) {
      const from = this.toBuffer(edit.span.begin)
      const to = this.toBuffer(edit.span.end)
      if (from === null || to === null) continue // landed outside this window
      edits.push({ from, to, insert: edit.payload })
    }
    if (edits.length === 0 && before === this.#text) return
    for (const handler of this.#changeHandlers) handler(edits, change.origin)
  }

  reset(): void {
    this.#rebuild()
    for (const handler of this.#resetHandlers) handler()
  }

  async extend(_direction: 'earlier' | 'later', _chars?: number): Promise<void> {
    throw new Error('extend arrives with Pane, in the next milestone')
  }

  release(): void {
    this.#doc.releaseWindow(this)
    this.#changeHandlers.clear()
    this.#resetHandlers.clear()
  }

  // ── internals ──────────────────────────────────────────────

  #rebuild(): void {
    const placed: Placed[] = []
    const parts: string[] = []
    let start = 0
    for (const segment of this.#segments) {
      placed.push({ segment, start })
      parts.push(segment.body)
      start += segment.length
    }
    this.#placed = placed
    this.#text = parts.join('')
  }
}

export type { Offset }
