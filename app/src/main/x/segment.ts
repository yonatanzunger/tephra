// One segment of the stream: a day, loaded from its file.
//
// A segment owns the file's exact bytes and the body those bytes contain. An
// DocumentOffset indexes the BODY, not the file — frontmatter is metadata X manages,
// not text the user is editing, and if offsets included it then editing a
// keyword would silently move every position in the day.

import type { DateKey, DocumentText, SegmentKey, TypedSpan } from '../../shared/document-api.ts'
import { frontmatterFor, parseFile, renderFrontmatter, spliceBody, type ParsedFile } from './frontmatter.ts'
import {
  resolveAnchors, scanMarkers, scanSpans,
  type DocumentMarker, type ScannedSpan,
} from './markers.ts'
import { threadsIn } from './comments.ts'
import { proseOf, proseMarkers, type SegmentProse } from './prose.ts'

/**
 * A span as the scanner produces it: body offsets, not document positions.
 *
 * `resolved` is a comment's, and is absent everywhere else rather than false
 * everywhere else — a heading is not an unresolved anything.
 */
import { findAnomalies } from './anomalies.ts'
import { splitBody, SPLIT_THRESHOLD } from './split.ts'
import { dayFile, parseDayFile } from '../w/layout.ts'
import type { Anomaly } from '../../shared/anomalies.ts'
import type { RelPath } from '../w/layout.ts'

export class Segment {
  readonly date: DateKey
  readonly rel: RelPath

  /** Whether this segment is a day of the stream, and so covers itself (D51). */
  #dated = true

  /** The file exactly as read. Never regenerated — spliced (format-spec). */
  #original: string
  #parsed: ParsedFile
  #body: DocumentText
  #dirty = false
  #diverged = false

  /** Lazily computed and dropped on every edit; scanning is cheap, staleness is not. */
  #markers: readonly DocumentMarker[] | null = null
  #prose: SegmentProse | null = null

  private constructor(date: DateKey, rel: RelPath, original: string) {
    this.date = date
    this.rel = rel
    this.#original = original
    this.#parsed = parseFile(original)
    this.#body = this.#parsed.body as DocumentText
  }

  static load(date: DateKey, rel: RelPath, fileText: string): Segment {
    return new Segment(date, rel, fileText)
  }

  /**
   * A segment that is not a day: one file, one document, no date.
   *
   * The key is the constant every one-segment document uses (D27, D54), and it
   * is not a date — which is exactly what `dated` records.
   */
  static forFile(key: SegmentKey, rel: RelPath, fileText: string): Segment {
    const made = new Segment(key as DateKey, rel, fileText)
    made.#dated = false
    return made
  }

  /** A day that does not exist yet. Its file appears when something is written. */
  static empty(date: DateKey, rel: RelPath, header: string): Segment {
    return new Segment(date, rel, header)
  }

  get body(): DocumentText {
    return this.#body
  }

  /**
   * What the degradation table did to this file (format-spec.md). Derived, not
   * stored, and recomputed from the current body — so repairing a file by hand
   * makes the report go away on the next read, with nothing to invalidate.
   */
  anomalies(): readonly Anomaly[] {
    return findAnomalies({
      file: this.rel,
      date: this.date,
      parsed: this.#parsed,
      markers: this.#scan(),
      bodyOffset: this.#parsed.blockEnd,
      text: this.#parsed.blockEnd === 0 ? this.#body : this.#original,
    })
  }

  get length(): number {
    return this.#body.length
  }

  /**
   * Whether this day is nothing but its frontmatter, and that frontmatter says
   * nothing a person put there.
   *
   * The distinction matters for removal: a contentless day is not a day, but a
   * contentless day carrying keys someone added by hand is a note in itself,
   * and "unknown keys are preserved verbatim" (format-spec) would be an odd
   * promise to keep on rewrite and break by deletion.
   */
  get disposable(): boolean {
    return this.#body.trim() === '' && (this.#parsed.frontmatter?.extra.length ?? 0) === 0
  }

  /**
   * The prose view of this body — the text with marker syntax taken out and
   * handles standing in for the markers a person can point at (D44).
   *
   * Cached beside the marker scan and invalidated with it, because the two are
   * derived from the same walk of the same string.
   */
  get prose(): SegmentProse {
    if (this.#prose === null) {
      this.#prose = proseOf(this.#body, proseMarkers(this.#body), this.spans(), threadsIn(this.#body))
    }
    return this.#prose
  }

  get dirty(): boolean {
    return this.#dirty
  }

