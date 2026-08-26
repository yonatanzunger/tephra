// The stream as one logical document (D8), over day files.
//
// Naive by intention, for M0: no split into parts, no WAL, no git. What it does
// implement faithfully is the SHAPE — generation, batched replace, document-
// scoped undo, spans inferred from the text — because the point of this
// milestone is to find out whether the shape is right before building on it.

import type {
  DateKey, Document, DocumentChange, DocumentId, DocumentMeta, DocumentPosition,
  DocumentWindow, Edit, EditOrigin, DocumentOffset, SegmentKey, SessionGeneration, Span,
  SpanKind, TypedSpan, Unsubscribe, VersionId, Divergence, DocumentText,
} from '../../shared/document-api.ts'
import { addDays, compareDateKeys, dateKeyAt } from '../../shared/dates.ts'
import { StalePositionError, offsetOf } from '../../shared/positions.ts'
import type { Notebook } from '../w/notebook.ts'
import { attachmentFile, dayFile, noteFile, parseDayFile, relativePath, type RelPath } from '../w/layout.ts'
import { createHash } from 'node:crypto'
import { frontmatterFor, parseFile, renderFrontmatter } from './frontmatter.ts'
import { markerRemoval, placeMarker, retagBody, subjectKey, tagBody, type ScannedSpan } from './markers.ts'
import type { Anomaly } from '../../shared/anomalies.ts'
import type { RestoreReport } from '../../shared/history-api.ts'
import { Segment } from './segment.ts'
import {
  anchorComment, at, author, insertBlock, insertBlockAt, renderBlock, restate, scanThreadBlocks, splice,
  thread, threadsIn, unanchorComment, unusedCommentId, type ThreadBlock,
} from './comments.ts'
import type { CommentId, CommentMessage, CommentThread } from '../../shared/comments.ts'
import type { DayProse } from '../../shared/ipc.ts'
import { stripHandles } from '../../shared/prose.ts'
import { applyEdits, composeEdits, invertEdits, mapOffset, minimalReplacement, type TextEdit } from './text-edits.ts'
import { StreamWindow } from './window.ts'

/**
 * When an edit removes the start of a tagged range, the edits that remove its
 * end as well.
 *
 * **The pairing invariant is X's to keep, not the editor's.** Deleting a handle
 * is how a person removes a tag (D44), and it arrives here as an ordinary
 * deletion covering the marker's characters — from backspace, from `x`, from a
 * selection overtyped, from any keymap. Left alone it would strip the start and
 * orphan the end; an unmatched `tag-end` is ignored, so the tag would appear to
 * vanish while leaving litter in the file forever.
 *
 * Only deletions pay for this, and they pay with a cached scan: an insertion
 * cannot remove anything, so typing never reaches it.
 */
function partnerRemovals(segment: Segment, edits: readonly TextEdit<DocumentText>[]): TextEdit<DocumentText>[] {
  if (edits.every(e => e.from === e.to)) return []
  const markers = segment.markers()
  const covered = (m: { from: number; to: number }): boolean =>
    edits.some(e => m.from >= e.from && m.to <= e.to)

  const out: TextEdit<DocumentText>[] = []
  for (const marker of markers) {
    if (marker.kind !== 'tag-start' || !covered(marker)) continue
    // Alternation is maintained everywhere else (D21), so a subject's partner
    // is simply its next end.
    const partner = markers.find(
      other =>
        other.kind === 'tag-end' &&
        other.from >= marker.to &&
        subjectKey(other.name) === subjectKey(marker.name),
    )
    if (partner === undefined || covered(partner)) continue
    out.push(markerRemoval(segment.body, partner))
  }
  return out
}

/** One undo step: what happened, and what puts it back. */
interface HistoryEntry {
  readonly change: DocumentChange
  /** Per segment, expressed against the POST-edit body. */
  readonly inverse: ReadonlyMap<DateKey, TextEdit<DocumentText>[]>
}

const GROUPING_WINDOW_MS = 1_500

/** Enough parts to cover any real day; the split threshold is 1 MB (D20). */
const MAX_PARTS = 64

export class StreamDocument implements Document {
  readonly id = 'stream' as DocumentId
  readonly meta: DocumentMeta = { kind: 'stream' }

