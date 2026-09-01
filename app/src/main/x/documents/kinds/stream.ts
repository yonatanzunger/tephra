// The stream as one logical document (D8): days as segments, appended to at one
// end, split into files by date.
//
// **What is left here is what makes it a STREAM** — how a day is loaded and how
// its split parts are joined, what days there are, what "today" means, and the
// operations only a dated document can answer. Everything else is
// `SegmentedDocument`, which any kind inherits (D54).

import type {
  DateKey, Document, DocumentChange, DocumentId, DocumentMeta, DocumentPosition,
  DocumentWindow, Edit, EditOrigin, DocumentOffset, SegmentKey, SessionGeneration, Span,
  SpanKind, StreamDocumentApi, TypedSpan, Unsubscribe, VersionId, Divergence, DocumentText,
} from '../../../../shared/document-api.ts'
import { addDays, compareDateKeys, dateKeyAt } from '../../../../shared/dates.ts'
import { StalePositionError, offsetOf } from '../../../../shared/positions.ts'
import type { Notebook } from '../../../w/notebook.ts'
import { attachmentFile, dayFile, noteFile, parseDayFile, relativePath, type RelPath, STREAM_DIR } from '../../../w/layout.ts'
import { createHash } from 'node:crypto'
import { frontmatterFor, parseFile, renderFrontmatter } from '../../frontmatter.ts'
import { markerRemoval, placeMarker, retagBody, subjectKey, tagBody, type ScannedSpan } from '../../markers.ts'
import type { Anomaly } from '../../../../shared/anomalies.ts'
import type { RestoreReport } from '../../../../shared/history-api.ts'
import { Segment } from '../../segment.ts'


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
} from '../../comments.ts'
import type { CommentId, CommentMessage, CommentThread } from '../../../../shared/comments.ts'
import type { DayProse } from '../../../../shared/ipc.ts'
import { stripHandles } from '../../../../shared/prose.ts'
import { applyEdits, composeEdits, invertEdits, mapOffset, minimalReplacement, type TextEdit } from '../../text-edits.ts'
import { LocalWindow } from '../../window.ts'

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

import { SegmentedDocument } from '../segmented.ts'
import { STREAM_ID } from '../../../../shared/document-api.ts'

export class StreamDocument extends SegmentedDocument implements StreamDocumentApi {
  readonly id = STREAM_ID
  readonly meta: DocumentMeta & { readonly kind: 'stream' } = { kind: 'stream' }

