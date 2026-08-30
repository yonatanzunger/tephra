// A document made of segments: everything a kind does NOT have to invent (D54).
//
// **The stream is one kind, not the shape of documents.** Everything here is
// keyed by `SegmentKey` and always was — `DateKey` is an alias for it — so the
// edits, the history, the spans, the tags, the comments and the journal are the
// same work whether a document has seven thousand segments or one. What differs
// between kinds is two questions: **how a segment is loaded, and what segments
// there are.** Those are the abstract members below; a kind supplies them and
// inherits the rest.
//
// The shared state is `protected` rather than `#private` for exactly that
// reason: a kind's own methods — a day's loader, the stream's external-change
// path — read the same segment map the generic machinery does. Note the names:
// the undo STACK is `undoStack`, because `undo` is a method, and a field that
// shadows a method is a hundred compile errors wearing one hat.

import type {
  DateKey, Document, DocumentChange, DocumentId, DocumentMeta, DocumentPosition,
  DocumentWindow, Edit, EditOrigin, DocumentOffset, SegmentKey, SessionGeneration, Span,
  SpanKind, StreamDocumentApi, TypedSpan, Unsubscribe, VersionId, Divergence, DocumentText,
} from '../../../shared/document-api.ts'
import { addDays, compareDateKeys, dateKeyAt } from '../../../shared/dates.ts'
import { StalePositionError, offsetOf } from '../../../shared/positions.ts'
import type { Notebook } from '../../w/notebook.ts'
import { attachmentFile, dayFile, noteFile, parseDayFile, relativePath, type RelPath } from '../../w/layout.ts'
import { createHash } from 'node:crypto'
import { frontmatterFor, parseFile, renderFrontmatter } from '../frontmatter.ts'
import { markerRemoval, placeMarker, retagBody, subjectKey, tagBody, type ScannedSpan } from '../markers.ts'
import type { Anomaly } from '../../../shared/anomalies.ts'
import type { RestoreReport } from '../../../shared/history-api.ts'
import { Segment } from '../segment.ts'


/** What one file contributes to the index: its spans, and whether it is empty. */
export interface FileScan {
  readonly spans: readonly ScannedSpan[]
  /**
   * **Nothing written in it, which is not the same as not existing.** The
   * stream files a day whenever the app is opened (D8), so a fortnight of
   * ordinary use leaves days that were never typed in — and a timeline listing
   * them is a list of dates with nothing behind them.
   */
  readonly blank: boolean
}
import {
  anchorComment, at, author, insertBlock, insertBlockAt, renderBlock, restate, scanThreadBlocks, splice,
  thread, threadsIn, unanchorComment, unusedCommentId, type ThreadBlock,
} from '../comments.ts'
import type { CommentId, CommentMessage, CommentThread } from '../../../shared/comments.ts'
import type { DayProse } from '../../../shared/ipc.ts'
import { stripHandles } from '../../../shared/prose.ts'
import { applyEdits, composeEdits, invertEdits, mapOffset, minimalReplacement, type TextEdit } from '../text-edits.ts'
import { LocalWindow } from '../window.ts'

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

import type { StoredDocument } from './stored.ts'

export abstract class SegmentedDocument implements StoredDocument {
  abstract readonly id: DocumentId
  abstract readonly meta: DocumentMeta

  /**
   * Read one segment from storage, or make an empty one.
   *
   * A kind's whole storage story: a day joins its split parts and carries a date
   * in its frontmatter, a note is one file, and a document with nothing on disk
   * yet answers with something empty rather than failing.
   */
  protected abstract load(key: SegmentKey): Promise<Segment>

  /** Every segment this document has, in the order it reads in. */
  abstract keys(): Promise<readonly SegmentKey[]>

  /**
   * One segment's content, as the file holds it.
   *
   * **The way anything outside reads a document's text.** X used to read files
   * for this — the fileset parser did, and would have shown what was saved
   * while a window showed what was typed. Asking the document costs the same
   * and cannot be stale (D54).
   */
  async bodyOf(key: SegmentKey): Promise<DocumentText> {
    return (await this.segment(key)).body
  }

  /**
   * Name this document, in the only place a name can live: its frontmatter.
   *
   * Not an edit — it changes nothing in the text, so it takes no span, makes no
   * undo entry and moves no position. It does make the document dirty, which is
   * what carries it to disk on the next write.
   */
  async setTitleOf(key: SegmentKey, title: string): Promise<void> {
    ;(await this.segment(key)).setExtra('title', title)
    this.touch('operation')
  }

