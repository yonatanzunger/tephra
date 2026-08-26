// A loaded region of the stream, spanning one or more days.
//
// This is the whole editor-facing surface (D26) and the only code that knows
// both coordinate systems. In M0 it lives in main alongside Document; bullet 6
// splits it, keeping this half in the renderer so the synchronous methods stay
// synchronous across the process boundary (D37).
//
// A rendering affordance: it holds no history and owns nothing lost by closing.

import type {
  WindowEdit, WindowPosition, DateKey, Document, DocumentChange, DocumentPosition,
  DocumentWindow, Edit, EditOrigin, DocumentOffset, SessionGeneration, Span, SpanKind,
  TypedSpan, Unsubscribe, ProseText, DocumentText,
} from '../../shared/document-api.ts'
import { compareDateKeys } from '../../shared/dates.ts'
import type { Segment } from './segment.ts'
import { documentText, inSegment, inWindow, stripHandles } from '../../shared/prose.ts'
import { minimalReplacement } from './text-edits.ts'
import type { WindowSnapshot } from '../../shared/ipc.ts'
import type { StreamDocument } from './stream-document.ts'

interface Placed {
  readonly segment: Segment
  /**
   * Where this segment starts in the buffer — a PROSE offset (D44). The buffer
   * holds prose; the segment's body holds document text; `segment.prose` crosses
   * between them, and this is the only place the two are added together.
   */
  readonly start: WindowPosition
}

export class StreamWindow implements DocumentWindow {
  readonly #doc: StreamDocument
  #segments: Segment[]
  #placed: Placed[] = []
  #text = '' as ProseText
  #generation: SessionGeneration

  readonly #changeHandlers = new Set<(edits: readonly WindowEdit[], origin: EditOrigin) => void>()
  readonly #resetHandlers = new Set<() => void>()
  readonly #spansHandlers = new Set<() => void>()

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