  /** Read a day off disk, parts and all — the stream's answer to `load`. */
  protected async load(date: SegmentKey): Promise<Segment> {
    const rel = dayFile(date)
    const text = await this.notebook.read(rel)
    return text === null
      ? Segment.empty(date, rel, renderFrontmatter(frontmatterFor(date, 'stream')))
      : Segment.load(date, rel, text + (await this.#laterParts(date)))
  }

  /** Every date with a file on disk, ascending. A scan; never on the hot path. */
  async dates(): Promise<readonly DateKey[]> {
    const found: DateKey[] = []
    for (const rel of await this.notebook.list(STREAM_DIR)) {
      const ref = parseDayFile(rel)
      if (ref !== null && ref.part === 1) found.push(ref.date)
    }
    for (const [date, segment] of this.segments) {
      if (segment.dirty && !found.includes(date)) found.push(date)
    }
    return found.sort(compareDateKeys)
  }

  async extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null> {
    const dates = await this.keys()
    if (dates.length === 0) return null
    return { first: dates[0] as DateKey, last: dates[dates.length - 1] as DateKey }
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
    for (const date of await this.keys()) {
      if (compareDateKeys(date, first) < 0 || compareDateKeys(date, last) > 0) continue
      const segment = await this.segment(date)
      if (stripHandles(segment.prose.text).trim() === '') continue
      out.push({ date, prose: { text: segment.prose.text, annotations: segment.prose.annotations } })
    }
    return out
  }

  dateAt(at: DocumentPosition): DateKey {
    // Synchronous, because in the stream the segment IS the date (D27). No null
    // case: a position in a stream is in a day, and this is a stream (D54).
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

    const segment = this.segments.get(ref.date)
    if (segment === undefined) return // not loaded; the next read gets it fresh

    const text = await this.notebook.read(rel)
    const theirs = text === null ? ('' as DocumentText) : parseFile(text).body
    if (theirs === segment.body) return // same content, nothing to say

    if (segment.dirty) {
      segment.markDiverged()
      for (const handler of this.divergeHandlers) {
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

    const from = this.gen
    this.gen = (from + 1) as SessionGeneration
    const change: DocumentChange = {
      from,
      to: this.gen,
      edits: [
        {
          span: {
            begin: this.at(ref.date, replacement.from),
            end: this.at(ref.date, replacement.to),
          },
          payload: replacement.insert,
        },
      ],
      origin: 'external',
      at: Date.now(),
    }
    for (const handler of this.changeHandlers) handler(change)
    for (const window of this.windows) window.documentChanged(change)
  }

  /** Days whose disk copy and buffer disagree, and which are not being written. */
  divergedDates(): readonly DateKey[] {
    return [...this.segments.entries()].filter(([, s]) => s.diverged).map(([date]) => date)
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
    await this.notebook.write(rel, original.content)

    const link = relativePath(dayFile(date), rel)
    const block = `*Imported ${date} from [the clipboard](${link}).*\n\n${text.trim()}`
    const placed = insertBlockAt(segment.body, at.offset as number, block)
    await this.writeBody(date, segment.body, placed)
    return rel
  }

  async branch(span: Span, name: string): Promise<DocumentId> {
    const title = name.trim()
    if (title === '') throw new Error('a branched file needs a name')

    const pieces: { date: DateKey; from: number; to: number; text: string }[] = []
    for (const date of await this.segmentsAcross(span)) {
      const segment = await this.segment(date)
      const from = date === (span.begin.segment as DateKey) ? (span.begin.offset as number) : 0
      const wanted = date === (span.end.segment as DateKey) ? (span.end.offset as number) : segment.body.length
      // **A day keeps the newline that ends it.**
      //
      // The window flattens days with nothing between them, so a day whose body
      // stops without one runs into the first line of the day after it — and
      // the date seam above that day is a BLOCK widget, which cannot sit
      // mid-line, so it is silently skipped and never comes back. Reported from
      // use as "branching made the date break stop rendering"; the files were
      // right the whole time, and the branch had taken one character too many.
      //
      // A cross-midnight DELETION may do exactly that, and should: joining two
      // days is what a reader asking to delete across the boundary means. A
      // branch is not a deletion — it moves a passage out and leaves a link
      // behind — so it has no business consuming the separator, and the moved
      // text is trimmed anyway.
      const to =
        wanted === segment.body.length && segment.body.endsWith('\n') ? wanted - 1 : wanted
      if (to > from) pieces.push({ date, from, to, text: segment.body.slice(from, to) })
    }
    const moved = pieces.map(p => p.text).join('\n').trim()
    if (moved === '') throw new Error('there is nothing in the selection to branch')

    // 1. CREATE. No date, ever: a branched file is not in the dated stream, and
    //    giving it one to pretend otherwise is the contortion D27 refuses. The
    //    title is carried in frontmatter because the slug is not reversible.
    const rel = await this.#unusedNoteFile(title)
    // **Through a document, not around one.** Writing the file here would leave
    // the corpus with a document nothing had opened — and if something HAD it
    // open, its buffer would win the next time a write tier ran. The Corpus
    // hands every document this verb because it is the only thing that can
    // (MC7).
    //
    // The title travels beside the body rather than inside it: frontmatter is
    // the document's, and composing one here writes it twice. No date, ever —
    // a branched file is not in the dated stream, and giving it one to pretend
    // otherwise is the contortion D27 refuses.
    await this.createDocument(rel as string as DocumentId, `\n${moved}\n` as DocumentText, title)

    // 2. UPDATE REFERENCES. Nothing to update yet — see above.

    // 3. DELETE, leaving the link in the first day the range touched. One batch,
    //    so a branch is one undo step.
    const first = pieces[0] as { date: DateKey; from: number; to: number }
    const link = `[${title}](${relativePath(dayFile(first.date), rel)})`
    await this.replace(
      pieces.map((piece, index) => ({
        span: {
          begin: this.at(piece.date, piece.from),
          end: this.at(piece.date, piece.to),
        },
        payload: (index === 0 ? link : '') as DocumentText,
      })),
      'operation',
    )
    return rel as DocumentId
  }


  /**
   * A path no file is using. Two branches named the same thing is an ordinary
   * thing to do a year apart, and silently writing over the first would destroy
   * exactly the material this operation exists to preserve.
   */
  async #unusedNoteFile(title: string): Promise<RelPath> {
    const base = noteFile(title)
    if (!(await this.notebook.has(base))) return base
    for (let n = 2; n < 1000; n++) {
      const candidate = base.replace(/\.md$/, `-${n}.md`) as RelPath
      if (!(await this.notebook.has(candidate))) return candidate
    }
    throw new Error(`there are already a thousand files named like ${base}`)
  }

  /** Bodies of parts 2..n, concatenated. Empty for the ordinary one-part day. */
  async #laterParts(date: DateKey): Promise<string> {
    let out = ''
    for (let part = 2; ; part++) {
      const text = await this.notebook.read(dayFile(date, part))
      if (text === null) return out
      out += parseFile(text).body
    }
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
  /**
   * A day is several files when it has been split, and all of them go.
   *
   * Removing only the first leaves the rest behind, to be read back as that
   * day's tail — a day that was restored to nothing, still holding half of what
   * it said (D20).
   */
  protected override async removeSegment(key: SegmentKey): Promise<void> {
    const date = key as DateKey
    for (let part = 1; part <= MAX_PARTS; part++) {
      const rel = dayFile(date, part)
      if (!(await this.notebook.has(rel))) break
      await this.notebook.remove(rel)
    }
  }

  /** The date a new note goes to, in the reference zone (D38). */
  static today(): DateKey {
    return dateKeyAt()
  }
  /** Every date with a file on disk, ascending — the segments this document has. */
  async keys(): Promise<readonly SegmentKey[]> {
    return this.dates()
  }
}



export { offsetOf }
