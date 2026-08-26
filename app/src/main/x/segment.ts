// One segment of the stream: a day, loaded from its file.
//
// A segment owns the file's exact bytes and the body those bytes contain. An
// DocumentOffset indexes the BODY, not the file — frontmatter is metadata X manages,
// not text the user is editing, and if offsets included it then editing a
// keyword would silently move every position in the day.

import type { DateKey, DocumentText, ProseOffset, TypedSpan } from '../../shared/document-api.ts'
import { frontmatterFor, parseFile, renderFrontmatter, spliceBody, type ParsedFile } from './frontmatter.ts'
import {
  resolveAnchors, resolvePairs, resolveTags, scanMarkers,
  type DocumentMarker, type ScannedSpan,
} from './markers.ts'
import { threadsIn } from './comments.ts'
import { proseOf, proseMarkers, type Prose } from './prose.ts'

/**
 * A span as the scanner produces it: body offsets, not document positions.
 *
 * `resolved` is a comment's, and is absent everywhere else rather than false
 * everywhere else — a heading is not an unresolved anything.
 */
import { findAnomalies } from './anomalies.ts'
import { splitBody, SPLIT_THRESHOLD } from './split.ts'
import { dayFile } from '../w/layout.ts'
import type { Anomaly } from '../../shared/anomalies.ts'
import type { RelPath } from '../w/layout.ts'

export class Segment {
  readonly date: DateKey
  readonly rel: RelPath

  /** The file exactly as read. Never regenerated — spliced (format-spec). */
  #original: string
  #parsed: ParsedFile
  #body: DocumentText
  #dirty = false
  #diverged = false

  /** Lazily computed and dropped on every edit; scanning is cheap, staleness is not. */
  #markers: readonly DocumentMarker[] | null = null
  #prose: Prose<ProseOffset> | null = null

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
  get prose(): Prose<ProseOffset> {
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

  /** Every span in this segment, in body coordinates. */
  spans(): readonly ScannedSpan[] {
    const markers = this.#scan()
    const out: ScannedSpan[] = []

    out.push({ kind: 'date', name: this.date, level: 0, from: 0, to: this.#body.length })

    for (const m of markers) {
      if (m.kind === 'heading') {
        out.push({ kind: 'heading', name: m.name, level: m.level, from: m.from, to: m.to })
      } else if (m.kind === 'anchor') {
        // Zero-length: an anchor is a point that travels with the text (D20).
        out.push({ kind: 'anchor', name: m.name, level: 0, from: m.from, to: m.from })
      }
    }

    for (const t of resolveTags(markers, this.#body)) {
      out.push({ kind: 'tag', name: t.name, level: 0, from: t.from, to: t.to })
    }

    // Comment anchors pair exactly as tags do — a named start, a named end,
    // strictly alternating — so the same resolver does them, degradation rules
    // included. Whether a thread is resolved lives in its first block.
    const resolved = new Set(
      threadsIn(this.#body).filter(thread => thread.resolved).map(thread => thread.id as string),
    )
    for (const c of resolvePairs(markers, this.#body, 'comment-start', 'comment-end')) {
      out.push({
        kind: 'comment',
        name: c.name,
        level: 0,
        resolved: resolved.has(c.name),
        from: c.from,
        to: c.to,
      })
    }

    return out.sort((a, b) => a.from - b.from || a.to - b.to)
  }

  anchorAt(name: string): number | null {
    const found = resolveAnchors(this.#scan()).get(name)
    return found === undefined ? null : found.from
  }

  anchorNames(): readonly string[] {
    return [...resolveAnchors(this.#scan()).keys()]
  }
}
