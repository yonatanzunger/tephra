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
import { compareDateKeys } from '../../shared/dates.ts'
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

  #edges = { earlier: false, later: false }

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
    const placed = this.#placed[0] === undefined ? null : this.#segmentAt(offset)
    if (placed === null) return this.#doc.positionAt('' as DateKey, 0)
    return this.#doc.positionAt(placed.segment.date, offset - placed.start)
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

      // A PURE INSERTION resolves to exactly one segment, by the same rule
      // toDocument uses. Letting the range logic below handle it matched BOTH
      // segments at a boundary and put the text in the earlier one — so the
      // caret sat at the start of today while what was typed went into
      // yesterday's file. Two implementations of one convention is one too many.
      if (from === to) {
        const placed = this.#segmentAt(from)
        const local = from - placed.start
        out.push({
          span: {
            begin: this.#doc.positionAt(placed.segment.date, local),
            end: this.#doc.positionAt(placed.segment.date, local),
          },
          payload: edit.insert,
        })
        continue
      }

      const touched = this.#placed.filter(p => from < p.start + p.segment.length && to > p.start)
      const spans = touched.length > 0 ? touched : [this.#segmentAt(from)]

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

  /**
   * The one implementation of the boundary convention: a buffer offset on a
   * segment boundary belongs to the LATER segment, and the end of the whole
   * window belongs to the last one. toDocument reads from here too.
   */
  #segmentAt(offset: number): Placed {
    const at = Math.min(Math.max(0, offset), this.#text.length)
    for (let i = this.#placed.length - 1; i >= 0; i--) {
      const placed = this.#placed[i] as Placed
      if (at >= placed.start) return placed
    }
    return this.#placed[0] as Placed
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

    // My text changed, but none of the change's edits could be expressed in my
    // coordinates. That should not happen — and if it does, sending an empty
    // edit list is the one response that cannot fix it: the renderer skips
    // empty lists, so the editor's buffer would stay at the old text while
    // RemoteWindow's copy moved to the new one. The next keystroke would then
    // be computed against a buffer nobody else believes in, and the length
    // check would turn it into a DesyncError several steps from the cause.
    //
    // A reset is the honest answer: expensive, rare, and correct.
    if (edits.length === 0) {
      for (const handler of this.#resetHandlers) handler()
      return
    }
    for (const handler of this.#changeHandlers) handler(edits, change.origin)
  }

  reset(): void {
    this.#rebuild()
    for (const handler of this.#resetHandlers) handler()
  }

  /**
   * Grow the loaded region by roughly `chars` characters.
   *
   * Emitted as an ORDINARY CHANGE, not a reset. A prepend is an insertion at
   * offset zero, and letting the editor apply it as such is what makes the
   * cursor and the scroll position survive — CodeMirror maps the selection
   * through an insertion for free, where replacing the whole document throws
   * both away. Scroll anchoring on prepend is the fiddly part of every
   * upward-infinite-scroll ever written; this sidesteps it rather than solving
   * it, and only because option 1 makes extension explicit and rare.
   *
   * Days are found through the corpus's date list rather than by walking the
   * calendar: an empty year between two entries would otherwise be 365 reads.
   */
  async extend(direction: 'earlier' | 'later', chars = 20_000): Promise<void> {
    const loaded = this.#placed.map(p => p.segment.date)
    const first = loaded[0]
    const last = loaded[loaded.length - 1]
    if (first === undefined || last === undefined) return

    const all = await this.#doc.dates()
    const candidates =
      direction === 'earlier'
        ? all.filter(d => compareDateKeys(d, first) < 0).reverse()
        : all.filter(d => compareDateKeys(d, last) > 0)

    const added: Segment[] = []
    let gathered = 0
    for (const date of candidates) {
      if (gathered >= chars) break
      const segment = await this.#doc.segment(date)
      added.push(segment)
      gathered += segment.length
    }
    if (added.length === 0) return

    const ordered = direction === 'earlier' ? [...added].reverse() : added
    const insert = ordered.map(s => s.body).join('')
    const at = direction === 'earlier' ? 0 : this.#text.length

    this.#segments = direction === 'earlier' ? [...ordered, ...this.#segments] : [...this.#segments, ...ordered]
    this.#rebuild()
    await this.refreshBoundaries()

    const edit: BufferEdit = { from: at as BufferPosition, to: at as BufferPosition, insert }
    for (const handler of this.#changeHandlers) handler([edit], 'external')
  }

  /**
   * What lies beyond each edge, so the UI can offer the right affordance.
   *
   * SYNCHRONOUS, reading a value refreshed when the region changes. Making it
   * async pushed every change notification onto a later tick, which turned the
   * whole change feed asynchronous for the sake of one boolean pair — a large
   * behavioural change bought with nothing. Worst case here is a stale edge
   * affordance for a moment, which costs a click.
   */
  get boundaries(): { earlier: boolean; later: boolean } {
    return this.#edges
  }

  async refreshBoundaries(): Promise<void> {
    const loaded = this.#placed.map(p => p.segment.date)
    const first = loaded[0]
    const last = loaded[loaded.length - 1]
    if (first === undefined || last === undefined) {
      this.#edges = { earlier: false, later: false }
      return
    }
    const all = await this.#doc.dates()
    this.#edges = {
      earlier: all.some(d => compareDateKeys(d, first) < 0),
      later: all.some(d => compareDateKeys(d, last) > 0),
    }
  }

  release(): void {
    this.#doc.releaseWindow(this)
    this.#changeHandlers.clear()
    this.#resetHandlers.clear()
  }

  /**
   * Where each segment's body sits in the buffer.
   *
   * The renderer's half of this window needs it to answer toDocument/toBuffer
   * synchronously across the process boundary — that mapping is the whole of
   * what makes those methods cheap, and it is small enough to send on every
   * change.
   */
  placement(): readonly { date: DateKey; start: number; length: number }[] {
    return this.#placed.map(p => ({ date: p.segment.date, start: p.start, length: p.segment.length }))
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
