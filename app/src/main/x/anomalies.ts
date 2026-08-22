// Detecting the degradation table's cases (format-spec.md).
//
// Pure, and deliberately a separate pass rather than a change to the parsers.
// `resolveTags`, `resolveAnchors` and `parseFile` already do the right thing
// with a malformed file; threading a second return value through all of them
// would have disturbed every caller to add reporting to code whose *behaviour*
// was already correct. This derives the report from what they produce.
//
// Every case here has already been handled safely by the time it is reported.
// Nothing in this file changes what the app does — only what it says.

import type { Anomaly } from '../../shared/anomalies.ts'
import type { DateKey } from '../../shared/document-api.ts'
import type { ParsedFile } from './frontmatter.ts'
import { subjectKey, type RawMarker } from './markers.ts'

export interface AnomalyInput {
  readonly file: string
  readonly date: DateKey
  readonly parsed: ParsedFile
  readonly markers: readonly RawMarker[]
  /** Where the body starts in the file, so line numbers are file lines. */
  readonly bodyOffset: number
  readonly text: string
}

export function findAnomalies(input: AnomalyInput): readonly Anomaly[] {
  const { file, date, parsed, markers, bodyOffset, text } = input
  const out: Anomaly[] = []
  const at = (offset: number): number => lineOf(text, bodyOffset + offset)

  // ── frontmatter ──────────────────────────────────────────────
  if (parsed.unparseable) {
    out.push({ kind: 'unparseable-frontmatter', file, date, line: 1, subject: null })
  } else if (parsed.frontmatter === null) {
    out.push({ kind: 'missing-frontmatter', file, date, line: 1, subject: null })
  } else {
    const declared = parsed.frontmatter.date
    if (typeof declared === 'string' && declared !== '' && declared !== date) {
      // The date the reader is looking at is the one from frontmatter, which
      // wins; the filename is what disagrees. Naming the declared date is what
      // makes the report actionable.
      out.push({ kind: 'date-mismatch', file, date, line: 1, subject: declared })
    }
  }

  // ── tags ─────────────────────────────────────────────────────
  // Re-run the alternation rather than reading `resolveTags`' output, because
  // an orphaned `tag-end` is *dropped* there — it is invisible in the result by
  // design, and this is the one place that needs to see it.
  const open = new Map<string, RawMarker>()
  for (const marker of markers) {
    if (marker.kind === 'tag-start') {
      if (!open.has(subjectKey(marker.name))) open.set(subjectKey(marker.name), marker)
    } else if (marker.kind === 'tag-end') {
      if (open.has(subjectKey(marker.name))) open.delete(subjectKey(marker.name))
      else {
        out.push({
          kind: 'orphan-tag-end',
          file,
          date,
          line: at(marker.from),
          subject: marker.name,
        })
      }
    }
  }
  for (const start of open.values()) {
    out.push({
      kind: 'unterminated-tag',
      file,
      date,
      line: at(start.from),
      subject: start.name,
    })
  }

  // ── anchors ──────────────────────────────────────────────────
  const seen = new Set<string>()
  for (const marker of markers) {
    if (marker.kind !== 'anchor') continue
    if (seen.has(marker.name)) {
      // Reported at the SECOND one: the first is the one that resolves, so the
      // later one is the surprise and the place a repair would happen.
      out.push({
        kind: 'duplicate-anchor',
        file,
        date,
        line: at(marker.from),
        subject: marker.name,
      })
    }
    seen.add(marker.name)
  }

  return out.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
}

/** 1-based line number of an offset. */
function lineOf(text: string, offset: number): number {
  let line = 1
  const limit = Math.min(offset, text.length)
  for (let i = 0; i < limit; i++) if (text.charCodeAt(i) === 10) line++
  return line
}
