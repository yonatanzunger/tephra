// Inline rendering, ported from Spike 01 where the behaviour was measured.
//
// THREE CONSTRAINTS, ALL FORCED (D16, implementation-notes §2):
//
// 1. Block widgets cannot come from a view plugin — CodeMirror refuses outright.
//    Inline widgets rebuild per viewport in a ViewPlugin; block widgets live in
//    a whole-document StateField that maps through each change and rescans only
//    the block the edit touched. Never rescan the document per keystroke.
//
// 2. Rendered constructs must unrender under the cursor — which is D16's rule
//    and the whole editing model: you edit the raw form where it is rendered.
//    It was originally forced by something narrower, since
//    @replit/codemirror-vim did its own offset arithmetic and never consulted
//    atomicRanges, so six `l` presses left the cursor frozen while vim walked
//    the hidden source underneath. Vim is gone (D67); the rule outlived it,
//    because there is no other way to change what a widget stands for.
//
// 3. Block widgets must also unrender from a NEIGHBOURING line. Replacing whole
//    lines removes them from the visual layout, so a caret arriving from above
//    or below skips them entirely — and unreachable means uneditable.
//
// Measured in the spike: 2 ms initial scan, 0.2 ms incremental.

import type { Range } from '@codemirror/state'
import { imageSrc } from '../../../../../shared/scheme.ts'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import katex from 'katex'
import { HANDLE } from '../../../../../shared/document-api.ts'
import { scanLinks } from '../../../../../shared/links.ts'

export const rebuildWidgets = StateEffect.define<null>()

export interface WidgetOptions {
  /** Unrender the construct the cursor is inside. D16's editing model (see above). */
  reveal: boolean
  /** Blocks also unrender from a neighbouring line, or j/k cannot enter them. */
  revealAdjacent: boolean
  /**
   * The directory this document's relative image links resolve from (R7).
   *
   * **Notebook-relative, and supplied by main**, because how deep a day file
   * sits is `w/layout.ts`'s to know (D59). Empty means the notebook root, which
   * is also the safe answer while it is still being fetched: a picture that
   * cannot be placed draws as a broken image rather than as a file somewhere
   * else.
   */
  imageBase: string
}

export const defaultWidgetOptions: WidgetOptions = {
  reveal: true,
  revealAdjacent: true,
  imageBase: '',
}

// Mutable module state, deliberately: these are toggled live from the settings
// UI and every decoration builder reads them. A facet would be tidier and would
// also mean rebuilding the extension set on every toggle.
export const widgetOptions: WidgetOptions = { ...defaultWidgetOptions }

