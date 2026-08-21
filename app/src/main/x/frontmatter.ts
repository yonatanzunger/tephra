// Frontmatter: parsed leniently, spliced precisely, never serialised from a model.
//
// The governing discipline is Portal D31, carried: parse leniently, serialize
// precisely, round-trip untouched content byte-for-byte. Hand-editing is a
// feature, so a file that has been in a human's hands must survive a save.
//
// TWO RULES THAT LOSE DATA IF BROKEN.
//
// 1. NEVER REWRITE A FILE YOU FAILED TO PARSE. Malformed frontmatter means both
//    "treat it as absent" and "do not touch this file". Overwriting what you
//    could not read is how hand-edited content disappears.
//
// 2. SPLICE, NEVER SERIALISE. Rewriting from a parsed model silently reformats —
//    key order, quoting, spacing — and turns every save into a diff against
//    itself. Invisible until the first sync conflict, and then permanent.

import type { DateKey } from '../../shared/document-api.ts'
import { asDateKey } from '../../shared/dates.ts'

export interface Frontmatter {
  /** Format version. Absent in a hand-made file, which is legal. */
  readonly tephra: number | null
  readonly date: DateKey | null
  readonly part: number | null
  readonly kind: string | null
  /** Everything else, verbatim, in original order. Preserved on any rewrite. */
  readonly extra: readonly (readonly [string, string])[]
}

export interface ParsedFile {
  readonly frontmatter: Frontmatter | null
  /**
   * The byte range of the frontmatter block including its delimiters and the
   * newline after the closing one. Empty range when there is no block.
   */
  readonly blockEnd: number
  /** Everything after the frontmatter. This is what an Offset indexes. */
  readonly body: string
  /**
   * True when a frontmatter block is present but could not be parsed.
   *
   * The file must then be treated as read-only. This is not an error to report
   * and move past: it is a standing prohibition for as long as it holds.
   */
  readonly unparseable: boolean
}

const OPEN = /^---\r?\n/
const KEY_LINE = /^([A-Za-z0-9_-]+):[ \t]*(.*?)[ \t]*$/

const EMPTY: Frontmatter = { tephra: null, date: null, part: null, kind: null, extra: [] }

/**
 * Split a file into frontmatter and body.
 *
 * Deliberately narrow about what counts as parseable: `key: scalar` lines,
 * blanks and `#` comments. Real YAML is far larger, and a file using more of it
 * is one we cannot round-trip — so it is marked unparseable and left alone,
 * which is the safe answer rather than a limitation to apologise for.
 */
export function parseFile(text: string): ParsedFile {
  if (!OPEN.test(text)) {
    return { frontmatter: null, blockEnd: 0, body: text, unparseable: false }
  }

  const firstLineEnd = text.indexOf('\n') + 1
  const rest = text.slice(firstLineEnd)
  const closer = /^---[ \t]*\r?$/m
  const lines = rest.split('\n')

  let closeLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (closer.test(lines[i] ?? '')) {
      closeLine = i
      break
    }
  }

  // An opener with no closer is not frontmatter, it is a horizontal rule at the
  // top of a document. Treating the whole file as an unterminated block would
  // hide all of its content.
  if (closeLine === -1) {
    return { frontmatter: null, blockEnd: 0, body: text, unparseable: false }
  }

  const blockLines = lines.slice(0, closeLine)
  let consumed = firstLineEnd
  for (let i = 0; i <= closeLine; i++) consumed += (lines[i] ?? '').length + 1
  const blockEnd = Math.min(consumed, text.length)
  const body = text.slice(blockEnd)

  const parsed = parseBlock(blockLines)
  if (parsed === null) {
    return { frontmatter: null, blockEnd, body, unparseable: true }
  }
  return { frontmatter: parsed, blockEnd, body, unparseable: false }
}

function parseBlock(lines: readonly string[]): Frontmatter | null {
  let tephra: number | null = null
  let date: DateKey | null = null
  let part: number | null = null
  let kind: string | null = null
  const extra: [string, string][] = []

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    const m = KEY_LINE.exec(line)
    if (m === null) return null // not something we can round-trip

    const key = m[1] as string
    const value = unquote(m[2] as string)

    switch (key) {
      case 'tephra':
        tephra = intOrNull(value)
        break
      case 'date':
        date = asDateKey(value)
        break
      case 'part':
        part = intOrNull(value)
        break
      case 'kind':
        kind = value === '' ? null : value
        break
      default:
        extra.push([key, m[2] as string])
    }
  }

  return { tephra, date, part, kind, extra }
}

/**
 * Rewrite a file with new body text, preserving the frontmatter block byte for
 * byte. The overwhelmingly common case — typing — changes no metadata, so the
 * bytes above the body are not merely reproduced, they are never touched.
 */
export function spliceBody(original: string, parsed: ParsedFile, body: string): string {
  return original.slice(0, parsed.blockEnd) + body
}

/**
 * Serialise a frontmatter block. Used ONLY when creating a file or when metadata
 * genuinely changes — never on an ordinary save, which splices instead.
 * Unknown keys are re-emitted verbatim, in their original order, after ours.
 */
export function renderFrontmatter(fm: Frontmatter): string {
  const out: string[] = ['---']
  if (fm.tephra !== null) out.push(`tephra: ${fm.tephra}`)
  if (fm.date !== null) out.push(`date: ${fm.date}`)
  if (fm.part !== null) out.push(`part: ${fm.part}`)
  if (fm.kind !== null) out.push(`kind: ${fm.kind}`)
  for (const [k, v] of fm.extra) out.push(`${k}: ${v}`)
  out.push('---', '')
  return out.join('\n')
}

export function frontmatterFor(date: DateKey, kind: string, part?: number): Frontmatter {
  return {
    tephra: 1,
    date,
    part: part !== undefined && part > 1 ? part : null,
    kind,
    extra: [],
  }
}

export const emptyFrontmatter = (): Frontmatter => EMPTY

function intOrNull(s: string): number | null {
  if (!/^-?\d+$/.test(s)) return null
  return Number(s)
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1)
  }
  return s
}
