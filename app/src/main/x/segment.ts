// One segment of the stream: a day, loaded from its file.
//
// A segment owns the file's exact bytes and the body those bytes contain. An
// Offset indexes the BODY, not the file — frontmatter is metadata X manages,
// not text the user is editing, and if offsets included it then editing a
// keyword would silently move every position in the day.

import type { DateKey, TypedSpan } from '../../shared/document-api.ts'
import { parseFile, spliceBody, type ParsedFile } from './frontmatter.ts'
import { resolveAnchors, resolveTags, scanMarkers, type RawMarker } from './markers.ts'
import type { RelPath } from '../w/layout.ts'

export class Segment {
  readonly date: DateKey
  readonly rel: RelPath

  /** The file exactly as read. Never regenerated — spliced (format-spec). */
  #original: string
  #parsed: ParsedFile
  #body: string
  #dirty = false

  /** Lazily computed and dropped on every edit; scanning is cheap, staleness is not. */
  #markers: readonly RawMarker[] | null = null

  private constructor(date: DateKey, rel: RelPath, original: string) {
    this.date = date
    this.rel = rel
    this.#original = original
    this.#parsed = parseFile(original)
    this.#body = this.#parsed.body
  }

  static load(date: DateKey, rel: RelPath, fileText: string): Segment {
    return new Segment(date, rel, fileText)
  }

  /** A day that does not exist yet. Its file appears when something is written. */
  static empty(date: DateKey, rel: RelPath, header: string): Segment {
    return new Segment(date, rel, header)
  }

  get body(): string {
    return this.#body
  }

  get length(): number {
    return this.#body.length
  }

  get dirty(): boolean {
    return this.#dirty
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

  setBody(body: string): void {
    if (body === this.#body) return
    this.#body = body
    this.#dirty = true
    this.#markers = null
  }

  /** The bytes to write: original file with only the body replaced. */
  serialise(): string {
    return spliceBody(this.#original, this.#parsed, this.#body)
  }

  markClean(written: string): void {
    this.#original = written
    this.#parsed = parseFile(written)
    this.#dirty = false
  }

  #scan(): readonly RawMarker[] {
    this.#markers ??= scanMarkers(this.#body)
    return this.#markers
  }

  /** Every span in this segment, in body coordinates. */
  spans(): readonly { kind: TypedSpan['kind']; name: string; level: number; from: number; to: number }[] {
    const markers = this.#scan()
    const out: { kind: TypedSpan['kind']; name: string; level: number; from: number; to: number }[] = []

    out.push({ kind: 'date', name: this.date, level: 0, from: 0, to: this.#body.length })

    for (const m of markers) {
      if (m.kind === 'heading') {
        out.push({ kind: 'heading', name: m.name, level: m.level, from: m.from, to: m.to })
      } else if (m.kind === 'anchor') {
        // Zero-length: an anchor is a point that travels with the text (D20).
        out.push({ kind: 'anchor', name: m.name, level: 0, from: m.from, to: m.from })
      }
    }

    for (const t of resolveTags(markers, this.#body.length)) {
      out.push({ kind: 'tag', name: t.name, level: 0, from: t.from, to: t.to })
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
