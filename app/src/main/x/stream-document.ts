// The stream as one logical document (D8), over day files.
//
// Naive by intention, for M0: no split into parts, no WAL, no git. What it does
// implement faithfully is the SHAPE — generation, batched replace, document-
// scoped undo, spans inferred from the text — because the point of this
// milestone is to find out whether the shape is right before building on it.

import type {
  DateKey, Document, DocumentChange, DocumentId, DocumentMeta, DocumentPosition,
  DocumentWindow, Edit, EditOrigin, Offset, SegmentKey, SessionGeneration, Span,
  SpanKind, TypedSpan, Unsubscribe, Divergence,
} from '../../shared/document-api.ts'
import { addDays, compareDateKeys, dateKeyAt } from '../../shared/dates.ts'
import { StalePositionError, offsetOf } from '../../shared/positions.ts'
import type { Notebook } from '../w/notebook.ts'
import { dayFile, parseDayFile } from '../w/layout.ts'
import { frontmatterFor, parseFile, renderFrontmatter } from './frontmatter.ts'
import { Segment } from './segment.ts'
import { applyEdits, invertEdits, mapOffset, minimalReplacement, type TextEdit } from './text-edits.ts'
import { StreamWindow } from './window.ts'

/** One undo step: what happened, and what puts it back. */
interface HistoryEntry {
  readonly change: DocumentChange
  /** Per segment, expressed against the POST-edit body. */
  readonly inverse: ReadonlyMap<DateKey, TextEdit[]>
}

const GROUPING_WINDOW_MS = 1_500

export class StreamDocument implements Document {
  readonly id = 'stream' as DocumentId
  readonly meta: DocumentMeta = { kind: 'stream' }

  readonly #notebook: Notebook
  readonly #segments = new Map<DateKey, Segment>()
  #generation = 1 as SessionGeneration

  readonly #undo: HistoryEntry[] = []
  readonly #redo: HistoryEntry[] = []
  #lastUserEditAt = 0

  readonly #changeHandlers = new Set<(c: DocumentChange) => void>()
  readonly #divergeHandlers = new Set<(d: Divergence) => void>()

  /** Windows that need telling when something else changes the text. */
  readonly #windows = new Set<StreamWindow>()

  constructor(notebook: Notebook) {
    this.#notebook = notebook
  }

  get generation(): SessionGeneration {
    return this.#generation
  }

