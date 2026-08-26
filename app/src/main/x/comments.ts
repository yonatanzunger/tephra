// Reading and writing comment threads (D47).
//
// A thread is several blockquote blocks sharing one id, in document order. Each
// block is one message: a byline that is BOTH what a person reads and what this
// parses, then the body.
//
// ```
// > **Yonatan** 2026-08-23T14:02 👍@yonatan <!--tephra:comment k3f9-->
// > The argument assumes the reader already accepts premise 2.
// ```
//
// The identifier sits at the END of the byline because a comment that begins a
// block turns the whole block into an HTML block and kills its formatting —
// CommonMark's rule, and the same one that decides where markers may be placed.

import type { CommentId, CommentMessage, CommentThread } from '../../shared/comments.ts'
import type { DocumentText } from '../../shared/document-api.ts'
import { markerRemoval, placeMarker, scanMarkers, type DocumentMarker } from './markers.ts'
import { applyEdits } from './text-edits.ts'
import { userInfo } from 'node:os'

/** One message as it sits in the file. */
export interface ThreadBlock {
  readonly id: CommentId
  readonly message: CommentMessage
  /** Thread state, carried on the FIRST block of a thread and ignored on the rest. */
  readonly resolved: boolean
  readonly assignee: string | null
  /** The whole blockquote, and the blank line after it — what prose elides. */
  readonly from: number
  readonly to: number
}

const QUOTE = /^ {0,3}> ?/

/**
 * Every thread block in a body, in document order.
 *
 * Found through `scanMarkers`, which is fence-aware, so a comment block quoted
 * inside a code fence is text and not a thread — which matters in a notebook
 * where one writes about the thing one is building.
 */
export function scanThreadBlocks(body: DocumentText): readonly ThreadBlock[] {
  const out: ThreadBlock[] = []
  for (const marker of scanMarkers(body)) {
    if (marker.kind !== 'comment') continue
    const block = blockAround(body, marker)
    if (block === null) continue
    out.push(block)
  }
  return out.sort((a, b) => a.from - b.from)
}

/** Threads assembled from their blocks: same id, document order. */
export function threadsIn(body: DocumentText): readonly CommentThread[] {
  const byId = new Map<string, ThreadBlock[]>()
  for (const block of scanThreadBlocks(body)) {
    const held = byId.get(block.id) ?? []
    held.push(block)
    byId.set(block.id, held)
  }
  return [...byId.entries()].map(([id, blocks]) => ({
    id: id as CommentId,
    // Thread state lives on the first block. Repeating it on every message
    // would be a second copy of one fact.
    resolved: (blocks[0] as ThreadBlock).resolved,
    assignee: (blocks[0] as ThreadBlock).assignee,
    messages: blocks.map(b => b.message),
  }))
}

/**
 * The blockquote the marker sits in, plus the blank line after it.
 *
 * The blank line is part of what gets elided: taking the block alone would
 * leave the prose with two blank lines where it had one, which turns one
 * paragraph break into a wider gap for no reason a reader could explain.
 */
function blockAround(body: DocumentText, marker: DocumentMarker): ThreadBlock | null {
  const lines = lineIndex(body)
  const first = lines.findIndex(l => marker.from >= l.from && marker.from < l.to)
  if (first === -1 || !QUOTE.test(lineText(body, lines[first] as Line))) return null

  // The marker's line must be the block's FIRST line, or this is a marker in
  // the middle of somebody's quotation rather than a byline.
  if (first > 0 && QUOTE.test(lineText(body, lines[first - 1] as Line))) return null

  let last = first
  while (last + 1 < lines.length && QUOTE.test(lineText(body, lines[last + 1] as Line))) last++

  const from = (lines[first] as Line).from
  let to = (lines[last] as Line).to
  // …and one blank line after it, if there is one.
  const after = lines[last + 1]
  if (after !== undefined && lineText(body, after).trim() === '') to = after.to

  const quoted = lines
    .slice(first, last + 1)
    .map(l => lineText(body, l).replace(QUOTE, ''))
  const byline = parseByline((quoted[0] as string).slice(0, (quoted[0] as string).indexOf('<!--')).trimEnd())

  return {
    id: marker.name as CommentId,
    resolved: byline.resolved,
    assignee: byline.assignee,
    message: {
      author: byline.author,
      at: byline.at,
      body: quoted.slice(1).join('\n').trim(),
      reactions: byline.reactions,
      unknown: byline.unknown,
    },
    from,
    to,
  }
}

interface Byline {
  author: string
  at: string
  assignee: string | null
  resolved: boolean
  reactions: Record<string, readonly string[]>
  unknown: string[]
}