  /**
   * Where this document was brought in from, if it was (D47, MC6).
   *
   * Beside the title and for the same reason: a fact about the document rather
   * than a sentence in it. A person who wants it out deletes the line, which is
   * what "unknown keys are preserved verbatim" is for.
   */
  async setSourceOf(key: SegmentKey, source: string): Promise<void> {
    ;(await this.segment(key)).setExtra('source', source)
    this.touch('operation')
  }

  /**
   * Say that something about this document changed which is not its text.
   *
   * The generation does NOT advance: a generation counts edits, and a renderer
   * holding the old number is not stale, because nothing it holds has moved.
   * What this is for is the write — whoever schedules one is listening for
   * changes, and a rename that nobody announced would sit in memory until the
   * next edit happened to carry it out.
   */
  protected touch(origin: EditOrigin): void {
    const change: DocumentChange = { from: this.gen, to: this.gen, edits: [], origin, at: Date.now() }
    for (const handler of this.changeHandlers) handler(change)
  }

  /**
   * What this document calls itself, if anything.
   *
   * From the frontmatter, which is storage — so asking the document is the way
   * to get it without a second parse of a file that has already been read once.
   * Null when nobody named it, and the caller decides what to fall back to.
   */
  async titleOf(key: SegmentKey): Promise<string | null> {
    const found = (await this.segment(key)).extra.find(([k]) => k.toLowerCase() === 'title')?.[1]
    return found !== undefined && found.trim() !== '' ? found.trim() : null
  }

  /**
   * Replace one segment's content wholesale, as an ordinary edit.
   *
   * A minimal replacement rather than a reset, so the change is one undo step,
   * carries through the journal, and leaves a cursor elsewhere in the document
   * where it was. Whoever rewrites a file — the fileset writer, an importer —
   * goes through here rather than through the notebook, and gets undo and
   * durability for having done so.
   */
  async setBodyOf(key: SegmentKey, body: DocumentText, origin: EditOrigin = 'operation'): Promise<void> {
    const segment = await this.segment(key)
    const change = minimalReplacement(segment.body, body)
    if (change === null) return
    const at = (offset: number): DocumentPosition => this.at(key, offset)
    await this.replace(
      [{ span: { begin: at(change.from), end: at(change.to) }, payload: change.insert }],
      origin,
    )
  }

  /**
   * The two operations that make a NEW document, which only a kind can answer.
   *
   * Branching writes a note beside the corpus and leaves a link; importing puts
   * an original in `attachments/` and a copy in the text. Both are about where
   * a kind's files live, which is the one thing a segmented document cannot
   * know about itself (D54 — these move to the `Corpus` when a second kind
   * needs them).
   */
  abstract branch(span: Span, name: string): Promise<DocumentId>
  abstract importText(
    at: DocumentPosition,
    text: string,
    original: { readonly content: string; readonly ext: string },
  ): Promise<string>


  protected readonly notebook: Notebook
  protected readonly segments = new Map<DateKey, Segment>()
  /** Loads in flight, so concurrent callers share one object rather than racing. */
  protected readonly loading = new Map<DateKey, Promise<Segment>>()
  protected gen = 1 as SessionGeneration

  protected readonly undoStack: HistoryEntry[] = []
  protected readonly redoStack: HistoryEntry[] = []
  protected lastUserEditAt = 0


  protected readonly changeHandlers = new Set<(c: DocumentChange) => void>()
  protected readonly journalHandlers = new Set<
    (date: DateKey, baseLen: number, edits: readonly TextEdit<DocumentText>[]) => void
  >()
  protected readonly divergeHandlers = new Set<(d: Divergence) => void>()

  /** Windows that need telling when something else changes the text. */
  protected readonly windows = new Set<LocalWindow>()

  constructor(notebook: Notebook) {
    this.notebook = notebook
  }

  get generation(): SessionGeneration {
    return this.gen
  }

  get isDirty(): boolean {
    return [...this.segments.values()].some(s => s.dirty)
  }

  currentGeneration(): SessionGeneration {
    return this.gen
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
    return [...this.segments.values()].flatMap(segment => segment.anomalies())
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
    const held = this.segments.get(date)
    if (held !== undefined) return held

    const loading = this.loading.get(date)
    if (loading !== undefined) return loading

    const load = (async (): Promise<Segment> => {
      const segment = await this.load(date)
      this.segments.set(date, segment)
      return segment
    })()

    this.loading.set(date, load)
    try {
      return await load
    } finally {
      this.loading.delete(date)
    }
  }