const INLINE_MATH = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const DISPLAY_MATH_LINE = /^\s*\$\$(.+)\$\$\s*$/
const TABLE_DELIM = /^\s*\|?[\s:|-]{3,}\|?\s*$/
const IMAGE_ALONE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
const HEADING = /^(#{1,6})\s+/

// Emphasis delimiters. These conceal the MARKS and leave the text, which is why
// each match yields two decorations rather than one — unlike math or an image,
// where the whole construct is replaced by a widget.
//
// The guards are load-bearing. `**` must be tried before `*`, or the first
// asterisk of a strong run matches as emphasis and the pair is mis-split. A
// delimiter may not be followed (opening) or preceded (closing) by a space,
// which is CommonMark's rule and also what stops `2 * 3 * 4` from becoming
// italic. Underscores additionally may not sit against word characters, or
// `some_file_name` loses its middle.
const STRONG_STAR = /(?<!\*)\*\*(?!\s)((?:[^*\n]|\*(?!\*))+?)(?<!\s)\*\*(?!\*)/g
const EM_STAR = /(?<![*\w])\*(?!\s|\*)([^*\n]+?)(?<!\s)\*(?!\*)/g
const STRONG_UNDER = /(?<![\w_])__(?!\s)([^_\n]+?)(?<!\s)__(?![\w_])/g
const EM_UNDER = /(?<![\w_])_(?!\s|_)([^_\n]+?)(?<!\s)_(?![\w_])/g
const CODE_SPAN = /`+[^`\n]*`+/g

// An ordinary markdown link. Deliberately ordinary: the link a branch leaves
// behind is v1's ONLY path back to the branched material (D13), and it has to
// keep working in any other editor as well as in this one. `!` in front makes
// it an image, which is handled above.

// A marker's HANDLE — one character of prose standing for a bookmark or the
// start of a tagged range (D44). There is no marker SYNTAX to look for here:
// the buffer holds prose, so `<!--tephra:…-->` never reaches this file.
const HANDLE_CHAR = new RegExp(HANDLE, 'g')

const katexCache = new Map<string, string>()

function renderMath(src: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + src
  let html = katexCache.get(key)
  if (html === undefined) {
    try {
      html = katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'html' })
    } catch {
      html = `<span class="tx-bad">${escapeHtml(src)}</span>`
    }
    katexCache.set(key, html)
  }
  return html
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)

class MathWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly display: boolean,
  ) {
    super()
  }
  override eq(other: MathWidget): boolean {
    return other.src === this.src && other.display === this.display
  }
  toDOM(): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = 'tx-math' + (this.display ? ' tx-math-block' : '')
    el.innerHTML = renderMath(this.src, this.display)
    return el
  }
  override ignoreEvent(): boolean {
    return false
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly block: boolean,
  ) {
    super()
  }
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.block === this.block
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement(this.block ? 'div' : 'span')
    wrap.className = 'tx-img' + (this.block ? ' tx-img-block' : '')
    const img = document.createElement('img')
    img.src = imageSrc(this.src, widgetOptions.imageBase)
    img.alt = this.alt
    img.loading = 'lazy'
    wrap.appendChild(img)
    return wrap
  }
  override ignoreEvent(): boolean {
    return false
  }
}

/**
 * A link as the reader sees it: its words, live.
 *
 * **One factory, because there are two callers** — the link widget in a line of
 * prose, and a link inside a table cell. Two copies would have differed in the
 * way this codebase keeps finding: the cell's would have been a plain `<a href>`
 * that the desktop opens, where `openLink` resolves a path inside the notebook
 * first (D54).
 */
function linkElement(label: string, target: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'tx-link'
  el.textContent = label
  el.title = target
  el.setAttribute('role', 'link')
  el.addEventListener('mousedown', event => {
    event.preventDefault()
    event.stopPropagation()
    void window.tephra.openLink(target)
  })
  return el
}

/**
 * Inline marks inside a table cell, drawn the way a line of prose draws them.
 *
 * **Reported from use** (2026-09-15): a cell reading `**Property**` showed its
 * asterisks. A cell was `td.textContent = cell`, which is the one place in the
 * surface where markdown was rendered as its own source — the line renderer
 * conceals the marks with decorations, and a widget's DOM is outside that
 * machinery entirely.
 *
 * **The same patterns as the line**, imported rather than rewritten: `a *b* c`
 * inside a code span is three words and two asterisks, and two answers about
 * that is the failure `codeSpans` already exists to prevent.
 *
 * Priority is code, then links, then strong, then emphasis — the first match
 * wins a piece of text, so a link's label is not re-scanned for asterisks it
 * does not have.
 */
function inlineInto(parent: HTMLElement, text: string): void {
  type Found = { from: number; to: number; make: () => Node }
  const found: Found[] = []
  const claimed = (from: number, to: number): boolean =>
    found.some(one => from < one.to && to > one.from)

  for (const [from, to] of codeSpans(text)) {
    const inner = text.slice(from, to).replace(/^`+|`+$/g, '')
    found.push({ from, to, make: () => {
      const el = document.createElement('code')
      el.textContent = inner
      return el
    } })
  }
  for (const link of scanLinks(text)) {
    if (link.image || claimed(link.from, link.to)) continue
    found.push({ from: link.from, to: link.to, make: () => linkElement(link.label, link.target) })
  }
  for (const [pattern, tag] of [
    [STRONG_STAR, 'strong'], [STRONG_UNDER, 'strong'],
    [EM_STAR, 'em'], [EM_UNDER, 'em'],
  ] as const) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const to = m.index + m[0].length
      if (claimed(m.index, to)) continue
      const inner = m[1] as string
      found.push({ from: m.index, to, make: () => {
        const el = document.createElement(tag)
        // **Nested, because emphasis nests**: `**bold *and italic*** ` is one
        // inside the other, and a cell is prose like any other.
        inlineInto(el, inner)
        return el
      } })
    }
  }

  found.sort((a, b) => a.from - b.from)
  let at = 0
  for (const one of found) {
    if (one.from < at) continue
    if (one.from > at) parent.appendChild(document.createTextNode(text.slice(at, one.from)))
    parent.appendChild(one.make())
    at = one.to
  }
  if (at < text.length) parent.appendChild(document.createTextNode(text.slice(at)))
}

class TableWidget extends WidgetType {
  readonly key: string
  constructor(readonly rows: readonly string[]) {
    super()
    this.key = rows.join('\n')
  }
  override eq(other: TableWidget): boolean {
    return other.key === this.key
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'tx-table'
    const table = document.createElement('table')
    const cells = (row: string): string[] =>
      row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    this.rows.forEach((row, i) => {
      if (i === 1 && TABLE_DELIM.test(row)) return
      const tr = document.createElement('tr')
      for (const cell of cells(row)) {
        const td = document.createElement(i === 0 ? 'th' : 'td')
        inlineInto(td, cell)
        tr.appendChild(td)
      }
      table.appendChild(tr)
    })
    wrap.appendChild(table)
    return wrap
  }
  override ignoreEvent(): boolean {
    return false
  }
}

/**
 * Where backticks are on this line. Emphasis inside a code span is literal —
 * `a *b* c` is three words and two asterisks — so concealing marks there would
 * hide characters that are part of the content. Flagged in
 * `implementation-notes.md` §5a as a thing to watch, and this is the watching.
 */
function codeSpans(text: string): readonly [number, number][] {
  const spans: [number, number][] = []
  CODE_SPAN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CODE_SPAN.exec(text)) !== null) spans.push([m.index, m.index + m[0].length])
  return spans
}

const insideCode = (spans: readonly [number, number][], at: number): boolean =>
  spans.some(([from, to]) => at >= from && at < to)

/** A marker, as the reader should see it: present, named, and out of the way. */
/**
 * A marker you can point at, drawn.
 *
 * Deliberately not a dingbat: ✪ and ❂ come from a symbol font, so in the middle
 * of a serif face they arrive with foreign metrics and an unpredictable
 * baseline, and both are a great deal of ink for something that should be
 * quiet. Drawn in CSS it inherits the theme, sits where we put it, and is the
 * same on every machine.
 *
 * It carries no name. The name is not in the buffer — it is in the span — and
 * asking for it is what clicking the mark is for.
 */
class HandleWidget extends WidgetType {
  readonly #at: number

  constructor(at: number) {
    super()
    this.#at = at
  }

  override eq(other: HandleWidget): boolean {
    return other.#at === this.#at
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'tx-handle'
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', 'marker')
    // Announced as a DOM event rather than through a callback held in module
    // state: the widget is constructed deep inside a decoration builder that
    // has no idea what the application wants to do about a click, and an event
    // travels to whoever is listening without either of them knowing the other.
    el.addEventListener('mousedown', event => {
      event.preventDefault()
      event.stopPropagation()
      el.dispatchEvent(
        new CustomEvent('tephra-handle', {
          bubbles: true,
          detail: { at: this.#at, box: el.getBoundingClientRect() },
        }),
      )
    })
    return el
  }

  /** The click belongs to the mark, not to the editor underneath it. */
  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * A markdown link, drawn as the words it names.
 *
 * Following it is main's job: what a target means — whether it is inside the
 * notebook at all — is a question about the notebook, and the renderer has no
 * business resolving paths.
 */
class LinkWidget extends WidgetType {
  readonly #label: string
  readonly #target: string

  constructor(label: string, target: string) {
    super()
    this.#label = label
    this.#target = target
  }

  override eq(other: LinkWidget): boolean {
    return other.#label === this.#label && other.#target === this.#target
  }

  toDOM(): HTMLElement {
    return linkElement(this.#label, this.#target)
  }

  /** The click belongs to the link, not to the editor underneath it. */
  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * Whether a CARET is in this construct — not whether a selection covers it.
 *
 * **A selection is not an edit intent; a caret is.** Revealing on any
 * overlapping range meant that dragging a selection past a link unrendered it
 * mid-drag, and a link's raw form is eighty characters longer than its words:
 * the line rewrapped, everything below moved, and the pointer ended up over
 * different text. Reported as "halfway through selecting there's a jump and
 * suddenly I'm selecting the text below", which is exactly what it looks like.
 *
 * Selecting across markup never needs to see it. Replacing a selection that
 * contains a construct removes the construct, which is what anyone would
 * expect; and reading is the thing people do while dragging, not editing.
 *
 * This is Q11's complaint again, at the one moment it does the most damage —
 * reflow while the pointer is down.
 */
function overlapsCursor(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(r => r.empty && r.from <= to && r.to >= from)
}

/** One line either side, so vertical motion has somewhere to land. */
function nearCursor(state: EditorState, from: number, to: number): boolean {
  const doc = state.doc
  const a = doc.line(Math.max(1, doc.lineAt(from).number - 1)).from
  const b = doc.line(Math.min(doc.lines, doc.lineAt(to).number + 1)).to
  return overlapsCursor(state, a, b)
}

const blockRevealed = (state: EditorState, from: number, to: number): boolean =>
  widgetOptions.revealAdjacent ? nearCursor(state, from, to) : overlapsCursor(state, from, to)

function isBlockLine(state: EditorState, lineNumber: number): boolean {
  const text = state.doc.line(lineNumber).text
  return DISPLAY_MATH_LINE.test(text) || IMAGE_ALONE.test(text) || text.trimStart().startsWith('|')
}

// ── inline: viewport only ────────────────────────────────────

interface PendingDeco {
  from: number
  to: number
  deco?: Decoration
  line?: Decoration
}

function buildInline(view: EditorView): DecorationSet {
  const decos: PendingDeco[] = []
  const state = view.state

  for (const { from, to } of view.visibleRanges) {
    const first = state.doc.lineAt(from).number
    const last = state.doc.lineAt(to).number
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      const text = line.text
      if (isBlockLine(state, n)) continue
      const cursorHere = overlapsCursor(state, line.from, line.to)

      // **The blank line IS the space between paragraphs**, and it is the only
      // thing that is. A newline continues a paragraph in markdown and Tephra
      // follows markdown, so the lines within one are spaced by `leading` and
      // by nothing else; there is no "end of a paragraph" to decorate, because
      // the gap belongs to the blank line that made it.
      //
      // It keeps a real height rather than collapsing, because the caret has to
      // be able to go there.
      if (text.trim() === '') {
        decos.push({ from: line.from, to: line.from, line: Decoration.line({ class: 'tx-blank' }) })
      }

      const heading = HEADING.exec(text)
      if (heading !== null) {
        decos.push({ from: line.from, to: line.from, line: Decoration.line({ class: `tx-h${(heading[1] as string).length}` }) })
        if (widgetOptions.reveal && !cursorHere) {
          decos.push({ from: line.from, to: line.from + (heading[0] as string).length, deco: Decoration.replace({}) })
        }
      }

      let m: RegExpExecArray | null
      IMAGE.lastIndex = 0
      while ((m = IMAGE.exec(text)) !== null) {
        const from2 = line.from + m.index
        const to2 = from2 + m[0].length
        if (widgetOptions.reveal && overlapsCursor(state, from2, to2)) continue
        decos.push({ from: from2, to: to2, deco: Decoration.replace({ widget: new ImageWidget(m[2] as string, m[1] as string, false) }) })
      }

      INLINE_MATH.lastIndex = 0
      while ((m = INLINE_MATH.exec(text)) !== null) {
        const from2 = line.from + m.index
        const to2 = from2 + m[0].length
        if (widgetOptions.reveal && overlapsCursor(state, from2, to2)) continue
        decos.push({ from: from2, to: to2, deco: Decoration.replace({ widget: new MathWidget(m[1] as string, false) }) })
      }

      const spans = codeSpans(text)

      // The handle, drawn. It is one character of prose and it is always
      // rendered — there is no raw form to fall back to, which is why the line
      // never reflows as the caret passes (D42).
      HANDLE_CHAR.lastIndex = 0
      while ((m = HANDLE_CHAR.exec(text)) !== null) {
        const from2 = line.from + m.index
        decos.push({
          from: from2,
          to: from2 + 1,
          deco: Decoration.replace({ widget: new HandleWidget(from2) }),
        })
      }

      // Links: show the words, keep the target in the tooltip and one click
      // away. A link rendered as `[Titration curves](../../../notes/…)` is a
      // path back that costs a line of prose to read past every time.
      //
      // **Through the shared scanner** (ML1, D61), which is how a link whose
      // URL contains a space became visible here: this had its own regex, it
      // did not accept the angle-bracket spelling, and `destination()` writes
      // that spelling — so Insert Link produced something this could not draw.
      for (const link of scanLinks(text)) {
        if (link.image) continue // an image is embedded elsewhere, not drawn as words
        if (insideCode(spans, link.from)) continue
        const from2 = line.from + link.from
        const to2 = line.from + link.to
        if (widgetOptions.reveal && overlapsCursor(state, from2, to2)) continue
        decos.push({
          from: from2,
          to: to2,
          deco: Decoration.replace({ widget: new LinkWidget(link.label, link.target) }),
        })
      }

      // Emphasis: hide the marks, keep the text. The styling itself comes from
      // `proseHighlight` via lezer's tags, which is why the text was already
      // bold or italic while the asterisks sat there wearing the same weight.
      //
      // TODO (Q11): revealing on cursor REFLOWS the line — four characters
      // appear and everything after them shifts. That is precisely what D42
      // spent a study forbidding for the frame, happening inside the line
      // instead, and on the highest-frequency event there is. The alternative
      // worth trying first is not concealing at all but quieting the marks,
      // which never reflows and is a stylesheet change rather than a mechanism
      // change. Left as-is deliberately: settle it by living with it, the way
      // the frame arrangements were settled.
      for (const [pattern, width] of [
        [STRONG_STAR, 2],
        [STRONG_UNDER, 2],
        [EM_STAR, 1],
        [EM_UNDER, 1],
      ] as const) {
        pattern.lastIndex = 0
        while ((m = pattern.exec(text)) !== null) {
          if (insideCode(spans, m.index)) continue
          const from2 = line.from + m.index
          const to2 = from2 + m[0].length
          if (widgetOptions.reveal && overlapsCursor(state, from2, to2)) continue
          // TWO decorations, one per delimiter run, with the content between
          // them left alone — a single replace would take the text as well.
          decos.push({ from: from2, to: from2 + width, deco: Decoration.replace({}) })
          decos.push({ from: to2 - width, to: to2, deco: Decoration.replace({}) })
        }
      }
    }
  }

  decos.sort((a, b) => a.from - b.from || (a.line ? -1 : b.line ? 1 : 0) || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  let lastTo = -1
  for (const d of decos) {
    if (d.line !== undefined) {
      builder.add(d.from, d.from, d.line)
      continue
    }
    if (d.from < lastTo || d.from === d.to || d.deco === undefined) continue
    builder.add(d.from, d.to, d.deco)
    lastTo = d.to
  }
  return builder.finish()
}

export const inlineWidgets = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildInline(view)
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.transactions.some(t => t.effects.some(e => e.is(rebuildWidgets)))
      ) {
        this.decorations = buildInline(update.view)
      }
    }
  },
  {
    decorations: v => v.decorations,
    // Inline widgets ARE atomic; block widgets are NOT. Marking blocks atomic
    // makes vertical motion worse and buys nothing.
    provide: plugin =>
      EditorView.atomicRanges.of(view => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
)

// ── block: whole document, incrementally ─────────────────────

// Range<Decoration>, not Decoration: every element here is the result of
// `.range(from, to)`, which pairs a decoration with the span it covers.
// `ReturnType<typeof Decoration.replace>` is the decoration alone, and it type
// checked only because this project's typecheck was never actually running.
function buildBlocks(state: EditorState, fromLine: number, toLine: number): Range<Decoration>[] {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  let n = fromLine
  while (n <= toLine) {
    const line = doc.line(n)
    const text = line.text

    if (text.trimStart().startsWith('|') && n < doc.lines && TABLE_DELIM.test(doc.line(n + 1).text)) {
      let end = n
      const rows: string[] = []
      while (end <= doc.lines && doc.line(end).text.trimStart().startsWith('|')) {
        rows.push(doc.line(end).text)
        end++
      }
      const to = doc.line(end - 1).to
      if (!(widgetOptions.reveal && blockRevealed(state, line.from, to))) {
        out.push(Decoration.replace({ widget: new TableWidget(rows), block: true }).range(line.from, to))
      }
      n = end
      continue
    }

    const display = DISPLAY_MATH_LINE.exec(text)
    if (display !== null) {
      if (!(widgetOptions.reveal && blockRevealed(state, line.from, line.to))) {
        out.push(
          Decoration.replace({ widget: new MathWidget((display[1] as string).trim(), true), block: true }).range(line.from, line.to),
        )
      }
      n++
      continue
    }

    const image = IMAGE_ALONE.exec(text)
    if (image !== null && !(widgetOptions.reveal && blockRevealed(state, line.from, line.to))) {
      out.push(
        Decoration.replace({ widget: new ImageWidget(image[2] as string, image[1] as string, true), block: true }).range(line.from, line.to),
      )
    }
    n++
  }
  return out
}

/** Widen a dirty region to whole blocks, plus a line each way for adjacency. */
function dirtyBlock(state: EditorState, from: number, to: number): [number, number] {
  const doc = state.doc
  let a = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number
  let b = doc.lineAt(Math.max(0, Math.min(to, doc.length))).number
  while (a > 1 && doc.line(a - 1).text.trim() !== '') a--
  while (b < doc.lines && doc.line(b + 1).text.trim() !== '') b++
  return [Math.max(1, a - 2), Math.min(doc.lines, b + 2)]
}

export const blockWidgets = StateField.define<DecorationSet>({
  create(state) {
    return Decoration.set(buildBlocks(state, 1, state.doc.lines), true)
  },
  update(deco, tr) {
    const forced = tr.effects.some(e => e.is(rebuildWidgets))
    if (!tr.docChanged && tr.selection === undefined && !forced) return deco
    if (forced) return Decoration.set(buildBlocks(tr.state, 1, tr.state.doc.lines), true)

    const mapped = deco.map(tr.changes)
    let lo = Number.POSITIVE_INFINITY
    let hi = -1
    tr.changes.iterChangedRanges((_fa, _ta, fb, tb) => {
      lo = Math.min(lo, fb)
      hi = Math.max(hi, tb)
    })
    if (tr.selection !== undefined) {
      const before = tr.startState.selection.main
      const after = tr.state.selection.main
      lo = Math.min(lo, tr.changes.mapPos(before.from), after.from)
      hi = Math.max(hi, tr.changes.mapPos(before.to), after.to)
    }
    if (hi < 0) return mapped

    const [a, b] = dirtyBlock(tr.state, lo, hi)
    const from = tr.state.doc.line(a).from
    const to = tr.state.doc.line(b).to
    return mapped.update({
      filterFrom: from,
      filterTo: to,
      filter: () => false,
      add: buildBlocks(tr.state, a, b),
      sort: true,
    })
  },
  provide: f => EditorView.decorations.from(f),
})

export function widgetExtensions(): Extension {
  return [blockWidgets, inlineWidgets]
}