  /**
   * Someone changed this file on disk while we held unsaved edits to it.
   *
   * The segment is then FROZEN for writing. Not because the situation is
   * unrecoverable, but because every automatic resolution loses something: our
   * write clobbers their hand-edit, their reload clobbers our typing. D12 asks
   * for correct, visible and recoverable rather than seamless — so nothing is
   * written until a person decides, and the picker that lets them decide is
   * v2a's work, not a silent guess made now.
   */
  get diverged(): boolean {
    return this.#diverged
  }

  markDiverged(): void {
    this.#diverged = true
  }

  /**
   * A file whose frontmatter could not be parsed is READ-ONLY, permanently, for
   * as long as that holds. Never overwrite what you could not read.
   */
  get readOnly(): boolean {
    return this.#parsed.unparseable
  }

  /** The date the file claims, which outranks its name (format-spec). */
  get declaredDate(): DateKey | null {
    return this.#parsed.frontmatter?.date ?? null
  }

  setBody(body: DocumentText): void {
    if (body === this.#body) return
    this.#body = body
    this.#dirty = true
    this.#markers = null
    this.#prose = null
  }

  /** The bytes to write: original file with only the body replaced. */
  serialise(): string {
    return spliceBody(this.#original, this.#parsed, this.#body)
  }

  /**
   * The files this day should become — one entry per part (format-spec, D20).
   *
   * **A day that fits in one file takes the untouched path**: the original bytes
   * with only the body spliced in, preserving everything it did not change byte
   * for byte. That is the case essentially always, and it is the one where a
   * regenerated file would silently reformat YAML key order or list markers and
   * turn every save into a diff.
   *
   * Only a day past the threshold takes the second path, where later parts have
   * no original bytes to preserve and are rendered fresh. Trading byte-exactness
   * for the ability to split at all is a fair trade in a case that arrives once
   * every few years; making the common case pay for it would not be.
   */
  files(threshold = SPLIT_THRESHOLD): readonly { rel: RelPath; text: string }[] {
    const parts = splitBody(this.#body, threshold)
    if (parts.length === 1) return [{ rel: this.rel, text: this.serialise() }]

    // **Only a day splits.** The naming below is `dayFile(date, part)`, so a
    // one-segment document past the threshold would write itself into the
    // stream's directory under a date it does not have. A note that large is a
    // problem for another day; writing it somewhere false is a problem now.
    if (parseDayFile(this.rel) === null) return [{ rel: this.rel, text: this.serialise() }]

    const base = this.#parsed.frontmatter ?? frontmatterFor(this.date, 'stream')
    return parts.map((body, i) => {
      const part = i + 1
      if (part === 1) {
        return { rel: dayFile(this.date, 1), text: spliceBody(this.#original, this.#parsed, body) }
      }
      return {
        rel: dayFile(this.date, part),
        text: renderFrontmatter({ ...base, part }) + body,
      }
    })
  }

  markClean(written: string): void {
    this.#original = written
    this.#parsed = parseFile(written)
    this.#dirty = false
  }

  /** Take the file's current contents as truth. Only ever called when clean. */
  adopt(fileText: string): void {
    this.#original = fileText
    this.#parsed = parseFile(fileText)
    this.#body = this.#parsed.body as DocumentText
    this.#dirty = false
    this.#markers = null
    this.#prose = null
  }

  /** The markers in this body, cached beside the prose view. */
  markers(): readonly DocumentMarker[] {
    return this.#scan()
  }

  #scan(): readonly DocumentMarker[] {
    this.#markers ??= scanMarkers(this.#body)
    return this.#markers
  }

  /**
   * Every span in this segment, in body coordinates.
   *
   * The whole-body `date` span is the SEGMENT's contribution — a day covers
   * itself, and that is what makes the outline a tree (D51). Everything else
   * comes from the shared scan, which any markdown file can be put through
   * whether or not it is a day.
   */
  /**
   * Every span in this segment, the whole-body one included when there is one.
   *
   * **Only a DAY covers itself.** That span is what makes the outline a tree
   * (D51) and it is a fact about the stream: a note's single segment is not a
   * date, and emitting one meant every note carried a span named `content`
   * pretending to be a day. `dated` is how a segment knows which it is — the
   * kind decides at construction, because the kind is what knows.
   */
  spans(): readonly ScannedSpan[] {
    const own = scanSpans(this.#body, this.#scan())
    if (!this.#dated) return own
    return [{ kind: 'date', name: this.date, level: 0, from: 0, to: this.#body.length }, ...own]
  }

  anchorAt(name: string): number | null {
    const found = resolveAnchors(this.#scan()).get(name)
    return found === undefined ? null : found.from
  }

  anchorNames(): readonly string[] {
    return [...resolveAnchors(this.#scan()).keys()]
  }
}