  /**
   * The spans of one day — **from memory if it is loaded, from disk if not, and
   * without keeping what it had to read** (D52).
   *
   * This is the rule that keeps the index honest, in one method. A day the
   * editor is holding answers for itself, including edits made thirty seconds
   * ago that have not reached the file; every other day is read, scanned and
   * dropped. Asking `segment()` instead would have been one line and would have
   * loaded the corpus into memory to build a list of subjects.
   */
  async scan(date: DateKey): Promise<{ spans: readonly ScannedSpan[]; blank: boolean }> {
    const segment = this.segments.get(date) ?? (await this.load(date))
    return { spans: segment.spans(), blank: segment.body.trim() === '' }
  }

  // ── reading ────────────────────────────────────────────────

  async read(span: Span, at?: SessionGeneration): Promise<DocumentWindow> {
    if (at !== undefined && at !== this.gen) {
      // v1 serves only the current generation. The parameter exists so that
      // diffing and the divergence picker need no API change later.
      throw new StalePositionError(this.gen, at)
    }

    // Through `segmentsAcross`, which asks the KIND what lies between two keys.
    // Counting days here would be right for the stream and nonsense for a note,
    // whose one key is not a date and has no successor to walk to (D54).
    const segments: Segment[] = []
    for (const key of await this.segmentsAcross(span)) segments.push(await this.segment(key))

    const window = new LocalWindow(this, segments)
    await window.refreshBoundaries()
    this.windows.add(window)
    return window
  }

  /**
   * The segments a span touches, in reading order.
   *
   * Generic over the kind: the ORDER is whatever `keys()` says it is, which for
   * a stream is chronological and for a one-segment document is trivial. The
   * ends are included even when they have no file yet, because a span may reach
   * a segment nobody has written in.
   */
  protected async segmentsAcross(span: Span): Promise<readonly SegmentKey[]> {
    const keys = await this.keys()
    const first = keys.indexOf(span.begin.segment)
    const last = keys.indexOf(span.end.segment)
    if (first === -1 || last === -1) {
      return [...new Set([span.begin.segment, span.end.segment])]
    }
    return keys.slice(Math.min(first, last), Math.max(first, last) + 1)
  }

  async snap(span: Span): Promise<Span> {
    const begin = await this.segment(span.begin.segment as DateKey)
    const end = await this.segment(span.end.segment as DateKey)
    return {
      begin: this.at(span.begin.segment, snapBack(begin.body, span.begin.offset)),
      end: this.at(span.end.segment, snapForward(end.body, span.end.offset)),
    }
  }