  get text(): ProseText {
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
  toDocument(at: WindowPosition): DocumentPosition {
    const offset = Math.min(Math.max(0, at as number), this.#text.length)
    const placed = this.#placed[0] === undefined ? null : this.#segmentAt(offset)
    if (placed === null) return this.#doc.positionAt('' as DateKey, 0)
    return this.#doc.positionAt(
      placed.segment.date,
      placed.segment.prose.toDocument(inSegment(offset as WindowPosition, placed.start)),
    )
  }

  toWindow(at: DocumentPosition): WindowPosition | null {
    for (const placed of this.#placed) {
      if (placed.segment.date === at.segment) {
        return inWindow(placed.start, placed.segment.prose.toProse(at.offset))
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
  async edit(edits: readonly WindowEdit[], origin: EditOrigin = 'user'): Promise<void> {
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
  #toDocumentEdits(edits: readonly WindowEdit[]): Edit[] {
    const out: Edit[] = []
    for (const edit of edits) {
      const from = Math.min(edit.from as number, edit.to as number)
      const to = Math.max(edit.from as number, edit.to as number)

      // A PURE INSERTION resolves to exactly one segment, by the same rule
      // toDocument uses. Letting the range logic below handle it matched BOTH
      // segments at a boundary and put the text in the earlier one — so the
      // caret sat at the start of today while what was typed went into
      // yesterday's file. Two implementations of one convention is one too many.
      // Handles are the editor's, not the file's, and may not be written into
      // it — a paste carrying one would otherwise put U+FFFC in the corpus.
      const insert = stripHandles(edit.insert)

      if (from === to) {
        const placed = this.#segmentAt(from)
        // Leftmost, which is the trailing-boundary rule: text typed at the end
        // of a tagged range lands INSIDE it, so continuing a tagged sentence
        // keeps the subject (D44).
        const local = placed.segment.prose.toDocument(inSegment(from as WindowPosition, placed.start))
        out.push({
          span: {
            begin: this.#doc.positionAt(placed.segment.date, local),
            end: this.#doc.positionAt(placed.segment.date, local),
          },
          payload: documentText(insert),
        })
        continue
      }

      const touched = this.#placed.filter(p => from < p.start + p.segment.prose.text.length && to > p.start)
      const spans = touched.length > 0 ? touched : [this.#segmentAt(from)]

      let payloadPlaced = false
      for (const placed of spans) {
        const segmentEnd = placed.start + placed.segment.prose.text.length
        const localFrom = inSegment(Math.max(from, placed.start) as WindowPosition, placed.start)
        const localTo = inSegment(Math.min(to, segmentEnd) as WindowPosition, placed.start)
        if (localFrom > localTo) continue

        // In document offsets, then carved around any range-end marker inside it. An
        // ordinary deletion sweeping past the end of a tagged range would
        // otherwise take the `tag-end` with it, and an unmatched `tag-start`
        // runs to the end of its DAY — so deleting a sentence would silently
        // tag everything after it. Handles are deliberately NOT carved out:
        // deleting one means "remove this tag", which X turns into the removal
        // of both markers (D44).
        const prose = placed.segment.prose
        for (const piece of prose.carve(prose.toDocument(localFrom), prose.toDocument(localTo))) {
          // The inserted text goes to the first piece of the first touched
          // segment; everything after it only loses text.
          const payload = payloadPlaced ? ('' as DocumentText) : documentText(insert)
          payloadPlaced = true
          out.push({
            span: {
              begin: this.#doc.positionAt(placed.segment.date, piece.from),
              end: this.#doc.positionAt(placed.segment.date, piece.to),
            },
            payload,
          })
        }
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

  spansAt(at: WindowPosition): readonly TypedSpan[] {
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
        // Through the document's mapping, not a copy of it. The copy that used
        // to live here ended in a `{ kind: 'tag' }` fallthrough, so comments
        // arrived as tags the day comments existed.
        out.push(this.#doc.typed(placed.segment.date, s))
      }
    }
    return out
  }

  snap(from: WindowPosition, to: WindowPosition): { from: WindowPosition; to: WindowPosition } {
    const text = this.#text
    const a = Math.min(Math.max(0, from as number), text.length)
    const b = Math.min(Math.max(0, to as number), text.length)
    const lineStart = text.lastIndexOf('\n', a - 1) + 1
    const nl = text.indexOf('\n', b)
    const lineEnd = nl === -1 ? text.length : nl + 1
    return { from: lineStart as WindowPosition, to: lineEnd as WindowPosition }
  }

  advance(from: WindowPosition, chars: number): WindowPosition | null {
    const next = (from as number) + chars
    if (next < 0 || next > this.#text.length) return null
    return next as WindowPosition
  }

  distance(a: WindowPosition, b: WindowPosition): number {
    return (b as number) - (a as number)
  }

  // ── changes from elsewhere ─────────────────────────────────

  onChanged(handler: (edits: readonly WindowEdit[], origin: EditOrigin) => void): Unsubscribe {
    this.#changeHandlers.add(handler)
    return () => this.#changeHandlers.delete(handler)
  }

  /**
   * Here the spans are derived from the segments on every call, so they change
   * exactly when the text does — including for changes this window originated,
   * which is the case the renderer's half has to work harder for.
   */
  onSpansChanged(handler: () => void): Unsubscribe {
    this.#spansHandlers.add(handler)
    return () => this.#spansHandlers.delete(handler)
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
    for (const handler of this.#spansHandlers) handler()
    if (this.#originating) return

    // **The buffer is told what its PROSE did, not what the document did.**
    //
    // A document edit carries document text — `<!--tephra:tag-start …-->` — and
    // a span in document offsets. Handing those to the editor inserts marker syntax
    // into a buffer that holds prose, and maps the span through a mapping that
    // has already changed underneath it. Both happened at once: applying a tag
    // put the comment on screen as literal text AND duplicated the sentence it
    // covered, because `from` and `to` had collapsed to one place while the
    // payload was still the document's insertion.
    //
    // Diffing the two prose texts cannot make either mistake, since it never
    // consults the document's coordinates at all. Only changes this window did
    // NOT originate reach here — typing returns above — so this is off the
    // typing path.
    //
    // **ALWAYS announced, even when the prose is identical.** The edits say how
    // the text moved; they do not say whether anything moved. A rename changes
    // a marker's NAME, which is invisible in prose — same handle, same
    // character — so the diff is null and the early return that used to be here
    // sent nothing at all. The file was right, the renderer went on showing the
    // old subject, and clicking the mark reported it. Everything downstream is
    // built to be told the whole state and to notice for itself what changed:
    // an empty edit list is a no-op for the buffer, and the span comparison is
    // a no-op when the spans match.
    const replacement = minimalReplacement(before, this.#text)
    const edits: WindowEdit[] =
      replacement === null
        ? []
        : [
            {
              from: replacement.from as WindowPosition,
              to: replacement.to as WindowPosition,
              insert: replacement.insert,
            },
          ]
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
    // PROSE, not bodies. The buffer holds prose (D44), and a day arriving from
    // the corpus is the same as any other text reaching the editor: its marker
    // syntax is not text. Inserting `s.body` here put `<!--tephra:…-->` on
    // screen for every day loaded by growth — which is every day but the one
    // being written, so it appeared on opening a notebook that already had
    // history and nowhere else.
    const insert = ordered.map(s => s.prose.text).join('') as ProseText
    const at = direction === 'earlier' ? 0 : this.#text.length

    this.#segments = direction === 'earlier' ? [...ordered, ...this.#segments] : [...this.#segments, ...ordered]
    this.#rebuild()
    await this.refreshBoundaries()

    const edit: WindowEdit = { from: at as WindowPosition, to: at as WindowPosition, insert }
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
   * The renderer's half of this window needs it to answer toDocument/toWindow
   * synchronously across the process boundary — that mapping is the whole of
   * what makes those methods cheap, and it is small enough to send on every
   * change.
   */
  /**
   * What this window is actually holding, for a self-check to compare against
   * the document's own view of the same days.
   *
   * Asked AFTER a failure rather than logged during one: the fault it exists to
   * find is a race, and a `console.log` on the path was enough to make it stop
   * happening.
   */
  diagnose(): readonly { date: string; document: number; prose: number; same: boolean }[] {
    return this.#placed.map(p => ({
      date: p.segment.date as string,
      document: p.segment.length,
      prose: p.segment.prose.text.length,
      // The identity that matters: is the object this window rebuilds from the
      // same one the document mutates?
      same: this.#doc.heldSegment(p.segment.date) === p.segment,
    }))
  }

  placement(): WindowSnapshot['placement'] {
    return this.#placed.map(p => ({
      date: p.segment.date,
      start: p.start,
      length: p.segment.length,
      markers: p.segment.prose.markers,
    }))
  }

  // ── internals ──────────────────────────────────────────────

  #rebuild(): void {
    const placed: Placed[] = []
    const parts: string[] = []
    let start = 0
    for (const segment of this.#segments) {
      placed.push({ segment, start: start as WindowPosition })
      parts.push(segment.prose.text)
      start += segment.prose.text.length
    }
    this.#placed = placed
    this.#text = parts.join('') as ProseText
  }
}

export type { DocumentOffset }