const AUTHOR = /^\s*\*\*([^*]+)\*\*/
const WHEN = /^\s*(\d{4}-\d{2}-\d{2}(?:T[\d:]+(?:Z|[+-][\d:]+)?)?)/
const ASSIGNEE = /^\s*→\s*\*\*([^*]+)\*\*/
const REACTION = /^\s*([^\s@]+)@(\S+)/u
const RESOLVED = /^\s*resolved\b/
const TOKEN = /^\s*(\S+)/

/**
 * The byline, which is one representation of every fact about a message.
 *
 * A human line plus a parallel set of machine attributes would be two copies of
 * one quantity — the fault this codebase met four times in M2 — so what is read
 * is what is parsed. **Anything not recognised is kept verbatim**, which is what
 * lets this grammar grow without a format break.
 */
export function parseByline(line: string): Byline {
  const out: Byline = {
    author: '',
    at: '',
    assignee: null,
    resolved: false,
    reactions: {},
    unknown: [],
  }
  let rest = line

  const author = AUTHOR.exec(rest)
  if (author !== null) {
    out.author = (author[1] as string).trim()
    rest = rest.slice(author[0].length)
  }

  while (rest.trim() !== '') {
    const when = WHEN.exec(rest)
    if (when !== null && out.at === '') {
      out.at = when[1] as string
      rest = rest.slice(when[0].length)
      continue
    }
    const assignee = ASSIGNEE.exec(rest)
    if (assignee !== null) {
      out.assignee = (assignee[1] as string).trim()
      rest = rest.slice(assignee[0].length)
      continue
    }
    const resolved = RESOLVED.exec(rest)
    if (resolved !== null) {
      out.resolved = true
      rest = rest.slice(resolved[0].length)
      continue
    }
    const reaction = REACTION.exec(rest)
    if (reaction !== null && isEmoji(reaction[1] as string)) {
      const emoji = reaction[1] as string
      const who = (reaction[2] as string)
        .split(',')
        .map(name => name.replace(/^@/, '').trim())
        .filter(name => name !== '')
      // Insertion order matters and is the order of first use, so an emoji seen
      // again extends its list rather than moving it to the end.
      out.reactions[emoji] = [...(out.reactions[emoji] ?? []), ...who]
      rest = rest.slice(reaction[0].length)
      continue
    }
    const token = TOKEN.exec(rest)
    if (token === null) break
    out.unknown.push(token[1] as string)
    rest = rest.slice(token[0].length)
  }
  return out
}

/**
 * Whether a token leads with a pictograph.
 *
 * Deliberately only the FIRST code point: skin tones, variation selectors and
 * ZWJ sequences all follow one, and a rule that tried to describe a whole emoji
 * would be wrong every time Unicode grew.
 */
function isEmoji(token: string): boolean {
  const first = [...token][0]
  return first !== undefined && /\p{Extended_Pictographic}/u.test(first)
}

/** A message, written back out. Thread state appears only on the first one. */
export function renderBlock(
  id: CommentId,
  message: CommentMessage,
  thread?: { resolved: boolean; assignee: string | null },
): string {
  const parts = [`**${message.author}**`, message.at]
  if (thread?.assignee != null && thread.assignee !== '') parts.push(`→ **${thread.assignee}**`)
  for (const [emoji, who] of Object.entries(message.reactions)) {
    if (who.length === 0) continue
    parts.push(`${emoji}@${who.join(',')}`)
  }
  if (thread?.resolved === true) parts.push('resolved')
  parts.push(...message.unknown)
  parts.push(`<!--tephra:comment ${id}-->`)

  const body = message.body.split('\n').map(l => (l === '' ? '>' : `> ${l}`))
  return [`> ${parts.filter(p => p !== '').join(' ')}`, ...body].join('\n')
}

interface Line {
  from: number
  to: number
}

const lineText = (body: string, line: Line): string => body.slice(line.from, line.to).replace(/\n$/, '')

function lineIndex(body: string): Line[] {
  const out: Line[] = []
  let start = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\n') {
      out.push({ from: start, to: i + 1 })
      start = i + 1
    }
  }
  if (start <= body.length) out.push({ from: start, to: body.length })
  return out
}

// ── writing ──────────────────────────────────────────────────

/** Thread state, which lives on a thread's first block. */
export const thread = (blocks: readonly ThreadBlock[]): { resolved: boolean; assignee: string | null } => {
  const first = blocks[0]
  return { resolved: first?.resolved ?? false, assignee: first?.assignee ?? null }
}

export function at(blocks: readonly ThreadBlock[], index: number): ThreadBlock {
  const block = blocks[index]
  if (block === undefined) throw new Error(`there is no message ${index} in this thread`)
  return block
}

