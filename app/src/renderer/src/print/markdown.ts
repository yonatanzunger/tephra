// Markdown to HTML, for paper.
//
// **The same parser that decides what is bold on screen decides what is bold on
// paper.** Reaching for a second markdown library would have been fewer lines,
// and would have installed exactly the fault this project keeps meeting: two
// computations of one quantity, disagreeing quietly and only about the awkward
// cases. `@lezer/markdown` with GFM is already here because the editor uses it,
// so print walks the tree the editor is looking at.
//
// Spike B established that this — markdown to HTML plus a print stylesheet — is
// where printing actually lives, and that the shell contributes only the panel.

import { parser, GFM } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'
import katex from 'katex'
import { HANDLE } from '../../../shared/document-api.ts'

const md = parser.configure(GFM)

/**
 * Something drawn at a position in the prose, rather than written there.
 *
 * A tag's underline, a footnote's number, a note in the margin: the printer
 * decides these from the annotations and the policy (D50), and they have to
 * land at an OFFSET in the text — which only this file knows how to reach,
 * because between the prose and the output there is a parse, an escape, and a
 * set of marks that are not printed.
 *
 * `order` breaks ties at one offset: a range that closes there comes before a
 * range that opens there, or the two nest wrongly.
 */
export interface Cue {
  readonly at: number
  readonly html: string
  readonly order?: number
}

export function toHtml(source: string, cues: readonly Cue[] = []): string {
  // Handles are the editor's, not the document's (D44) — but they are also
  // where annotations are anchored, so removing them MOVES every cue after
  // each one. The shift is computed here, once, rather than being a thing
  // every caller has to know about prose that has already been through a
  // parser.
  const src = source.split(HANDLE).join('')
  const shifted = shift(source, cues)
  const tree = md.parse(src)
  const out: string[] = []
  for (let child = tree.topNode.firstChild; child !== null; child = child.nextSibling) {
    out.push(block(child, src, shifted))
  }
  const trailing = shifted.filter(c => c.at >= src.length)
  return out.join('\n') + trailing.map(c => c.html).join('')
}

/** Cue offsets, moved from prose coordinates into handle-free ones. */
function shift(source: string, cues: readonly Cue[]): readonly Cue[] {
  if (cues.length === 0) return cues
  const handles: number[] = []
  for (let i = source.indexOf(HANDLE); i !== -1; i = source.indexOf(HANDLE, i + 1)) handles.push(i)
  return [...cues]
    .map(cue => ({ ...cue, at: cue.at - handles.filter(h => h < cue.at).length }))
    .sort((a, b) => a.at - b.at || (a.order ?? 0) - (b.order ?? 0))
}

function block(node: SyntaxNode, src: string, cues: readonly Cue[]): string {
  const name = node.name

  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name)
  if (heading !== null) {
    const level = heading[1] as string
    return `<h${level}>${inline(node, src, cues)}</h${level}>`
  }

  switch (name) {
    case 'Paragraph': {
      const text = src.slice(node.from, node.to).trim()
      // A paragraph that is nothing but display math is a display equation,
      // which is a block and must not be wrapped in a <p>.
      const display = /^\$\$([\s\S]+)\$\$$/.exec(text)
      if (display !== null) return math(display[1] as string, true)
      return `<p>${inline(node, src, cues)}</p>`
    }
    case 'BulletList':
      return `<ul>${items(node, src, cues)}</ul>`
    case 'OrderedList':
      return `<ol>${items(node, src, cues)}</ol>`
    case 'Blockquote':
      return `<blockquote>${children(node, src, cues)}</blockquote>`
    case 'FencedCode':
    case 'CodeBlock':
      return `<pre><code>${escape(codeText(node, src))}</code></pre>`
    case 'HorizontalRule':
      return '<hr>'
    case 'Table':
      return table(node, src, cues)
    // A comment prints as nothing, which is what it is in every renderer —
    // and Tephra's own markers are comments.
    case 'Comment':
    case 'CommentBlock':
      return ''
    // Other raw HTML prints as the TEXT it is, escaped.
    //
    // The first version dropped the tags and kept what was between them, so
    // `<script>alert(1)</script>` printed as `alert(1)` — the worst of the
    // three options, because it silently altered what the person wrote. A
    // document is prose, not a template: it may not put markup on the page,
    // and it may not have its words quietly removed either.
    case 'HTMLBlock':
      return isComment(src.slice(node.from, node.to)) ? '' : `<p>${escape(src.slice(node.from, node.to))}</p>`
    default:
      return children(node, src, cues)
  }
}

const children = (node: SyntaxNode, src: string, cues: readonly Cue[]): string => {
  const out: string[] = []
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    out.push(block(child, src, cues))
  }
  return out.join('\n')
}

function items(node: SyntaxNode, src: string, cues: readonly Cue[]): string {
  const out: string[] = []
  for (let item = node.firstChild; item !== null; item = item.nextSibling) {
    if (item.name !== 'ListItem') continue
    // A list item's own paragraph is not a paragraph on paper: it is the item.
    const inner: string[] = []
    for (let child = item.firstChild; child !== null; child = child.nextSibling) {
      if (child.name === 'ListMark') continue
      inner.push(child.name === 'Paragraph' ? inline(child, src, cues) : block(child, src, cues))
    }
    out.push(`<li>${inner.join('\n')}</li>`)
  }
  return out.join('\n')
}