  async advance(from: DocumentPosition, chars: number): Promise<DocumentPosition | null> {
    let date = from.segment as DateKey
    let remaining = chars + (from.offset as number)
    const keys = await this.keys()
    const extent = keys.length === 0 ? null : { first: keys[0] as DateKey, last: keys[keys.length - 1] as DateKey }
    if (extent === null) return null

    // Walk forwards or backwards across days until the count is used up.
    for (;;) {
      const segment = await this.segment(date)
      if (remaining >= 0 && remaining <= segment.length) {
        return this.at(date, remaining)
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

  /**
   * Every span in this document.
   *
   * **About ITSELF, and never through a cache.** An earlier version consulted
   * the index here while the index read days through this object — two arrows
   * in opposite directions, safe only because each called a different method.
   * A document knows its own content; the corpus-wide question belongs to the
   * index, and the service asks it there (D54).
   */
  async spans(kind?: SpanKind): Promise<readonly TypedSpan[]> {
    const out: TypedSpan[] = []
    for (const date of await this.keys()) {
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
    for (const date of await this.keys()) {
      const found = (await this.segment(date)).anchorAt(name)
      if (found !== null) return this.at(date, found)
    }
    return null
  }

  // ── writing ────────────────────────────────────────────────

  async replace(edits: readonly Edit[], origin: EditOrigin = 'operation'): Promise<void> {
    if (edits.length === 0) return
    for (const edit of edits) {
      if (edit.span.begin.generation !== this.gen) {
        throw new StalePositionError(this.gen, edit.span.begin.generation)
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
        throw new Error(`${segment.readOnlyReason ?? segment.rel}; it is not written`)
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
        for (const handler of this.journalHandlers) handler(date, segment.body.length, sorted)
      }
      segment.setBody(applyEdits(segment.body, sorted))
    }

    const from = this.gen
    this.gen = (from + 1) as SessionGeneration
    const change: DocumentChange = {
      from,
      to: this.gen,
      edits,
      origin,
      at: Date.now(),
    }

    if (record && origin !== 'external') {
      this.#push({ change, inverse }, origin)
      this.redoStack.length = 0
    }

    for (const handler of this.changeHandlers) handler(change)
    for (const window of this.windows) window.documentChanged(change)
    return change
  }

  /**
   * Grouping is by origin and adjacency: a typed sentence is one undo step, and
   * an applied tag is its own. Without it, undo is per-keystroke and useless.
   */
  #push(entry: HistoryEntry, origin: EditOrigin): void {
    const now = entry.change.at
    const previous = this.undoStack[this.undoStack.length - 1]
    const groupable =
      origin === 'user' &&
      previous !== undefined &&
      previous.change.origin === 'user' &&
      now - this.lastUserEditAt < GROUPING_WINDOW_MS

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
        const body = this.segments.get(date)?.body ?? ('' as DocumentText)
        merged.set(date, composeEdits(body, merged.get(date) ?? [], older))
      }
      this.undoStack[this.undoStack.length - 1] = {
        change: { ...entry.change, from: previous.change.from },
        inverse: merged,
      }
    } else {
      this.undoStack.push(entry)
    }
    if (origin === 'user') this.lastUserEditAt = now
  }

  // ── history ────────────────────────────────────────────────

  /**
   * NON-DESTRUCTIVE: a rewind is itself a new change, emitted forward, so
   * generations only ever increase and nothing is discarded (D29).
   */
  async rewindTo(to: SessionGeneration): Promise<DocumentChange | null> {
    if (to === this.gen) return null
    if (to > this.gen) throw new StalePositionError(this.gen, to)

    const reachable = this.undoStack.some(e => e.change.from === to) || to === this.undoStack[0]?.change.from
    if (!reachable && this.undoStack.length > 0 && to < (this.undoStack[0] as HistoryEntry).change.from) {
      // Bounded by the session: the undo stack is memory-only (D32), so a
      // generation from before this process started is simply unreachable.
      throw new StalePositionError((this.undoStack[0] as HistoryEntry).change.from, to)
    }

    let last: DocumentChange | null = null
    while (this.gen > to && this.undoStack.length > 0) {
      last = await this.#stepBack()
    }
    return last
  }

  async #stepBack(): Promise<DocumentChange | null> {
    const entry = this.undoStack.pop()
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
            begin: this.at(date, undoing.from),
            end: this.at(date, undoing.to),
          },
          payload: undoing.insert,
        })
      }

      // In `after` coordinates — the text redo will be applied to.
      const redoing = minimalReplacement(after, before)
      if (redoing !== null) {
        redoEdits.push({
          span: {
            begin: this.at(date, redoing.from),
            end: this.at(date, redoing.to),
          },
          payload: redoing.insert,
        })
      }
    }

    // `inverse` is carried through unchanged: after a redo the body is back to
    // its post-change state, which is exactly what that map transforms.
    this.redoStack.push({ change: { ...entry.change, edits: redoEdits }, inverse: entry.inverse })
    if (edits.length === 0) return null
    return this.#applyAndRecord(edits, 'operation', false)
  }

  async undo(): Promise<DocumentChange | null> {
    return this.#stepBack()
  }

  async redo(): Promise<DocumentChange | null> {
    const entry = this.redoStack.pop()
    if (entry === undefined) return null
    const change = await this.#applyAndRecord(entry.change.edits, entry.change.origin, false)
    this.undoStack.push(entry)
    return change
  }

  async history(since?: SessionGeneration): Promise<readonly DocumentChange[]> {
    return this.undoStack
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
    for (const date of await this.segmentsAcross(span)) {
      const segment = await this.segment(date)
      const from = date === first ? (span.begin.offset as number) : 0
      const to = date === last ? (span.end.offset as number) : segment.body.length
      const replacement = minimalReplacement(segment.body, tagBody(segment.body, subject, { from, to }, op))
      if (replacement === null) continue // this day did not change
      edits.push({
        span: {
          begin: this.at(date, replacement.from),
          end: this.at(date, replacement.to),
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
    for (const date of await this.keys()) {
      const segment = await this.segment(date)
      const found = segment.markers().find(m => m.kind === 'anchor' && m.name === name)
      if (found === undefined) continue
      const cut = markerRemoval(segment.body, found)
      await this.replace(
        [
          {
            span: {
              begin: this.at(date, cut.from),
              end: this.at(date, cut.to),
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
            begin: this.at(date, replacement.from),
            end: this.at(date, replacement.to),
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
    for (const date of await this.keys()) {
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
    await this.writeBody(date, segment.body, placed)
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
    for (const date of await this.keys()) {
      const segment = await this.segment(date)
      const blocks = scanThreadBlocks(segment.body).filter(b => b.id === id)
      if (blocks.length === 0) continue
      await this.writeBody(date, segment.body, change(blocks, segment))
      return
    }
    throw new Error(`there is no comment ${id}`)
  }

  /** One replacement covering everything that differs, so one undo step. */
  protected async writeBody(date: DateKey, before: DocumentText, after: DocumentText): Promise<void> {
    const replacement = minimalReplacement(before, after)
    if (replacement === null) return
    await this.replace(
      [
        {
          span: {
            begin: this.at(date, replacement.from),
            end: this.at(date, replacement.to),
          },
          payload: replacement.insert,
        },
      ],
      'operation',
    )
  }

  // ── change feed ────────────────────────────────────────────

  onChanged(handler: (change: DocumentChange) => void): Unsubscribe {
    this.changeHandlers.add(handler)
    return () => this.changeHandlers.delete(handler)
  }

  onDiverged(handler: (d: Divergence) => void): Unsubscribe {
    this.divergeHandlers.add(handler)
    return () => this.divergeHandlers.delete(handler)
  }

  releaseWindow(window: LocalWindow): void {
    this.windows.delete(window)
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
    for (const segment of this.segments.values()) {
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
          if (!(await this.notebook.has(stale))) break
          await this.notebook.remove(stale)
          written.push(stale)
        }
        segment.markClean(segment.serialise())
        continue
      }

      if (!segment.dirty) continue
      const files = segment.files()
      for (const file of files) {
        await this.notebook.write(file.rel, file.text)
        written.push(file.rel)
      }
      // A day that shrank back below the threshold must not leave its old tail
      // behind: an orphaned part 2 would be read back as part of the day
      // forever, silently duplicating text that was deleted.
      for (let part = files.length + 1; ; part++) {
        const stale = dayFile(segment.date, part)
        if (!(await this.notebook.has(stale))) break
        await this.notebook.remove(stale)
        written.push(stale)
      }
      segment.markClean(files[0]?.text ?? segment.serialise())
    }
    return written
  }

  /**
   * Told about each batch of text edits as it is applied, with the length of the
   * day BEFORE it. The write-ahead log is the only subscriber; nothing else
   * needs pre-edit state, and nothing else should be given it.
   */
  onJournal(
    handler: (date: DateKey, baseLen: number, edits: readonly TextEdit<DocumentText>[]) => void,
  ): () => void {
    this.journalHandlers.add(handler)
    return () => this.journalHandlers.delete(handler)
  }

  async reload(): Promise<void> {
    await this.flush()
    this.segments.clear()
    this.undoStack.length = 0
    this.redoStack.length = 0
    for (const window of this.windows) window.reset()
  }

  async release(): Promise<void> {
    await this.flush()
    this.windows.clear()
    this.changeHandlers.clear()
    this.divergeHandlers.clear()
  }

  // ── helpers ────────────────────────────────────────────────

  protected at(segment: SegmentKey, offset: number): DocumentPosition {
    return { segment, offset: offset as DocumentOffset, generation: this.gen }
  }

  /** The segment object this document is holding for a date, if any. */
  heldSegment(date: DateKey): Segment | undefined {
    return this.segments.get(date)
  }

  positionAt(segment: SegmentKey, offset: number): DocumentPosition {
    return this.at(segment, offset)
  }

  /** The one mapping from a scanned span to a typed one. See `#typed`. */
  typed(date: DateKey, s: ScannedSpan): TypedSpan {
    return this.#typed(date, s)
  }

  /**
   * A scanned span becomes a typed one.
   *
   * **The only implementation, and it has to stay that way.** `LocalWindow`
   * had a second copy whose last branch was `{ kind: 'tag' }`, so the moment a
   * new kind arrived — comments — every one of them reached the renderer
   * labelled a tag: `spans('comment')` was empty, the margin drew nothing, and
   * the tag rail would have drawn them. A switch with a fallthrough default is
   * a mapping that silently mislabels whatever it has not been taught.
   */
  #typed(date: DateKey, s: ScannedSpan): TypedSpan {
    const span: Span = { begin: this.at(date, s.from), end: this.at(date, s.to) }
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