  readonly #notebook: Notebook
  readonly #segments = new Map<DateKey, Segment>()
  /** Loads in flight, so concurrent callers share one object rather than racing. */
  readonly #loading = new Map<DateKey, Promise<Segment>>()
  #generation = 1 as SessionGeneration

  readonly #undo: HistoryEntry[] = []
  readonly #redo: HistoryEntry[] = []
  #lastUserEditAt = 0

  readonly #changeHandlers = new Set<(c: DocumentChange) => void>()
  readonly #journalHandlers = new Set<
    (date: DateKey, baseLen: number, edits: readonly TextEdit<DocumentText>[]) => void
  >()
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
  /**
   * Every anomaly in the loaded segments. Only the loaded ones: a corpus-wide
   * sweep would mean opening twenty years of files to populate a list nobody
   * asked to see. `.tephra/issues.json` exists for a cached corpus-wide version
   * when something wants one (format-spec.md), and nothing does yet.
   */
  anomalies(): readonly Anomaly[] {
    return [...this.#segments.values()].flatMap(segment => segment.anomalies())
  }

  /**
   * The one Segment object for a date.
   *
   * **The in-flight LOAD is cached, not just the result.** Checking the map and
   * filling it straddle an `await` on the file, so two callers that arrive
   * during that window both miss, both read, and both construct a Segment — and
   * the second `set` wins. Whoever was handed the first object then holds one
   * that is no longer in the map: a window rebuilt from a Segment the document
   * has stopped mutating.
   *
   * That is exactly what happened. Opening a window calls this for each day
   * while background growth, the anomaly scan and the margin's first thread
   * query call it for the same day; about one run in five, the window ended up
   * with an orphan. Commenting then wrote the file correctly, the announcement
   * fired correctly, and the editor's text never changed, because the window
   * was rebuilding from a Segment nobody was editing. The symptom looked like a
   * missing IPC message and was a duplicated object.
   *
   * Parts coalesce into one date span above storage (D20), so this is also the
   * only place that knows a day can be more than one file. Part 1 carries the
   * frontmatter and the original bytes; the rest contribute body only.
   */
  async segment(date: DateKey): Promise<Segment> {
    const held = this.#segments.get(date)
    if (held !== undefined) return held

    const loading = this.#loading.get(date)
    if (loading !== undefined) return loading

    const load = (async (): Promise<Segment> => {
      const rel = dayFile(date)
      const text = await this.#notebook.read(rel)
      const segment =
        text === null
          ? Segment.empty(date, rel, renderFrontmatter(frontmatterFor(date, 'stream')))
          : Segment.load(date, rel, text + (await this.#laterParts(date)))
      this.#segments.set(date, segment)
      return segment
    })()

    this.#loading.set(date, load)
    try {
      return await load
    } finally {
      this.#loading.delete(date)
    }
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

  /**
   * The prose of every day in a range, oldest first, blank days left out.
   *
   * **The whole prose, annotations included** (D50). What a printer does with a
   * tag or a comment is its policy — clean, in the margin, as a note — and this
   * is the layer that would have to be changed to allow any of them if it
   * handed over text alone. It did, for one day, which is what D50 is about.
   *
   * **A day with nothing in it is omitted rather than printed empty.** The
   * stream files a day whenever the app is opened, so a range of a fortnight
   * routinely contains days that were never written in, and printing those
   * would be a page of dates with nothing under them.
   */
  async proseIn(from: DateKey, to: DateKey): Promise<readonly DayProse[]> {
    const [first, last] = compareDateKeys(from, to) <= 0 ? [from, to] : [to, from]
    const out: DayProse[] = []
    for (const date of await this.dates()) {
      if (compareDateKeys(date, first) < 0 || compareDateKeys(date, last) > 0) continue
      const segment = await this.segment(date)
      if (stripHandles(segment.prose.text).trim() === '') continue
      out.push({ date, prose: { text: segment.prose.text, annotations: segment.prose.annotations } })
    }
    return out
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
    const theirs = text === null ? ('' as DocumentText) : parseFile(text).body
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
    else segment.setBody('' as DocumentText)
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
    const perSegment = new Map<DateKey, TextEdit<DocumentText>[]>()
    for (const edit of edits) {
      const date = edit.span.begin.segment as DateKey
      if (edit.span.end.segment !== date) {
        // A span crossing a day boundary is split by the window before it gets
        // here; anything else is a caller error rather than something to patch
        // up silently.
        throw new Error('an Edit may not cross a segment boundary')
      }
      const list: TextEdit<DocumentText>[] = perSegment.get(date) ?? []
      list.push({ from: edit.span.begin.offset as number, to: edit.span.end.offset as number, insert: edit.payload })
      perSegment.set(date, list)
    }

    const inverse = new Map<DateKey, TextEdit<DocumentText>[]>()
    for (const [date, list] of perSegment) {
      const segment = await this.segment(date)
      if (segment.readOnly) {
        throw new Error(`${segment.rel} has frontmatter that could not be parsed; it is not rewritten`)
      }
      if (segment.diverged) {
        throw new Error(`${segment.rel} changed on disk while you were editing it; it is not being written`)
      }
      const sorted = [...list, ...partnerRemovals(segment, list)].sort((a, b) => a.from - b.from)
      inverse.set(date, invertEdits(segment.body, sorted))
      // Emitted here because HERE is the only place the pre-edit length still
      // exists. Anywhere downstream the edit has already been applied, and the
      // log's whole safety property depends on knowing what the day looked like
      // before it — see `WalRecord.baseLen`.
      if (record && origin !== 'external') {
        for (const handler of this.#journalHandlers) handler(date, segment.body.length, sorted)
      }
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
      // **Composed, not concatenated.** The two inverses are expressed against
      // different texts — the newer one against the state after the newer edit,
      // the older one against the state before it — so putting them in a single
      // batch is only accidentally right. Typing never noticed, because
      // appending characters produces inverses that do not overlap; two edits
      // that both replace a whole paragraph within the grouping window produce
      // a batch that overlaps itself, and undo threw `OverlappingEditsError`
      // rather than doing anything.
      //
      // Undoing A-then-B means applying B⁻¹ and then A⁻¹, in that order, which
      // is what `composeEdits` folds into one replacement — against the body as
      // it stands now, which is why this must run after `setBody`.
      const merged = new Map<DateKey, TextEdit<DocumentText>[]>(entry.inverse)
      for (const [date, older] of previous.inverse) {
        const body = this.#segments.get(date)?.body ?? ('' as DocumentText)
        merged.set(date, composeEdits(body, merged.get(date) ?? [], older))
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
    return { segment: at.segment, offset: moved as DocumentOffset, generation: through.to }
  }

  // ── sugar, all of which compiles to replace ────────────────

  async tag(span: Span, subject: string): Promise<void> {
    await this.#retag(span, subject, 'add')
  }

  async untag(span: Span, subject: string): Promise<void> {
    await this.#retag(span, subject, 'remove')
  }

  /**
   * Putting a subject on or taking it off, in ONE edit batch.
   *
   * One batch and not one per day, because a selection that crosses midnight is
   * still one thing the reader did, and it should undo in one step (D23). The
   * interval arithmetic itself is per segment, since alternation is a property
   * of a body: markers in Tuesday's file cannot pair with markers in
   * Wednesday's, so a range crossing the boundary becomes one span in each,
   * which is what "spans may not overlap for a subject" already permits.
   */
  async #retag(span: Span, subject: string, op: 'add' | 'remove'): Promise<void> {
    if (subject.trim() === '') return
    const first = span.begin.segment as DateKey
    const last = span.end.segment as DateKey

    const edits: Edit[] = []
    for (const date of await this.#datesAcross(span)) {
      const segment = await this.segment(date)
      const from = date === first ? (span.begin.offset as number) : 0
      const to = date === last ? (span.end.offset as number) : segment.body.length
      const replacement = minimalReplacement(segment.body, tagBody(segment.body, subject, { from, to }, op))
      if (replacement === null) continue // this day did not change
      edits.push({
        span: {
          begin: this.#positionAt(date, replacement.from),
          end: this.#positionAt(date, replacement.to),
        },
        payload: replacement.insert,
      })
    }
    if (edits.length === 0) return // nothing to do is not an undo step
    await this.replace(edits, 'operation')
  }

  async setAnchor(at: DocumentPosition, name: string): Promise<void> {
    // Markers may not begin a line; see `placeMarker`. The position moves by at
    // most one character, which for a zero-width mark is the same place.
    const segment = await this.segment(at.segment as DateKey)
    const placed = placeMarker(segment.body, at.offset as number, `<!--tephra:mark ${name}-->`)
    const where = this.positionAt(at.segment as DateKey, placed.at)
    await this.replace([{ span: { begin: where, end: where }, payload: placed.text }], 'operation')
  }

  /**
   * Take a bookmark off, wherever in the loaded stream it is.
   *
   * Names are unique within a file but may collide across the corpus (D11), so
   * this removes the FIRST one found in date order — the same one
   * `resolveAnchor` would take you to. Removing something other than the mark
   * the reader is looking at would be worse than doing nothing.
   */
  async removeAnchor(name: string): Promise<void> {
    for (const date of await this.dates()) {
      const segment = await this.segment(date)
      const found = segment.markers().find(m => m.kind === 'anchor' && m.name === name)
      if (found === undefined) continue
      const cut = markerRemoval(segment.body, found)
      await this.replace(
        [
          {
            span: {
              begin: this.#positionAt(date, cut.from),
              end: this.#positionAt(date, cut.to),
            },
            payload: '' as DocumentText,
          },
        ],
        'operation',
      )
      return
    }
  }

  /**
   * Change what ONE span is tagged as — not what the subject is called
   * everywhere.
   *
   * Renaming a subject across the corpus is a different and much larger
   * operation: it has to find every file that mentions it, and it changes text
   * the reader is not looking at. This changes the passage in front of them,
   * which is what "rename" means when you have just clicked on its mark.
   *
   * One edit, so one undo step. The second `tagBody` runs against the body the
   * first produced, so the range has to be carried through the change between
   * them — the removal takes markers out and everything after them moves.
   */
  async renameTag(span: Span, from: string, to: string): Promise<void> {
    if (subjectKey(from) === subjectKey(to)) return
    const date = span.begin.segment as DateKey
    if ((span.end.segment as DateKey) !== date) {
      throw new Error('a tag rename covers one day at a time')
    }
    const segment = await this.segment(date)
    const range = { from: span.begin.offset as number, to: span.end.offset as number }

    // Both subjects in ONE pass, measured against one body. As two calls this
    // cannot be made correct: the first rewrites the body, and the range for
    // the second would have to be carried through a change that deleted the
    // markers it was measured against.
    const renamed = retagBody(segment.body, [
      { subject: from, range, op: 'remove' },
      { subject: to, range, op: 'add' },
    ])

    const replacement = minimalReplacement(segment.body, renamed)
    if (replacement === null) return
    await this.replace(
      [
        {
          span: {
            begin: this.#positionAt(date, replacement.from),
            end: this.#positionAt(date, replacement.to),
          },
          payload: replacement.insert,
        },
      ],
      'operation',
    )
  }

  /**
   * Take a range out of the stream, make it its own file, and leave a link.
   *
   * **Create, then update references, then delete — in that order, in one X
   * operation** (D13). The ordering is the only safety mechanism available
   * without a transaction across two objects: if the process dies partway, the
   * worst case is the text existing in both places, which is visible and
   * fixable, rather than the text existing in neither. Assembled by Z from
   * three primitives it would have no such guarantee, which is why this is one
   * method and not three.
   *
   * The reference-updating step is presently empty and says so: sections are
   * the finite set that must be rewritten on a branch (D11), and they arrive in
   * M3. The step is written here rather than added later because its POSITION
   * in the sequence is the part that matters.
   */
  // ── comments (D47) ─────────────────────────────────────────
  //
  // Seven operations, each compiling to one `replace()` and therefore one undo
  // step. They exist because the body is not in the buffer: it is rendered in
  // the margin and edited there, so editing it is an operation rather than
  // ordinary typing.

  async comments(): Promise<readonly CommentThread[]> {
    const out: CommentThread[] = []
    for (const date of await this.dates()) {
      out.push(...threadsIn((await this.segment(date)).body))
    }
    return out
  }

  async commentsAt(at: DocumentPosition): Promise<readonly CommentThread[]> {
    const ids = new Set(
      (await this.spansAt(at)).filter(s => s.kind === 'comment').map(s => s.name),
    )
    return (await this.comments()).filter(thread => ids.has(thread.id as string))
  }

  /** Anchor a new thread to a range and open it with one message. */
  /**
   * Anchor a new thread to a range, with or without anything to say yet.
   *
   * **An empty first message is allowed on purpose.** Commenting opens the note
   * in the margin already in edit mode, where the note is read — asking for the
   * text in a dialog first would put the writing somewhere other than the
   * reading, which is the thing D47 rules out. An empty message that is never
   * filled in is removed when the composer is dismissed, and removing the only
   * message removes the thread, so nothing is left behind.
   */
  async startComment(span: Span, body: string): Promise<CommentId> {
    const date = span.begin.segment as DateKey
    if ((span.end.segment as DateKey) !== date) {
      throw new Error('a comment covers one day at a time')
    }
    const segment = await this.segment(date)
    const id = unusedCommentId(segment.body)

    // The anchor pair first, then the block after the paragraph the range ends
    // in — computed against the body WITH the anchors, since they move it.
    const anchored = anchorComment(segment.body, id, {
      from: span.begin.offset as number,
      to: span.end.offset as number,
    })
    const placed = insertBlock(
      anchored.body,
      anchored.endsAt,
      renderBlock(id, this.#newMessage(body)),
    )
    await this.#writeBody(date, segment.body, placed)
    return id
  }

  async addComment(id: CommentId, body: string): Promise<void> {
    if (body.trim() === '') throw new Error('a comment needs something in it')
    await this.#rewriteThread(id, (blocks, segment) => {
      const last = blocks[blocks.length - 1] as ThreadBlock
      return insertBlockAt(segment.body, last.to, renderBlock(id, this.#newMessage(body)))
    })
  }

  async editComment(id: CommentId, index: number, body: string): Promise<void> {
    if (body.trim() === '') throw new Error('an edited comment still needs something in it')
    await this.#rewriteThread(id, (blocks, segment) => {
      const block = at(blocks, index)
      const message = { ...block.message, body }
      return splice(segment.body, block, renderBlock(id, message, thread(blocks)))
    })
  }

  /**
   * Remove one message. **Removing the last one removes the thread**, anchors
   * included — a thread with no messages is not a thread, the same rule as a tag
   * span that covers only whitespace.
   */
  async deleteComment(id: CommentId, index: number): Promise<void> {
    await this.#rewriteThread(id, (blocks, segment) => {
      const block = at(blocks, index)
      if (blocks.length > 1) {
        const rest = blocks.filter(b => b !== block)
        // Thread state lives on the first block, so removing the first block
        // has to carry it to whatever becomes first.
        const body = splice(segment.body, block, '')
        return index === 0 ? restate(body, id, thread(blocks)) : body
      }
      return unanchorComment(splice(segment.body, block, ''), id)
    })
  }

  async setCommentResolved(id: CommentId, resolved: boolean): Promise<void> {
    await this.#rewriteThread(id, (blocks, segment) =>
      restate(segment.body, id, { ...thread(blocks), resolved }),
    )
  }

  async setCommentAssignee(id: CommentId, to: string | null): Promise<void> {
    await this.#rewriteThread(id, (blocks, segment) =>
      restate(segment.body, id, { ...thread(blocks), assignee: to }),
    )
  }

  /** Toggles the CURRENT user's reaction; there is no reacting for someone else. */
  async reactToComment(id: CommentId, index: number, emoji: string, on: boolean): Promise<void> {
    await this.#rewriteThread(id, (blocks, segment) => {
      const block = at(blocks, index)
      const me = author()
      const was = block.message.reactions[emoji] ?? []
      const now = on ? (was.includes(me) ? was : [...was, me]) : was.filter(who => who !== me)

      // Insertion order is content, so an emoji keeps its place while anyone is
      // still using it and disappears only when nobody is.
      const reactions: Record<string, readonly string[]> = {}
      for (const [key, who] of Object.entries(block.message.reactions)) {
        if (key === emoji) {
          if (now.length > 0) reactions[key] = now
        } else {
          reactions[key] = who
        }
      }
      if (now.length > 0 && reactions[emoji] === undefined) reactions[emoji] = now

      const message = { ...block.message, reactions }
      return splice(segment.body, block, renderBlock(id, message, thread(blocks)))
    })
  }

  #newMessage(body: string): CommentMessage {
    return {
      author: author(),
      at: new Date().toISOString().slice(0, 16),
      body: body.trim(),
      reactions: {},
      unknown: [],
    }
  }

  /** Find the day a thread lives in, rewrite its body, and write it as one edit. */
  async #rewriteThread(
    id: CommentId,
    change: (blocks: readonly ThreadBlock[], segment: Segment) => DocumentText,
  ): Promise<void> {
    for (const date of await this.dates()) {
      const segment = await this.segment(date)
      const blocks = scanThreadBlocks(segment.body).filter(b => b.id === id)
      if (blocks.length === 0) continue
      await this.#writeBody(date, segment.body, change(blocks, segment))
      return
    }
    throw new Error(`there is no comment ${id}`)
  }

  /** One replacement covering everything that differs, so one undo step. */
  async #writeBody(date: DateKey, before: DocumentText, after: DocumentText): Promise<void> {
    const replacement = minimalReplacement(before, after)
    if (replacement === null) return
    await this.replace(
      [
        {
          span: {
            begin: this.#positionAt(date, replacement.from),
            end: this.#positionAt(date, replacement.to),
          },
          payload: replacement.insert,
        },
      ],
      'operation',
    )
  }

  /**
   * Bring outside text in, so it can be annotated (R28).
   *
   * **The original is kept untouched and the copy is what you write on** — the
   * uniform rule for every inbound path (D47, dissolving Q9). Freezing the
   * CONVERSION would protect nothing: a `.docx` or a pasted fragment rendered
   * to markdown is already derived, and the artifact worth citing is the bytes
   * that arrived. So those go to `attachments/`, content-hashed, and what lands
   * in the day is ordinary prose that every existing gesture already works on —
   * tag it, comment on it, branch it, print it.
   *
   * The provenance line is prose too, not a marker. A reader outside Tephra
   * should be able to see where a passage came from, and someone who no longer
   * wants the note should be able to delete it like any other sentence.
   */
  async importText(
    at: DocumentPosition,
    text: string,
    original: { readonly content: string; readonly ext: string },
  ): Promise<RelPath> {
    if (text.trim() === '') throw new Error('there is nothing to import')
    const date = at.segment as DateKey
    const segment = await this.segment(date)

    const digest = createHash('sha256').update(original.content).digest('hex')
    const rel = attachmentFile(date, 'clipboard', digest, original.ext)
    await this.#notebook.write(rel, original.content)

    const link = relativePath(dayFile(date), rel)
    const block = `*Imported ${date} from [the clipboard](${link}).*\n\n${text.trim()}`
    const placed = insertBlockAt(segment.body, at.offset as number, block)
    await this.#writeBody(date, segment.body, placed)
    return rel
  }

  async branch(span: Span, name: string): Promise<DocumentId> {
    const title = name.trim()
    if (title === '') throw new Error('a branched file needs a name')

    const pieces: { date: DateKey; from: number; to: number; text: string }[] = []
    for (const date of await this.#datesAcross(span)) {
      const segment = await this.segment(date)
      const from = date === (span.begin.segment as DateKey) ? (span.begin.offset as number) : 0
      const to = date === (span.end.segment as DateKey) ? (span.end.offset as number) : segment.body.length
      if (to > from) pieces.push({ date, from, to, text: segment.body.slice(from, to) })
    }
    const moved = pieces.map(p => p.text).join('\n').trim()
    if (moved === '') throw new Error('there is nothing in the selection to branch')

    // 1. CREATE. No date, ever: a branched file is not in the dated stream, and
    //    giving it one to pretend otherwise is the contortion D27 refuses. The
    //    title is carried in frontmatter because the slug is not reversible.
    const rel = await this.#unusedNoteFile(title)
    const header = renderFrontmatter({
      tephra: 1,
      date: null,
      part: null,
      kind: 'markdown',
      extra: [['title', title]],
    })
    await this.#notebook.write(rel, `${header}\n${moved}\n`)

    // 2. UPDATE REFERENCES. Nothing to update yet — see above.

    // 3. DELETE, leaving the link in the first day the range touched. One batch,
    //    so a branch is one undo step.
    const first = pieces[0] as { date: DateKey; from: number; to: number }
    const link = `[${title}](${relativePath(dayFile(first.date), rel)})`
    await this.replace(
      pieces.map((piece, index) => ({
        span: {
          begin: this.#positionAt(piece.date, piece.from),
          end: this.#positionAt(piece.date, piece.to),
        },
        payload: (index === 0 ? link : '') as DocumentText,
      })),
      'operation',
    )
    return rel as DocumentId
  }

  /** The segments a span touches, in order. */
  async #datesAcross(span: Span): Promise<readonly DateKey[]> {
    const first = span.begin.segment as DateKey
    const last = span.end.segment as DateKey
    const dates = (await this.dates()).filter(
      d => compareDateKeys(d, first) >= 0 && compareDateKeys(d, last) <= 0,
    )
    for (const date of [first, last]) if (!dates.includes(date)) dates.push(date)
    return dates.sort(compareDateKeys)
  }

  /**
   * A path no file is using. Two branches named the same thing is an ordinary
   * thing to do a year apart, and silently writing over the first would destroy
   * exactly the material this operation exists to preserve.
   */
  async #unusedNoteFile(title: string): Promise<RelPath> {
    const base = noteFile(title)
    if (!(await this.#notebook.has(base))) return base
    for (let n = 2; n < 1000; n++) {
      const candidate = base.replace(/\.md$/, `-${n}.md`) as RelPath
      if (!(await this.#notebook.has(candidate))) return candidate
    }
    throw new Error(`there are already a thousand files named like ${base}`)
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

  /**
   * Satisfies the `Document` interface, which returns nothing on purpose:
   * `document-api.ts` is the X-to-Z contract, and **Z must never learn file
   * paths** — that mapping belongs to storage, and handing it upward is the
   * layering violation `architecture.md` spends a rule forbidding.
   *
   * Main-side callers that legitimately need the paths — the commit tier does,
   * so it can stage what it wrote instead of scanning the tree (D34) — use
   * `writeDirty` directly. They hold a `StreamDocument`, not the interface.
   */
  async flush(): Promise<void> {
    await this.writeDirty()
  }

  /** Write every dirty segment, and report which files that touched. */
  async writeDirty(): Promise<readonly RelPath[]> {
    const written: RelPath[] = []
    for (const segment of this.#segments.values()) {
      // A diverged segment is frozen: writing it would destroy the hand-edit
      // that caused the divergence, which is the one outcome nothing recovers.
      if (segment.readOnly || segment.diverged) continue

      // **A day with nothing in it is not a day.** Opening the app creates a
      // segment for today whether or not anything is written, and writing that
      // out leaves a file of pure frontmatter — which then reads back as a real
      // day, draws its own seam in the stream, and accumulates one per day the
      // notebook was merely opened. Nothing is lost by removing one: it has no
      // text, and every version of it is in the repository.
      //
      // Checked even when the segment is CLEAN, so files written before this
      // rule existed are collected as the days holding them are loaded. A day
      // carrying frontmatter keys somebody added by hand is not disposable —
      // that is content, in the only place the format has to put it.
      if (segment.disposable) {
        for (let part = 1; ; part++) {
          const stale = dayFile(segment.date, part)
          if (!(await this.#notebook.has(stale))) break
          await this.#notebook.remove(stale)
          written.push(stale)
        }
        segment.markClean(segment.serialise())
        continue
      }

      if (!segment.dirty) continue
      const files = segment.files()
      for (const file of files) {
        await this.#notebook.write(file.rel, file.text)
        written.push(file.rel)
      }
      // A day that shrank back below the threshold must not leave its old tail
      // behind: an orphaned part 2 would be read back as part of the day
      // forever, silently duplicating text that was deleted.
      for (let part = files.length + 1; ; part++) {
        const stale = dayFile(segment.date, part)
        if (!(await this.#notebook.has(stale))) break
        await this.#notebook.remove(stale)
        written.push(stale)
      }
      segment.markClean(files[0]?.text ?? segment.serialise())
    }
    return written
  }

  /** Bodies of parts 2..n, concatenated. Empty for the ordinary one-part day. */
  async #laterParts(date: DateKey): Promise<string> {
    let out = ''
    for (let part = 2; ; part++) {
      const text = await this.#notebook.read(dayFile(date, part))
      if (text === null) return out
      out += parseFile(text).body
    }
  }

  /**
   * Told about each batch of text edits as it is applied, with the length of the
   * day BEFORE it. The write-ahead log is the only subscriber; nothing else
   * needs pre-edit state, and nothing else should be given it.
   */
  onJournal(
    handler: (date: DateKey, baseLen: number, edits: readonly TextEdit<DocumentText>[]) => void,
  ): () => void {
    this.#journalHandlers.add(handler)
    return () => this.#journalHandlers.delete(handler)
  }

  /**
   * Replace the whole stream with what it held at some version.
   *
   * **Not an edit, and deliberately not shaped like one.** A restore can touch
   * every day at once, so expressing it as a batch of replacements would build
   * a change record the size of the corpus for nobody to read. It sets bodies
   * and RESETS the windows — the path the design already calls "expensive,
   * rare, and correct" — which is exactly what a large external change is.
   *
   * **It truncates the undo stack** (`history-api.ts`). Mapping an undo through
   * a change of this size is not well defined, and a wrong answer there is
   * silent corruption; the recovery path if a restore was wrong is another
   * restore, not ⌘Z.
   */
  async restoreTo(target: ReadonlyMap<DateKey, DocumentText | null>): Promise<RestoreReport> {
    let restored = 0
    let removed = 0

    for (const [date, body] of target) {
      if (body === null) {
        // Every part, not just the first: a day that had been split leaves the
        // rest behind otherwise, and they would be read back as its tail.
        for (let part = 1; part <= MAX_PARTS; part++) {
          const rel = dayFile(date, part)
          if (!(await this.#notebook.has(rel))) break
          await this.#notebook.remove(rel)
        }
        this.#segments.delete(date)
        removed++
        continue
      }
      const segment = await this.segment(date)
      if (segment.body !== body) restored++
      segment.setBody(body)
    }

    this.#undo.length = 0
    this.#redo.length = 0
    this.#generation = (this.#generation + 1) as SessionGeneration
    for (const window of this.#windows) window.reset()

    return { version: '' as VersionId, restored, removed }
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
    return { segment, offset: offset as DocumentOffset, generation: this.#generation }
  }

  /** The segment object this document is holding for a date, if any. */
  heldSegment(date: DateKey): Segment | undefined {
    return this.#segments.get(date)
  }

  positionAt(segment: SegmentKey, offset: number): DocumentPosition {
    return this.#positionAt(segment, offset)
  }

  /** The one mapping from a scanned span to a typed one. See `#typed`. */
  typed(date: DateKey, s: ScannedSpan): TypedSpan {
    return this.#typed(date, s)
  }

  /**
   * A scanned span becomes a typed one.
   *
   * **The only implementation, and it has to stay that way.** `StreamWindow`
   * had a second copy whose last branch was `{ kind: 'tag' }`, so the moment a
   * new kind arrived — comments — every one of them reached the renderer
   * labelled a tag: `spans('comment')` was empty, the margin drew nothing, and
   * the tag rail would have drawn them. A switch with a fallthrough default is
   * a mapping that silently mislabels whatever it has not been taught.
   */
  #typed(date: DateKey, s: ScannedSpan): TypedSpan {
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
      case 'comment':
        return { kind: 'comment', name: s.name, resolved: s.resolved === true, span }
    }
  }

  /** The date a new note goes to, in the reference zone (D38). */
  static today(): DateKey {
    return dateKeyAt()
  }
}

/** Widen backwards to the start of the line. */
function snapBack(body: string, offset: DocumentOffset): number {
  const at = Math.min(Math.max(0, offset as number), body.length)
  const nl = body.lastIndexOf('\n', at - 1)
  return nl === -1 ? 0 : nl + 1
}

/** Widen forwards to the end of the line. */
function snapForward(body: string, offset: DocumentOffset): number {
  const at = Math.min(Math.max(0, offset as number), body.length)
  const nl = body.indexOf('\n', at)
  return nl === -1 ? body.length : nl + 1
}

export { offsetOf }
