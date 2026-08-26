import { applyEdits, type TextEdit } from './text-edits.ts'
import type { DocumentText, TypedSpan } from '../../shared/document-api.ts'
import { threadsIn } from './comments.ts'

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

/**
 * What a single walk of a body finds — **the scanner's vocabulary, not the
 * API's.**
 *
 * This is not a raw version of `SpanKind`, and the old name `RawSpanKind` said
 * it was. They describe different things and neither is derived from the other:
 * here a tag is a `tag-start` and a `tag-end`, two separate findings, because
 * that is what is in the text; there a tag is ONE span, because that is what a
 * reader has. `SpanKind` also contains `date`, which no marker produces.
 * Resolving the first into the second is `resolveTags`'s whole job.
 *
 * `heading` rides along because it comes out of the same walk and there is no
 * reason to walk twice.
 */
export type MarkerKind =
  | 'heading'
  | 'anchor'
  | 'tag-start'
  | 'tag-end'
  /** A comment's anchor: a handle and a boundary, exactly as a tag's are (D47). */
  | 'comment-start'
  | 'comment-end'
  /** Identifies a thread block. Sits at the END of its byline, never the start. */
  | 'comment'

export interface DocumentMarker {
  readonly kind: MarkerKind
  readonly name: string
  /** Offsets into the body. For markers, the whole comment; for headings, the line. */
  readonly from: number
  readonly to: number
  /** Headings only. */
  readonly level: number
}

