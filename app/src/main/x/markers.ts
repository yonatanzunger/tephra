// Scanning a segment's body for the spans the API exposes: headings, anchors
// and tags.
//
// FENCE-AWARE, NOT REGEX. This is a physics notebook; it will contain fenced
// code, and code *about* Tephra will contain Tephra markers. A regex scan finds
// them and corrupts the document's idea of itself — wrongly, invisibly, and
// only once you have written about the thing you are building. A scan that
// tracks fences and inline code costs almost nothing and is simply correct.
//
// Spans are INFERRED FROM THE TEXT, never stored beside it (D20). There is no
// id anywhere here, because inference leaves nothing for one to identify (D21).

export type RawSpanKind = 'heading' | 'anchor' | 'tag-start' | 'tag-end'

export interface RawMarker {
  readonly kind: RawSpanKind
  readonly name: string
  /** Offsets into the body. For markers, the whole comment; for headings, the line. */
  readonly from: number
  readonly to: number
  /** Headings only. */
  readonly level: number
}

const MARKER = /<!--tephra:(mark|tag-start|tag-end)[ \t]+([^\n]*?)-->/g
const ATX = /^(#{1,6})[ \t]+(.*?)[ \t]*$/

/**
 * Regions of the body that are code and must not be interpreted.
 *
 * Covers fenced blocks (``` and ~~~, honouring the opening fence's length and
 * indentation), indented code blocks, and inline code spans. Not a full
 * CommonMark implementation — it is the subset that decides whether a marker is
 * text or content, which is the only question being asked here.
 */
export function codeRegions(body: string): readonly (readonly [number, number])[] {
  const out: [number, number][] = []
  let offset = 0
  let fence: { char: string; length: number; indent: number; start: number } | null = null

  for (const line of splitLinesKeepingEnds(body)) {
    const text = line.replace(/\r?\n$/, '')
    const indent = text.length - text.trimStart().length
    const trimmed = text.trimStart()

    if (fence !== null) {
      // A closing fence is the same character, at least as long, no info string.
      const m = /^(`{3,}|~{3,})[ \t]*$/.exec(trimmed)
      if (m !== null && (m[1] as string)[0] === fence.char && (m[1] as string).length >= fence.length) {
        out.push([fence.start, offset + line.length])
        fence = null
      }
      offset += line.length
      continue
    }

    const open = /^(`{3,}|~{3,})(.*)$/.exec(trimmed)
    if (open !== null && indent < 4) {
      const marks = open[1] as string
      // An opening ``` fence may not contain a backtick in its info string.
      if (!(marks[0] === '`' && (open[2] as string).includes('`'))) {
        fence = { char: marks[0] as string, length: marks.length, indent, start: offset }
        offset += line.length
        continue
      }
    }

    // An indented code block: four spaces, and not a lazy continuation of a
    // paragraph. Treating every indented line as code would swallow list
    // continuations, so only fully blank-separated indentation counts here.
    if (indent >= 4 && trimmed !== '') out.push([offset, offset + line.length])

    offset += line.length
  }

  if (fence !== null) out.push([fence.start, body.length]) // unterminated fence runs to the end

  // Inline code spans, outside the block regions found above.
  for (const [start, end] of inlineCodeSpans(body)) {
    if (!out.some(([a, b]) => start >= a && end <= b)) out.push([start, end])
  }

  return out.sort((a, b) => a[0] - b[0])
}

/** Matched runs of backticks on one line, per CommonMark's equal-length rule. */
function inlineCodeSpans(body: string): (readonly [number, number])[] {
  const out: [number, number][] = []
  const re = /(`+)([^\n]*?)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) out.push([m.index, m.index + m[0].length])
  return out
}

function splitLinesKeepingEnds(text: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

const inAny = (regions: readonly (readonly [number, number])[], at: number): boolean =>
  regions.some(([a, b]) => at >= a && at < b)

/**
 * Every marker and heading in the body, in document order, skipping code.
 *
 * Markers are HTML comments — invisible in any renderer, greppable, hand-typable
 * and self-describing to a reader fifteen years from now (format-spec).
 */
export function scanMarkers(body: string): readonly RawMarker[] {
  const code = codeRegions(body)
  const out: RawMarker[] = []

  MARKER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER.exec(body)) !== null) {
    if (inAny(code, m.index)) continue
    const verb = m[1] as string
    const name = (m[2] as string).trim()
    if (name === '') continue // an unnamed marker names nothing; ignore it
    out.push({
      kind: verb === 'mark' ? 'anchor' : (verb as RawSpanKind),
      name,
      from: m.index,
      to: m.index + m[0].length,
      level: 0,
    })
  }

  let offset = 0
  for (const line of splitLinesKeepingEnds(body)) {
    const text = line.replace(/\r?\n$/, '')
    if (!inAny(code, offset)) {
      const h = ATX.exec(text)
      if (h !== null) {
        out.push({
          kind: 'heading',
          name: (h[2] as string).trim(),
          from: offset,
          to: offset + text.length,
          level: (h[1] as string).length,
        })
      }
    }
    offset += line.length
  }

  return out.sort((a, b) => a.from - b.from)
}

/**
 * Subjects compare case-insensitively and whitespace-normalised, but are stored
 * as typed (format-spec) — so *House Deal* and *house deal* are one subject and
 * the capitalisation the user chose survives in the file.
 */
export function subjectKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface ResolvedTag {
  readonly name: string
  readonly from: number
  readonly to: number
  /** True when no matching end was found and the span was bounded by the segment. */
  readonly unterminated: boolean
}

/**
 * Pair tag markers into spans.
 *
 * Same-subject spans may not overlap, so markers for one subject strictly
 * alternate and pairing needs no identifiers (format-spec). Degradation is
 * specified rather than incidental: an unmatched `tag-start` runs to the end of
 * its SEGMENT — a bounded blast radius, not the whole document — and an
 * unmatched `tag-end` is ignored.
 */
export function resolveTags(markers: readonly RawMarker[], bodyLength: number): readonly ResolvedTag[] {
  const open = new Map<string, RawMarker>()
  const out: ResolvedTag[] = []

  for (const marker of markers) {
    if (marker.kind === 'tag-start') {
      // A second start for a subject already open cannot be nested; the first
      // one wins and this is a no-op, which keeps alternation true.
      if (!open.has(subjectKey(marker.name))) open.set(subjectKey(marker.name), marker)
    } else if (marker.kind === 'tag-end') {
      const start = open.get(subjectKey(marker.name))
      if (start === undefined) continue // no start: ignored, per the table
      open.delete(subjectKey(marker.name))
      out.push({ name: start.name, from: start.to, to: marker.from, unterminated: false })
    }
  }

  for (const start of open.values()) {
    out.push({ name: start.name, from: start.to, to: bodyLength, unterminated: true })
  }

  return out.sort((a, b) => a.from - b.from)
}

/** Anchor names are unique within a file; the first wins (format-spec). */
export function resolveAnchors(markers: readonly RawMarker[]): ReadonlyMap<string, RawMarker> {
  const out = new Map<string, RawMarker>()
  for (const m of markers) {
    if (m.kind !== 'anchor') continue
    if (!out.has(m.name)) out.set(m.name, m)
  }
  return out
}