/**
 * Who is writing.
 *
 * A name in a file, not an identity claim — nothing authenticates it, and it is
 * recorded because a comment without an author stops making sense the moment a
 * notebook is read by anybody else.
 */
export const author = (): string => process.env['TEPHRA_AUTHOR']?.trim() || userInfo().username

/** An id no thread in this body is using. Short, random, not a counter. */
export function unusedCommentId(body: DocumentText): CommentId {
  const taken = new Set(scanMarkers(body).map(m => m.name))
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')
    if (!taken.has(id)) return id as CommentId
  }
  throw new Error('could not find an unused comment id')
}

/**
 * Put the anchor pair around a range, and say where the range now ends.
 *
 * Placement obeys the same rule every marker does: never at the start of a
 * line, because a comment beginning a line turns the block into an HTML block.
 */
export function anchorComment(
  body: DocumentText,
  id: CommentId,
  range: { from: number; to: number },
): { body: DocumentText; endsAt: number } {
  const end = placeMarker(body, range.to, `<!--tephra:comment-end ${id}-->`)
  const withEnd = (body.slice(0, end.at) + end.text + body.slice(end.at)) as DocumentText
  const start = placeMarker(withEnd, Math.min(range.from, end.at), `<!--tephra:comment-start ${id}-->`)
  return {
    body: (withEnd.slice(0, start.at) + start.text + withEnd.slice(start.at)) as DocumentText,
    endsAt: end.at + end.text.length + start.text.length,
  }
}

/** Take a thread's anchor markers out, leaving the prose exactly as it was. */
export function unanchorComment(body: DocumentText, id: CommentId): DocumentText {
  const cuts = scanMarkers(body)
    .filter(m => (m.kind === 'comment-start' || m.kind === 'comment-end') && m.name === id)
    .map(m => markerRemoval(body, m))
  return applyEdits(body, cuts)
}

/**
 * Insert a block at an exact offset, separated by blank lines on both sides.
 *
 * The separation is not cosmetic: markdown treats a paragraph line immediately
 * after a blockquote line as a lazy continuation of the quote, so a missing
 * blank line does not close a gap — it feeds the next paragraph into the
 * comment. At the end of a body one newline is enough, and a second would leave
 * a blank line the file never had.
 */
export function insertBlockAt(body: DocumentText, at: number, block: string): DocumentText {
  const before = body.slice(0, at)
  const rest = body.slice(at)
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trail = rest === '' ? '\n' : rest.startsWith('\n') ? '\n' : '\n\n'
  return (before + lead + block + trail + rest) as DocumentText
}

/**
 * Where a NEW thread's first block goes: after the paragraph the range ends in.
 *
 * **Immediately after**, so a plain reader gets passage-then-gloss with no
 * tooling at all — the arrangement this whole design is after. Threads at the
 * end of the file would keep the prose contiguous, but a day runs to a megabyte
 * and "at the end" is then very far from what it is about.
 *
 * Replies do NOT use this: they go directly after the message they follow, so a
 * thread stays together. Routing a reply to the enclosing paragraph's end sent
 * it to the end of the FILE whenever the anchor was in the last paragraph.
 */
export function insertBlock(body: DocumentText, after: number, block: string): DocumentText {
  return insertBlockAt(body, paragraphEnd(body, after), block)
}

/**
 * Replace one block's text, or remove it when the replacement is empty.
 *
 * **The blank line after the block is put back.** A block's range includes it —
 * elision needs it, or the prose gains a paragraph break it never had — but a
 * rendered block does not end with one, and markdown treats a paragraph line
 * immediately after a blockquote line as a LAZY CONTINUATION of the quote. So
 * dropping it did not leave a cosmetic gap: it fed the next paragraph into the
 * comment.
 */
export function splice(body: DocumentText, block: ThreadBlock, text: string): DocumentText {
  if (text === '') return (body.slice(0, block.from) + body.slice(block.to)) as DocumentText
  const tail = /\n*$/.exec(body.slice(block.from, block.to))?.[0] ?? '\n'
  return (body.slice(0, block.from) + text + tail + body.slice(block.to)) as DocumentText
}

/** Rewrite a thread's FIRST block so it carries the thread's state. */
export function restate(
  body: DocumentText,
  id: CommentId,
  state: { resolved: boolean; assignee: string | null },
): DocumentText {
  const first = scanThreadBlocks(body).find(b => b.id === id)
  if (first === undefined) return body
  return splice(body, first, renderBlock(id, first.message, state))
}

/** The end of the paragraph an offset falls in — a blank line, or the body's end. */
function paragraphEnd(body: string, at: number): number {
  const blank = body.indexOf('\n\n', Math.max(0, at))
  if (blank === -1) return body.length
  return blank + 1
}