  get isDirty(): boolean {
    return [...this.#segments.values()].some(s => s.dirty)
  }

  currentGeneration(): SessionGeneration {
    return this.#generation
  }

  // ── segments ───────────────────────────────────────────────

  /** Load a day, creating an in-memory empty one if the file does not exist. */
  async segment(date: DateKey): Promise<Segment> {
    const held = this.#segments.get(date)
    if (held !== undefined) return held

    const rel = dayFile(date)
    const text = await this.#notebook.read(rel)
    const segment =
      text === null
        ? Segment.empty(date, rel, renderFrontmatter(frontmatterFor(date, 'stream')))
        : Segment.load(date, rel, text)
    this.#segments.set(date, segment)
    return segment
  }

  /** Every date with a file on disk, ascending. A scan; never on the hot path. */
  async dates(): Promise<readonly DateKey[]> {
    const found: DateKey[] = []
    for (const rel of await this.#notebook.list('stream')) {
      const ref = parseDayFile(rel)
      if (ref !== null && ref.part === 1) found.push(ref.date)
    }
    for (const [date, segment] of this.#segments) {
      if (segment.dirty && !found.includes(date)) found.push(date)
    }
    return found.sort(compareDateKeys)
  }

  async extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null> {
    const dates = await this.dates()
    if (dates.length === 0) return null
    return { first: dates[0] as DateKey, last: dates[dates.length - 1] as DateKey }
  }

  // ── reading ────────────────────────────────────────────────

  async read(span: Span, at?: SessionGeneration): Promise<DocumentWindow> {
    if (at !== undefined && at !== this.#generation) {
      // v1 serves only the current generation. The parameter exists so that
      // diffing and the divergence picker need no API change later.
      throw new StalePositionError(this.#generation, at)
    }

    const first = span.begin.segment as DateKey
    const last = span.end.segment as DateKey
    const dates: DateKey[] = []
    for (let d = first; compareDateKeys(d, last) <= 0; d = addDays(d, 1)) dates.push(d)
    if (dates.length === 0) dates.push(first)

    const segments: Segment[] = []
    for (const date of dates) segments.push(await this.segment(date))

    const window = new StreamWindow(this, segments)
    await window.refreshBoundaries()
    this.#windows.add(window)
    return window
  }

  async snap(span: Span): Promise<Span> {
    const begin = await this.segment(span.begin.segment as DateKey)
    const end = await this.segment(span.end.segment as DateKey)
    return {
      begin: this.#positionAt(span.begin.segment, snapBack(begin.body, span.begin.offset)),
      end: this.#positionAt(span.end.segment, snapForward(end.body, span.end.offset)),
    }
  }

  async advance(from: DocumentPosition, chars: number): Promise<DocumentPosition | null> {
    let date = from.segment as DateKey
    let remaining = chars + (from.offset as number)
    const extent = await this.extent()
    if (extent === null) return null

    // Walk forwards or backwards across days until the count is used up.
    for (;;) {
      const segment = await this.segment(date)
      if (remaining >= 0 && remaining <= segment.length) {
        return this.#positionAt(date, remaining)
      }
      if (remaining < 0) {
        if (compareDateKeys(date, extent.first) <= 0) return null
        date = addDays(date, -1)
        remaining += (await this.segment(date)).length
      } else {
        if (compareDateKeys(date, extent.last) >= 0) return null
        remaining -= segment.length
        date = addDays(date, 1)
      }
    }
  }

  async distance(a: DocumentPosition, b: DocumentPosition): Promise<number | null> {
    const [lo, hi] = compareDateKeys(a.segment as DateKey, b.segment as DateKey) <= 0 ? [a, b] : [b, a]
    let total = -(lo.offset as number)
    for (let d = lo.segment as DateKey; compareDateKeys(d, hi.segment as DateKey) < 0; d = addDays(d, 1)) {
      total += (await this.segment(d)).length
    }
    total += hi.offset as number
    const sign = lo === a ? 1 : -1
    return total * sign
  }

  // ── spans ──────────────────────────────────────────────────

  async spans(kind?: SpanKind): Promise<readonly TypedSpan[]> {
    const out: TypedSpan[] = []
    for (const date of await this.dates()) {
      const segment = await this.segment(date)
      for (const s of segment.spans()) {
        if (kind !== undefined && s.kind !== kind) continue
        out.push(this.#typed(date, s))
      }
    }
    return out
  }

  async spansAt(at: DocumentPosition): Promise<readonly TypedSpan[]> {
    const date = at.segment as DateKey
    const segment = await this.segment(date)
    const offset = at.offset as number
    return segment
      .spans()
      .filter(s => offset >= s.from && offset <= s.to)
      .map(s => this.#typed(date, s))
  }

  async resolveAnchor(name: string): Promise<DocumentPosition | null> {
    for (const date of await this.dates()) {
      const found = (await this.segment(date)).anchorAt(name)
      if (found !== null) return this.#positionAt(date, found)
    }
    return null
  }

  dateAt(at: DocumentPosition): DateKey | null {
    // Synchronous, because in the stream the segment IS the date (D27).
    return at.segment as DateKey
  }

  // ── changes made outside the app ───────────────────────────

  /**
   * A file changed on disk. Hand-editing is a feature, so this needs no
   * ceremony (D32): reload, emit an ordinary change with origin 'external',
   * and let the editor map its cursor through it like any other edit.
   *
   * The one hard case is a hand-edit landing on a buffer we have unsaved edits
   * to. That is divergence, and it is surfaced rather than resolved (D12) —
   * both automatic answers lose something.
   */
  async externalChanged(rel: string): Promise<void> {
    const ref = parseDayFile(rel)
    if (ref === null || ref.part !== 1) return

    const segment = this.#segments.get(ref.date)
    if (segment === undefined) return // not loaded; the next read gets it fresh

    const text = await this.#notebook.read(rel)
    const theirs = text === null ? '' : parseFile(text).body
    if (theirs === segment.body) return // same content, nothing to say

    if (segment.dirty) {
      segment.markDiverged()
      for (const handler of this.#divergeHandlers) {
        handler({ ours: segment.body, theirs, date: ref.date })
      }
      return
    }

    // A minimal replacement rather than a wholesale reset: it keeps the change
    // small, and it is what lets a cursor elsewhere in the day survive.
    const replacement = minimalReplacement(segment.body, theirs)
    if (text !== null) segment.adopt(text)
    else segment.setBody('')
    if (replacement === null) return

    const from = this.#generation
    this.#generation = (from + 1) as SessionGeneration
    const change: DocumentChange = {
      from,
      to: this.#generation,
      edits: [
        {
          span: {
            begin: this.#positionAt(ref.date, replacement.from),
            end: this.#positionAt(ref.date, replacement.to),
          },
          payload: replacement.insert,
        },
      ],
      origin: 'external',
      at: Date.now(),
    }
    for (const handler of this.#changeHandlers) handler(change)
    for (const window of this.#windows) window.documentChanged(change)
  }

  /** Days whose disk copy and buffer disagree, and which are not being written. */
  divergedDates(): readonly DateKey[] {
    return [...this.#segments.entries()].filter(([, s]) => s.diverged).map(([date]) => date)
  }

  // ── writing ────────────────────────────────────────────────

  async replace(edits: readonly Edit[], origin: EditOrigin = 'operation'): Promise<void> {
    if (edits.length === 0) return
    for (const edit of edits) {
      if (edit.span.begin.generation !== this.#generation) {
        throw new StalePositionError(this.#generation, edit.span.begin.generation)
      }
    }
    await this.#applyAndRecord(edits, origin, true)
  }

  /** Shared by replace, undo and rewind. `record` is false when replaying history. */
  async #applyAndRecord(
    edits: readonly Edit[],
    origin: EditOrigin,
    record: boolean,
  ): Promise<DocumentChange> {
    const perSegment = new Map<DateKey, TextEdit[]>()
    for (const edit of edits) {
      const date = edit.span.begin.segment as DateKey
      if (edit.span.end.segment !== date) {
        // A span crossing a day boundary is split by the window before it gets
        // here; anything else is a caller error rather than something to patch
        // up silently.
        throw new Error('an Edit may not cross a segment boundary')
      }
      const list = perSegment.get(date) ?? []
      list.push({ from: edit.span.begin.offset as number, to: edit.span.end.offset as number, insert: edit.payload })
      perSegment.set(date, list)
    }

    const inverse = new Map<DateKey, TextEdit[]>()
    for (const [date, list] of perSegment) {
      const segment = await this.segment(date)
      if (segment.readOnly) {
        throw new Error(`${segment.rel} has frontmatter that could not be parsed; it is not rewritten`)
      }
      if (segment.diverged) {
        throw new Error(`${segment.rel} changed on disk while you were editing it; it is not being written`)
      }
      const sorted = [...list].sort((a, b) => a.from - b.from)
      inverse.set(date, invertEdits(segment.body, sorted))
      segment.setBody(applyEdits(segment.body, sorted))
    }

    const from = this.#generation
    this.#generation = (from + 1) as SessionGeneration
    const change: DocumentChange = {
      from,
      to: this.#generation,
      edits,
      origin,
      at: Date.now(),
    }

    if (record && origin !== 'external') {
      this.#push({ change, inverse }, origin)
      this.#redo.length = 0
    }

    for (const handler of this.#changeHandlers) handler(change)
    for (const window of this.#windows) window.documentChanged(change)
    return change
  }

  /**
   * Grouping is by origin and adjacency: a typed sentence is one undo step, and
   * an applied tag is its own. Without it, undo is per-keystroke and useless.
   */
  #push(entry: HistoryEntry, origin: EditOrigin): void {
    const now = entry.change.at
    const previous = this.#undo[this.#undo.length - 1]
    const groupable =
      origin === 'user' &&
      previous !== undefined &&
      previous.change.origin === 'user' &&
      now - this.#lastUserEditAt < GROUPING_WINDOW_MS

    if (groupable) {
      // Merge: keep the earlier `from` and the later inverse, applied first.
      const merged = new Map(entry.inverse)
      for (const [date, list] of previous.inverse) {
        merged.set(date, [...(merged.get(date) ?? []), ...list])
      }
      this.#undo[this.#undo.length - 1] = {
        change: { ...entry.change, from: previous.change.from },
        inverse: merged,
      }
    } else {
      this.#undo.push(entry)
    }
    if (origin === 'user') this.#lastUserEditAt = now
  }

  // ── history ────────────────────────────────────────────────

  /**
   * NON-DESTRUCTIVE: a rewind is itself a new change, emitted forward, so
   * generations only ever increase and nothing is discarded (D29).
   */
  async rewindTo(to: SessionGeneration): Promise<DocumentChange | null> {
    if (to === this.#generation) return null
    if (to > this.#generation) throw new StalePositionError(this.#generation, to)

    const reachable = this.#undo.some(e => e.change.from === to) || to === this.#undo[0]?.change.from
    if (!reachable && this.#undo.length > 0 && to < (this.#undo[0] as HistoryEntry).change.from) {
      // Bounded by the session: the undo stack is memory-only (D32), so a
      // generation from before this process started is simply unreachable.
      throw new StalePositionError((this.#undo[0] as HistoryEntry).change.from, to)
    }

    let last: DocumentChange | null = null
    while (this.#generation > to && this.#undo.length > 0) {
      last = await this.#stepBack()
    }
    return last
  }

  async #stepBack(): Promise<DocumentChange | null> {
    const entry = this.#undo.pop()
    if (entry === undefined) return null

    const edits: Edit[] = []
    // Redo replays THIS, not the entry's original forward edits. Those were
    // recorded against a state that no longer exists once the undo has run, and
    // for a grouped typing run they describe only the last keystroke of the
    // group — `#push` merges the `inverse` maps but keeps only the newest
    // `change`. Replaying them threw `span 141..141 outside text of 135`.
    //
    // Deriving both directions here makes redo symmetric with undo by
    // construction: each is a minimal replacement between two texts we are
    // holding, in the coordinates the other side will actually see.
    const redoEdits: Edit[] = []
    for (const [date, list] of entry.inverse) {
      const segment = await this.segment(date)
      const before = segment.body
      const after = applyEdits(before, [...list].sort((a, b) => a.from - b.from))

      const undoing = minimalReplacement(before, after)
      if (undoing !== null) {
        edits.push({
          span: {
            begin: this.#positionAt(date, undoing.from),
            end: this.#positionAt(date, undoing.to),
          },
          payload: undoing.insert,
        })
      }

      // In `after` coordinates — the text redo will be applied to.
      const redoing = minimalReplacement(after, before)
      if (redoing !== null) {
        redoEdits.push({
          span: {
            begin: this.#positionAt(date, redoing.from),
            end: this.#positionAt(date, redoing.to),
          },
          payload: redoing.insert,
        })
      }
    }

    // `inverse` is carried through unchanged: after a redo the body is back to
    // its post-change state, which is exactly what that map transforms.
    this.#redo.push({ change: { ...entry.change, edits: redoEdits }, inverse: entry.inverse })
    if (edits.length === 0) return null
    return this.#applyAndRecord(edits, 'operation', false)
  }

  async undo(): Promise<DocumentChange | null> {
    return this.#stepBack()
  }

  async redo(): Promise<DocumentChange | null> {
    const entry = this.#redo.pop()
    if (entry === undefined) return null
    const change = await this.#applyAndRecord(entry.change.edits, entry.change.origin, false)
    this.#undo.push(entry)
    return change
  }

  async history(since?: SessionGeneration): Promise<readonly DocumentChange[]> {
    return this.#undo
      .map(e => e.change)
      .filter(c => since === undefined || c.to > since)
  }

  mapPosition(at: DocumentPosition, through: DocumentChange): DocumentPosition | null {
    const date = at.segment as DateKey
    const relevant = through.edits
      .filter(e => e.span.begin.segment === date)
      .map(e => ({
        from: e.span.begin.offset as number,
        to: e.span.end.offset as number,
        insert: e.payload,
      }))
      .sort((a, b) => a.from - b.from)
    const moved = mapOffset(at.offset as number, relevant)
    if (moved === null) return null
    return { segment: at.segment, offset: moved as Offset, generation: through.to }
  }

  // ── sugar, all of which compiles to replace ────────────────

  async tag(span: Span, subject: string): Promise<void> {
    await this.replace(
      [
        { span: { begin: span.end, end: span.end }, payload: `<!--tephra:tag-end ${subject}-->` },
        { span: { begin: span.begin, end: span.begin }, payload: `<!--tephra:tag-start ${subject}-->` },
      ].sort((a, b) => (a.span.begin.offset as number) - (b.span.begin.offset as number)),
      'operation',
    )
  }

  async untag(_span: Span, _subject: string): Promise<void> {
    throw new Error('untag is not implemented in M0')
  }

  async setAnchor(at: DocumentPosition, name: string): Promise<void> {
    await this.replace([{ span: { begin: at, end: at }, payload: `<!--tephra:mark ${name}-->` }], 'operation')
  }

  async removeAnchor(_name: string): Promise<void> {
    throw new Error('removeAnchor is not implemented in M0')
  }

  async branch(_span: Span, _name: string): Promise<DocumentId> {
    throw new Error('branch is not implemented in M0')
  }

  // ── change feed ────────────────────────────────────────────

  onChanged(handler: (change: DocumentChange) => void): Unsubscribe {
    this.#changeHandlers.add(handler)
    return () => this.#changeHandlers.delete(handler)
  }

  onDiverged(handler: (d: Divergence) => void): Unsubscribe {
    this.#divergeHandlers.add(handler)
    return () => this.#divergeHandlers.delete(handler)
  }

  releaseWindow(window: StreamWindow): void {
    this.#windows.delete(window)
  }

  // ── lifecycle ──────────────────────────────────────────────

  async flush(): Promise<void> {
    for (const segment of this.#segments.values()) {
      // A diverged segment is frozen: writing it would destroy the hand-edit
      // that caused the divergence, which is the one outcome nothing recovers.
      if (!segment.dirty || segment.readOnly || segment.diverged) continue
      const text = segment.serialise()
      await this.#notebook.write(segment.rel, text)
      segment.markClean(text)
    }
  }

  async reload(): Promise<void> {
    await this.flush()
    this.#segments.clear()
    this.#undo.length = 0
    this.#redo.length = 0
    for (const window of this.#windows) window.reset()
  }

  async release(): Promise<void> {
    await this.flush()
    this.#windows.clear()
    this.#changeHandlers.clear()
    this.#divergeHandlers.clear()
  }

  // ── helpers ────────────────────────────────────────────────

  #positionAt(segment: SegmentKey, offset: number): DocumentPosition {
    return { segment, offset: offset as Offset, generation: this.#generation }
  }

  positionAt(segment: SegmentKey, offset: number): DocumentPosition {
    return this.#positionAt(segment, offset)
  }

  #typed(date: DateKey, s: { kind: TypedSpan['kind']; name: string; level: number; from: number; to: number }): TypedSpan {
    const span: Span = { begin: this.#positionAt(date, s.from), end: this.#positionAt(date, s.to) }
    switch (s.kind) {
      case 'date':
        return { kind: 'date', name: date, span }
      case 'heading':
        return { kind: 'heading', name: s.name, level: s.level, span }
      case 'anchor':
        return { kind: 'anchor', name: s.name, span }
      case 'tag':
        return { kind: 'tag', name: s.name, span }
    }
  }

  /** The date a new note goes to, in the reference zone (D38). */
  static today(): DateKey {
    return dateKeyAt()
  }
}

/** Widen backwards to the start of the line. */
function snapBack(body: string, offset: Offset): number {
  const at = Math.min(Math.max(0, offset as number), body.length)
  const nl = body.lastIndexOf('\n', at - 1)
  return nl === -1 ? 0 : nl + 1
}

/** Widen forwards to the end of the line. */
function snapForward(body: string, offset: Offset): number {
  const at = Math.min(Math.max(0, offset as number), body.length)
  const nl = body.indexOf('\n', at)
  return nl === -1 ? body.length : nl + 1
}

export { offsetOf }