function table(node: SyntaxNode, src: string, cues: readonly Cue[]): string {
  const head: string[] = []
  const body: string[] = []
  for (let row = node.firstChild; row !== null; row = row.nextSibling) {
    if (row.name === 'TableDelimiter') continue
    const header = row.name === 'TableHeader'
    const cells: string[] = []
    for (let cell = row.firstChild; cell !== null; cell = cell.nextSibling) {
      if (cell.name !== 'TableCell') continue
      const tag = header ? 'th' : 'td'
      cells.push(`<${tag}>${inline(cell, src, cues)}</${tag}>`)
    }
    if (cells.length === 0) continue
    ;(header ? head : body).push(`<tr>${cells.join('')}</tr>`)
  }
  return `<table><thead>${head.join('')}</thead><tbody>${body.join('')}</tbody></table>`
}

/** Everything inside a block, with marks removed and constructs rendered. */
function inline(node: SyntaxNode, src: string, cues: readonly Cue[]): string {
  const out: string[] = []
  let cursor = node.from
  // Only the children that are constructs; the gaps between them are text.
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    // The gap BEFORE a child is text, whether or not the child itself is a
    // delimiter. Skipping marks before emitting the gap swallowed the word
    // between them and printed `<strong></strong>`.
    if (child.from > cursor) out.push(text(src, cursor, child.from, cues))
    // Every delimiter, not a list of three: `**` is an EmphasisMark, and
    // missing it printed `<strong>**bold**</strong>`.
    if (child.name.endsWith('Mark')) {
      cursor = Math.max(cursor, child.to)
      continue
    }
    out.push(construct(child, src, cues))
    cursor = child.to
  }
  if (cursor < node.to) out.push(text(src, cursor, node.to, cues))
  return out.join('').trim()
}

function construct(node: SyntaxNode, src: string, cues: readonly Cue[]): string {
  switch (node.name) {
    case 'StrongEmphasis':
      return `<strong>${inline(node, src, cues)}</strong>`
    case 'Emphasis':
      return `<em>${inline(node, src, cues)}</em>`
    case 'Strikethrough':
      return `<del>${inline(node, src, cues)}</del>`
    case 'InlineCode':
      return `<code>${escape(stripMarks(node, src))}</code>`
    case 'Image': {
      const url = childText(node, 'URL', src)
      const alt = between(node, src, 'LinkMark', 'LinkMark', cues)
      return `<img src="${escape(url)}" alt="${escape(alt)}">`
    }
    case 'Link': {
      const url = childText(node, 'URL', src)
      return `<a href="${escape(url)}">${between(node, src, 'LinkMark', 'LinkMark', cues)}</a>`
    }
    case 'Comment':
      return ''
    case 'HTMLTag':
      return escape(src.slice(node.from, node.to))
    case 'Escape':
      return escape(src.slice(node.from + 1, node.to))
    default:
      return text(src, node.from, node.to, cues)
  }
}

/**
 * Plain text, escaped, with inline math rendered and any cues dropped in.
 *
 * **The one place an offset in the source and a position in the output are the
 * same thing**, which is why the cues are spliced here and nowhere else. Above
 * this the text has been through a parser; below it, it has been escaped.
 */
function text(src: string, from: number, to: number, cues: readonly Cue[]): string {
  const out: string[] = []
  const here = cues.filter(c => c.at >= from && c.at < to)
  let cursor = from
  for (const cue of here) {
    out.push(escaped(src.slice(cursor, cue.at)))
    out.push(cue.html)
    cursor = cue.at
  }
  out.push(escaped(src.slice(cursor, to)))
  return out.join('')
}

/** Escaped, with inline math rendered where it appears. */
function escaped(raw: string): string {
  const out: string[] = []
  let cursor = 0
  const re = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    out.push(escape(raw.slice(cursor, m.index)))
    out.push(math(m[1] as string, false))
    cursor = m.index + m[0].length
  }
  out.push(escape(raw.slice(cursor)))
  return out.join('')
}

/**
 * Math for paper: **MathML, where the screen uses KaTeX's HTML.**
 *
 * KaTeX's HTML output is a lattice of positioned spans that means nothing
 * without its stylesheet, and the stylesheet means nothing without its sixty
 * font files. A print document has to be self-contained — it is rendered
 * offscreen from a temp file and then thrown away — so carrying a CSS bundle
 * and a font directory into it is a great deal of apparatus for one equation.
 * MathML is rendered by the browser itself, needs no assets at all, and is
 * what the PDF wants anyway.
 */
function math(src: string, display: boolean): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'mathml' })
  } catch {
    return `<code>${escape(src)}</code>`
  }
}

const codeText = (node: SyntaxNode, src: string): string => {
  const body = node.getChild('CodeText')
  return body === null ? stripMarks(node, src) : src.slice(body.from, body.to)
}

const childText = (node: SyntaxNode, name: string, src: string): string => {
  const child = node.getChild(name)
  return child === null ? '' : src.slice(child.from, child.to)
}

/** The text of a node with its delimiter marks taken off both ends. */
function stripMarks(node: SyntaxNode, src: string): string {
  let from = node.from
  let to = node.to
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (!child.name.endsWith('Mark')) continue
    if (child.from === from) from = child.to
    if (child.to === to) to = child.from
  }
  return src.slice(from, to)
}

/** What sits between the first and second marks — a link or image's label. */
function between(node: SyntaxNode, src: string, first: string, second: string, cues: readonly Cue[]): string {
  const opening = node.getChild(first)
  if (opening === null) return ''
  let closing = opening.nextSibling
  while (closing !== null && closing.name !== second) closing = closing.nextSibling
  if (closing === null) return ''
  return text(src, opening.to, closing.from, cues)
}

const isComment = (s: string): boolean => /^<!--[\s\S]*-->$/.test(s.trim())

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