const MARKER = /<!--tephra:(mark|tag-start|tag-end|comment-start|comment-end|comment)[ \t]+([^\n]*?)-->/g
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
export function scanMarkers(body: string): readonly DocumentMarker[] {
  const code = codeRegions(body)
  const out: DocumentMarker[] = []

  MARKER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER.exec(body)) !== null) {
    if (inAny(code, m.index)) continue
    const verb = m[1] as string
    const name = (m[2] as string).trim()
    if (name === '') continue // an unnamed marker names nothing; ignore it
    out.push({
      kind: verb === 'mark' ? 'anchor' : (verb as MarkerKind),
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
 *
 * **Resolved spans are trimmed to the text they cover.** A marker may not begin
 * a line, so a tag over a paragraph has its start parked at the end of the line
 * above — which would otherwise leave the newline inside the span, and a tag on
 * the very first paragraph of a body starting on a line break it does not mean.
 * `normalise` already trims on the way in; this makes the way out agree.
 */
export function resolveTags(markers: readonly DocumentMarker[], body: string): readonly ResolvedTag[] {
  return resolvePairs(markers, body, 'tag-start', 'tag-end')
}

/**
 * Pair start/end markers of one kind into spans.
 *
 * Tags and comment anchors are the same shape — a named start, a named end,
 * strictly alternating for one name — so they are the same resolver, degradation
 * rules included. Comments do not overlap themselves any more than tags do,
 * because two comments on one passage have different ids.
 */
export function resolvePairs(
  markers: readonly DocumentMarker[],
  body: string,
  startKind: MarkerKind,
  endKind: MarkerKind,
): readonly ResolvedTag[] {
  const open = new Map<string, DocumentMarker>()
  const out: ResolvedTag[] = []

  for (const marker of markers) {
    if (marker.kind === startKind) {
      // A second start for a name already open cannot be nested; the first one
      // wins and this is a no-op, which keeps alternation true.
      if (!open.has(subjectKey(marker.name))) open.set(subjectKey(marker.name), marker)
    } else if (marker.kind === endKind) {
      const start = open.get(subjectKey(marker.name))
      if (start === undefined) continue // no start: ignored, per the table
      open.delete(subjectKey(marker.name))
      out.push(trimmed(body, start.name, start.to, marker.from, false))
    }
  }

  for (const start of open.values()) {
    out.push(trimmed(body, start.name, start.to, body.length, true))
  }

  return out.sort((a, b) => a.from - b.from)
}

function trimmed(
  body: string,
  name: string,
  from: number,
  to: number,
  unterminated: boolean,
): ResolvedTag {
  let a = from
  let b = to
  while (a < b && /\s/.test(body[a] as string)) a++
  while (b > a && /\s/.test(body[b - 1] as string)) b--
  return { name, from: a, to: b, unterminated }
}

/** Anchor names are unique within a file; the first wins (format-spec). */
export function resolveAnchors(markers: readonly DocumentMarker[]): ReadonlyMap<string, DocumentMarker> {
  const out = new Map<string, DocumentMarker>()
  for (const m of markers) {
    if (m.kind !== 'anchor') continue
    if (!out.has(m.name)) out.set(m.name, m)
  }
  return out
}

/**
 * Where a marker may actually be written.
 *
 * **A comment that begins a paragraph's first line swallows the whole line.**
 * That is CommonMark's HTML-block rule, not a quirk of this editor — every
 * markdown renderer does it — so `<!--tephra:mark x-->**bold** text` loses its
 * bold everywhere, permanently, in the file. Found by bookmarking a boldfaced
 * phrase and watching the formatting disappear.
 *
 * Measured against the real parser, four placements and only one is safe
 * everywhere:
 *
 * | placement | result |
 * |---|---|
 * | starts a paragraph's first line | CommentBlock — all formatting on the line dies |
 * | starts a continuation line | fine |
 * | alone on its own line, mid-paragraph | **splits the paragraph in two** |
 * | end of the previous line | fine in both cases |
 *
 * So the rule is: **a marker never begins a line.** When the requested offset is
 * at a line start it moves back one character, before the newline — the same
 * position in the text stream, and for a zero-width mark an identical place.
 * At the very beginning of a body there is no previous line to move to, so the
 * marker takes its own line and a newline follows it — and the same applies when
 * the previous line is one whose meaning IS its exact contents. Appending to a
 * closing code fence stops it closing anything, so the fence runs on and every
 * marker after it becomes source code; appending to a table row or a setext
 * underline breaks those the same way. Found by tagging the first line of prose
 * after a fenced block.
 */
export function placeMarker(
  body: DocumentText,
  offset: number,
  marker: string,
): { readonly at: number; readonly text: DocumentText } {
  const at = Math.max(0, Math.min(offset, body.length))
  const startsLine = at === 0 || body[at - 1] === '\n'
  const contentFollows = at < body.length && body[at] !== '\n'

  if (!startsLine || !contentFollows) return { at, text: marker as DocumentText }
  // Nothing before it to hide behind, or a previous line whose meaning is its
  // exact contents: give it a line of its own. That is safe here precisely
  // because both cases sit at a block boundary, so there is no paragraph open
  // to be split.
  if (at === 0 || !canAppendTo(previousLine(body, at))) return { at, text: `${marker}\n` as DocumentText }
  return { at: at - 1, text: marker as DocumentText }
}

// ── writing tags ─────────────────────────────────────────────

/** One subject's worth of change: put it over a range, or take it off one. */
export interface TagOp {
  readonly subject: string
  readonly range: { readonly from: number; readonly to: number }
  readonly op: 'add' | 'remove'
}

/**
 * The body with subjects put over ranges, or taken off them.
 *
 * **One algorithm for both signs, every case within each, and any number of
 * subjects at once.** Tagging a range that already carries the subject must
 * extend or merge the existing span (format-spec); untagging the middle of a
 * span must split it in two; untagging an edge must trim it. Written as
 * separate cases that is four chances to leave the file with markers that no
 * longer alternate — and alternation is the *only* thing that makes pairing
 * work without identifiers (D21).
 *
 * So it is interval arithmetic. Strip every marker for every subject involved,
 * union or subtract each requested range, and write the resulting set back.
 * Merging, splitting, trimming and extending are then the same code path, and
 * alternation is true by construction, because the markers are emitted from a
 * disjoint sorted set.
 *
 * **Several subjects at once is what makes renaming a span possible.** A rename
 * is one subject losing a range and another gaining it, and doing that as two
 * calls cannot work: the first rewrites the body, so the range for the second
 * would have to be carried through a change that deleted the very markers it
 * was measured against. `minimalReplacement` reports that change as one
 * replacement spanning the whole tagged passage, which destroys exactly the
 * positions needed. Done together, both are measured against the same body.
 *
 * **Returns a body rather than edits, also deliberately.** The natural way to
 * write this is a batch of deletions and insertions, and it does not work: an
 * insertion's position is decided by text the deletions are removing. Rewriting
 * the string and letting `minimalReplacement` find the difference has no
 * coordinate system to get wrong. The caller pays one replacement spanning the
 * changed region, on an operation that happens once per menu invocation.
 */
export function retagBody(body: DocumentText, ops: readonly TagOp[]): DocumentText {
  const keys = new Set(ops.map(o => subjectKey(o.subject)))
  const all = scanMarkers(body)
  const involved = all.filter(
    m => (m.kind === 'tag-start' || m.kind === 'tag-end') && keys.has(subjectKey(m.name)),
  )

  // Everything below happens on the body with those markers gone, so that no
  // offset depends on a marker that is about to move.
  const cuts = involved.map(m => markerRemoval(body, m))
  const clean = applyEdits(body, cuts)
  const project = (offset: number): number => {
    let shed = 0
    for (const cut of cuts) {
      if (offset >= cut.to) shed += cut.to - cut.from
      else if (offset > cut.from) return cut.from - shed // inside a cut: to its near edge
    }
    return offset - shed
  }

  const others = scanMarkers(clean)
  const inserts: { at: number; text: string }[] = []

  for (const key of keys) {
    const mine = involved.filter(m => subjectKey(m.name) === key)
    const op = ops.find(o => subjectKey(o.subject) === key) as TagOp

    // Capitalisation the user already chose is not overwritten by a later
    // typing of the same subject: subjects compare case-insensitively but are
    // stored as typed, and the earlier typing is the one already on the page.
    const name = mine.length > 0 ? (mine[0] as DocumentMarker).name : op.subject.trim().replace(/\s+/g, ' ')

    const existing = resolveTags(mine, body).map(t => ({
      from: project(t.from),
      to: project(t.to),
    }))
    const asked = {
      from: project(clamp(op.range.from, body.length)),
      to: project(clamp(op.range.to, body.length)),
    }
    const wanted = normalise(op.op === 'add' ? [...existing, asked] : subtract(existing, asked), clean)

    for (const interval of wanted) {
      inserts.push(placed(clean, others, interval.from, `<!--tephra:tag-start ${name}-->`))
      inserts.push(placed(clean, others, interval.to, `<!--tephra:tag-end ${name}-->`))
    }
  }

  // Right to left, so each splice leaves the offsets of the ones still to come
  // untouched. Ties keep the order they were generated in, which for one
  // subject is document order.
  inserts.sort((a, b) => a.at - b.at)
  let out: string = clean
  for (let i = inserts.length - 1; i >= 0; i--) {
    const insert = inserts[i] as { at: number; text: string }
    out = out.slice(0, insert.at) + insert.text + out.slice(insert.at)
  }
  return out as DocumentText
}

/** The single-subject case, which is what tagging and untagging are. */
export function tagBody(
  body: DocumentText,
  subject: string,
  range: { readonly from: number; readonly to: number },
  op: 'add' | 'remove',
): DocumentText {
  return retagBody(body, [{ subject, range, op }])
}

const clamp = (offset: number, length: number): number => Math.max(0, Math.min(offset, length))

/**
 * Where a marker may actually land.
 *
 * Two hazards, both invisible until they have already corrupted a file: a
 * marker may not begin a line (`placeMarker`), and it may not land INSIDE
 * another marker's comment — which is reachable, because markers are hidden
 * behind widgets and a selection may quietly contain one.
 */
function placed(
  body: DocumentText,
  markers: readonly DocumentMarker[],
  at: number,
  text: string,
): { at: number; text: DocumentText } {
  let where = at
  for (const m of markers) {
    if (where > m.from && where < m.to) where = m.to
  }
  return placeMarker(body, where, text)
}

/**
 * What deleting a marker actually has to remove.
 *
 * A marker sitting alone on a line takes the line with it. Leaving the empty
 * line behind is not neutral — `A\n<!--m-->\nB` becomes `A\n\nB`, which is **two
 * paragraphs where there was one**. It is also what makes tagging and then
 * untagging exactly reversible, since a marker written at the very start of a
 * body is given its own line by `placeMarker` and there is nowhere else to put
 * it.
 */
export function markerRemoval(body: DocumentText, m: DocumentMarker): TextEdit<DocumentText> {
  const ownsLine = (m.from === 0 || body[m.from - 1] === '\n') && body[m.to] === '\n'
  return { from: m.from, to: ownsLine ? m.to + 1 : m.to, insert: '' as DocumentText }
}

/** Sorted, merged where only whitespace separates them, trimmed to real text. */
function normalise(
  intervals: readonly { from: number; to: number }[],
  body: string,
): readonly { from: number; to: number }[] {
  const sorted = [...intervals].filter(i => i.to > i.from).sort((a, b) => a.from - b.from || a.to - b.to)

  const merged: { from: number; to: number }[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    // Whitespace between two spans of the same subject is not a reason to keep
    // them apart: tagging a word and then the word after it means one span, and
    // a reader asking "everything tagged *house deal*" has never cared how many
    // separate spans there are (format-spec).
    if (last !== undefined && (interval.from <= last.to || body.slice(last.to, interval.from).trim() === '')) {
      last.to = Math.max(last.to, interval.to)
    } else {
      merged.push({ ...interval })
    }
  }

  // Trimmed to the text actually covered. A selection commonly runs a space or
  // a newline past the last word, and a span holding no text at all tags
  // nothing — this is also what makes tag-then-untag exactly reversible.
  const out: { from: number; to: number }[] = []
  for (const interval of merged) {
    let { from, to } = interval
    while (from < to && /\s/.test(body[from] as string)) from++
    while (to > from && /\s/.test(body[to - 1] as string)) to--
    if (to > from) out.push({ from, to })
  }
  return out
}

function subtract(
  intervals: readonly { from: number; to: number }[],
  cut: { from: number; to: number },
): readonly { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  for (const interval of intervals) {
    if (cut.to <= interval.from || cut.from >= interval.to) {
      out.push(interval) // untouched
      continue
    }
    if (cut.from > interval.from) out.push({ from: interval.from, to: cut.from })
    if (cut.to < interval.to) out.push({ from: cut.to, to: interval.to })
  }
  return out
}


const previousLine = (body: string, at: number): string => {
  const end = at - 1 // the newline before `at`
  const start = body.lastIndexOf('\n', end - 1) + 1
  return body.slice(start, end)
}

/**
 * Whether a marker may be appended to this line without changing what it means.
 *
 * Prose can take a trailing comment; a line that IS a delimiter cannot, because
 * the delimiter is recognised by the line holding nothing else.
 */
function canAppendTo(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return true // a blank line is still blank to a parser
  if (/^(`{3,}|~{3,})/.test(line.trimStart())) return false // a code fence, open or close
  if (/^(-{3,}|={3,}|\*{3,}|_{3,})$/.test(trimmed)) return false // thematic break, setext rule
  if (trimmed.startsWith('|')) return false // a table row
  if (/^ {4,}/.test(line)) return false // inside an indented code block
  return true
}

/**
 * One span as a scan found it: a kind, a name, and a range in the DOCUMENT's
 * own offsets.
 *
 * Lives here rather than on `Segment` because this is where scanning lives, and
 * because `proseOf` needs it to build a day's annotations — a segment importing
 * prose importing a segment is a cycle no one needs to think about.
 */
export interface ScannedSpan {
  readonly kind: TypedSpan['kind']
  readonly name: string
  readonly level: number
  readonly resolved?: boolean
  readonly from: number
  readonly to: number
}

/**
 * Every span in a body except the one that says what the body IS.
 *
 * **Any markdown file can be put through this**, which is what the index needs:
 * a note, a fileset and a day all carry headings, bookmarks, tags and comment
 * anchors, and only a day also carries a date. So the whole-body span belongs
 * to `Segment` and everything below belongs here, where it can be reached
 * without loading a document to hold it.
 *
 * Takes the marker scan rather than doing one, because its only caller that has
 * a body usually has the scan too, and walking the string twice for the same
 * answer is the failure this codebase keeps meeting.
 */
export function scanSpans(body: DocumentText, markers: readonly DocumentMarker[]): readonly ScannedSpan[] {
  const out: ScannedSpan[] = []

  // **A heading is a RANGE: its section, not its line** (D51). It runs to the
  // next heading of equal or greater precedence, or to the end of the body —
  // which is what makes days and headings one containment tree, and what lets
  // the sidebar highlight a section exactly as it highlights a subject.
  //
  // The heading's own text is `name`, so nothing is lost by the range being the
  // larger thing; what would be lost the other way is any way to say where the
  // section ENDS, which no other span could supply.
  const headings = markers.filter(m => m.kind === 'heading')
  headings.forEach((m, i) => {
    const next = headings.slice(i + 1).find(other => other.level <= m.level)
    out.push({ kind: 'heading', name: m.name, level: m.level, from: m.from, to: next?.from ?? body.length })
  })

  for (const m of markers) {
    // Zero-length: an anchor is a point that travels with the text (D20).
    if (m.kind === 'anchor') out.push({ kind: 'anchor', name: m.name, level: 0, from: m.from, to: m.from })
  }

  for (const t of resolveTags(markers, body)) {
    out.push({ kind: 'tag', name: t.name, level: 0, from: t.from, to: t.to })
  }

  // Comment anchors pair exactly as tags do — a named start, a named end,
  // strictly alternating — so the same resolver does them, degradation rules
  // included. Whether a thread is resolved lives in its first block.
  const resolved = new Set(
    threadsIn(body).filter(thread => thread.resolved).map(thread => thread.id as string),
  )
  for (const c of resolvePairs(markers, body, 'comment-start', 'comment-end')) {
    out.push({ kind: 'comment', name: c.name, level: 0, resolved: resolved.has(c.name), from: c.from, to: c.to })
  }

  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}
