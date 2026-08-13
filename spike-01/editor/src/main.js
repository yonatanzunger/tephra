// Spike A — one surface: CodeMirror 6 with a genuine vim mode AND inline widgets.
// Disposable. Nothing here is meant to survive into v1.

import { EditorState, StateEffect, StateField, RangeSetBuilder, Compartment } from '@codemirror/state'
import {
  EditorView, keymap, Decoration, WidgetType, ViewPlugin, drawSelection,
  highlightActiveLine, lineNumbers, rectangularSelection, crosshairCursor,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { markdown } from '@codemirror/lang-markdown'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { vim, Vim } from '@replit/codemirror-vim'
import katex from 'katex'
import { printSelection, pasteImage, shell } from './bridge.js'

// ───────────────────────────────────────────────────────── widgets ──────────

const katexCache = new Map()
function renderMath(src, display) {
  const key = (display ? 'D' : 'I') + src
  let html = katexCache.get(key)
  if (html === undefined) {
    try {
      html = katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'html' })
    } catch (err) {
      html = `<span class="tx-bad">${src}</span>`
    }
    katexCache.set(key, html)
  }
  return html
}

class MathWidget extends WidgetType {
  constructor(src, display) { super(); this.src = src; this.display = display }
  eq(o) { return o.src === this.src && o.display === this.display }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = 'tx-math' + (this.display ? ' tx-math-block' : '')
    el.innerHTML = renderMath(this.src, this.display)
    return el
  }
  ignoreEvent() { return false }
}

class ImageWidget extends WidgetType {
  constructor(src, alt, block) { super(); this.src = src; this.alt = alt; this.block = block }
  eq(o) { return o.src === this.src && o.alt === this.alt && o.block === this.block }
  toDOM() {
    const wrap = document.createElement(this.block ? 'div' : 'span')
    wrap.className = 'tx-img' + (this.block ? ' tx-img-block' : '')
    const img = document.createElement('img')
    img.src = this.src; img.alt = this.alt; img.loading = 'lazy'
    wrap.appendChild(img)
    return wrap
  }
  ignoreEvent() { return false }
}

class TableWidget extends WidgetType {
  constructor(rows) { super(); this.rows = rows; this.key = rows.join('\n') }
  eq(o) { return o.key === this.key }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'tx-table'
    const t = document.createElement('table')
    const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    this.rows.forEach((r, i) => {
      if (i === 1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(r)) return   // delimiter row
      const tr = document.createElement('tr')
      for (const c of cells(r)) {
        const td = document.createElement(i === 0 ? 'th' : 'td')
        td.textContent = c
        tr.appendChild(td)
      }
      t.appendChild(tr)
    })
    wrap.appendChild(t)
    return wrap
  }
  ignoreEvent() { return false }
}

// Prose highlighting. The stock style is built for code — it underlines
// headings and colours syntax; long-form writing wants neither.
const proseHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.85em', fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
  { tag: t.heading4, fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'rgb(var(--accent))', textDecoration: 'none' },
  { tag: t.url, color: 'rgb(var(--text-muted))' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.85em', background: 'rgb(var(--code-bg))', padding: '0.1em 0.3em', borderRadius: '3px' },
  { tag: t.quote, color: 'rgb(var(--text-muted))', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'rgb(var(--text-faint, var(--text-muted)))', opacity: '0.35' },
  { tag: t.contentSeparator, color: 'rgb(var(--text-muted))' },
])

// ─────────────────────────────────────────────── decoration construction ────

const INLINE_MATH_RE = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const DISPLAY_MATH_LINE = /^\s*\$\$(.+)\$\$\s*$/
const TABLE_DELIM = /^\s*\|?[\s:|-]{3,}\|?\s*$/
const IMAGE_ALONE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
const HEADING_RE = /^(#{1,6})\s+/
const MARKS_RE = /(\*\*|__)(?=\S)|(?<=\S)(\*\*|__)|(?<![\w*])[*_](?=\S)|(?<=\S)[*_](?![\w*])|`/g
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

// Runtime switches, so the same page can answer several questions.
export const opts = {
  widgets: true,
  atomic: true,       // inline widgets are one unit for CodeMirror-level motion
  atomicBlocks: false,// block widgets too — off, or j/k cannot enter a table at all
  reveal: true,       // unrender the widget the cursor is inside (live-preview)
  revealAdjacent: true,// blocks also unrender when the cursor is on a neighbouring
                      // line — without this, j/k can never enter one at all
}

function overlapsCursor(state, from, to) {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true
  }
  return false
}

// A block widget replaces whole lines, which removes them from the visual
// layout — so vertical motion has nowhere to land and skips the block entirely.
// Widening the reveal by one line in each direction gives j/k an entry point.
function nearCursor(state, from, to) {
  const doc = state.doc
  const a = doc.line(Math.max(1, doc.lineAt(from).number - 1)).from
  const b = doc.line(Math.min(doc.lines, doc.lineAt(to).number + 1)).to
  return overlapsCursor(state, a, b)
}

const rebuild = StateEffect.define()

// CodeMirror refuses block decorations from a view plugin ("Block decorations
// may not be specified via plugins"), so the widget set splits in two:
//
//   inline widgets (equations mid-line, thumbnails) → ViewPlugin, viewport only
//   block widgets  (tables, display math, figures)  → StateField, whole document
//
// The StateField cannot see the viewport, so it must not rescan 1 MB per
// keystroke. It maps its ranges through the change and rescans only the block
// the edit touched.

// ── inline ──────────────────────────────────────────────────────────────────
function buildInline(view) {
  if (!opts.widgets) return Decoration.none
  const decos = []
  const { state } = view
  const doc = state.doc
  for (const { from, to } of view.visibleRanges) {
    const first = doc.lineAt(from).number, last = doc.lineAt(to).number
    for (let n = first; n <= last; n++) {
      const line = doc.line(n)
      const text = line.text
      if (isBlockLine(doc, n)) continue        // owned by the block field
      const cursorHere = overlapsCursor(state, line.from, line.to)

      // headings: size the line, hide the hashes unless the cursor is on it
      const h = text.match(HEADING_RE)
      if (h) {
        decos.push({ from: line.from, to: line.from, line: Decoration.line({ class: 'tx-h' + h[1].length }) })
        if (opts.reveal && !cursorHere) {
          decos.push({ from: line.from, to: line.from + h[0].length, deco: Decoration.replace({}) })
        }
      }

      // emphasis / code marks and link targets: hidden away from the cursor
      if (opts.reveal && !cursorHere) {
        MARKS_RE.lastIndex = 0
        let k
        while ((k = MARKS_RE.exec(text))) {
          const f = line.from + k.index
          decos.push({ from: f, to: f + k[0].length, deco: Decoration.replace({}) })
        }
        LINK_RE.lastIndex = 0
        while ((k = LINK_RE.exec(text))) {
          const f = line.from + k.index
          decos.push({ from: f, to: f + 1, deco: Decoration.replace({}) })            // [
          decos.push({ from: f + 1 + k[1].length, to: f + k[0].length, deco: Decoration.replace({}), cls: 1 })  // ](url)
        }
      }

      let m
      IMAGE_RE.lastIndex = 0
      while ((m = IMAGE_RE.exec(text))) {
        const f = line.from + m.index, t = f + m[0].length
        if (opts.reveal && overlapsCursor(state, f, t)) continue
        decos.push({ from: f, to: t, deco: Decoration.replace({ widget: new ImageWidget(m[2], m[1], false) }) })
      }
      INLINE_MATH_RE.lastIndex = 0
      while ((m = INLINE_MATH_RE.exec(text))) {
        const f = line.from + m.index, t = f + m[0].length
        if (opts.reveal && overlapsCursor(state, f, t)) continue
        decos.push({ from: f, to: t, deco: Decoration.replace({ widget: new MathWidget(m[1], false) }) })
      }
    }
  }
  decos.sort((a, b) => a.from - b.from || (a.line ? -1 : b.line ? 1 : 0) || a.to - b.to)
  const b = new RangeSetBuilder()
  let lastTo = -1
  for (const d of decos) {
    if (d.line) { b.add(d.from, d.from, d.line); continue }
    if (d.from < lastTo || d.from === d.to) continue
    b.add(d.from, d.to, d.deco)
    lastTo = d.to
  }
  return b.finish()
}

const inlinePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildInline(view) }
  update(u) {
    if (u.docChanged || u.viewportChanged || u.selectionSet ||
        u.transactions.some(t => t.effects.some(e => e.is(rebuild)))) {
      const t0 = performance.now()
      this.decorations = buildInline(u.view)
      const ms = performance.now() - t0
      metrics.lastInline = ms
      metrics.inlineSamples.push(ms)
    }
  }
}, {
  decorations: v => v.decorations,
  provide: plugin => EditorView.atomicRanges.of(view =>
    opts.atomic ? (view.plugin(plugin)?.decorations || Decoration.none) : Decoration.none),
})

// ── block ───────────────────────────────────────────────────────────────────
function isBlockLine(doc, n) {
  const text = doc.line(n).text
  if (DISPLAY_MATH_LINE.test(text)) return true
  if (IMAGE_ALONE.test(text)) return true
  if (text.trimStart().startsWith('|')) return true
  return false
}

const blockRevealed = (state, from, to) =>
  opts.revealAdjacent ? nearCursor(state, from, to) : overlapsCursor(state, from, to)

// Collect block widgets for lines [fromLine, toLine].
function buildBlocks(state, fromLine, toLine) {
  const out = []
  if (!opts.widgets) return out
  const doc = state.doc
  let n = fromLine
  while (n <= toLine) {
    const line = doc.line(n)
    const text = line.text

    if (text.trimStart().startsWith('|') && n < doc.lines && TABLE_DELIM.test(doc.line(n + 1).text)) {
      let end = n, rows = []
      while (end <= doc.lines && doc.line(end).text.trimStart().startsWith('|')) { rows.push(doc.line(end).text); end++ }
      const tFrom = line.from, tTo = doc.line(end - 1).to
      if (!(opts.reveal && blockRevealed(state, tFrom, tTo))) {
        out.push(Decoration.replace({ widget: new TableWidget(rows), block: true }).range(tFrom, tTo))
      }
      n = end
      continue
    }

    const dm = text.match(DISPLAY_MATH_LINE)
    if (dm && !(opts.reveal && blockRevealed(state, line.from, line.to))) {
      out.push(Decoration.replace({ widget: new MathWidget(dm[1].trim(), true), block: true }).range(line.from, line.to))
      n++
      continue
    }

    const im = text.match(IMAGE_ALONE)
    if (im && !(opts.reveal && blockRevealed(state, line.from, line.to))) {
      out.push(Decoration.replace({ widget: new ImageWidget(im[2], im[1], true), block: true }).range(line.from, line.to))
    }
    n++
  }
  return out
}

// Widen a dirty region to whole paragraph blocks, so a table edited on one row
// is rebuilt as a unit.
function dirtyBlock(doc, from, to) {
  let a = doc.lineAt(Math.max(0, from)).number
  let b = doc.lineAt(Math.min(doc.length, to)).number
  while (a > 1 && doc.line(a - 1).text.trim() !== '') a--
  while (b < doc.lines && doc.line(b + 1).text.trim() !== '') b++
  // one further line each way, so an adjacency reveal is inside the dirty region
  return [Math.max(1, a - 2), Math.min(doc.lines, b + 2)]
}

const blockField = StateField.define({
  create(state) {
    const t0 = performance.now()
    const d = Decoration.set(buildBlocks(state, 1, state.doc.lines), true)
    metrics.initialBlockScan = performance.now() - t0
    return d
  },
  update(deco, tr) {
    const forced = tr.effects.some(e => e.is(rebuild))
    if (!tr.docChanged && !tr.selection && !forced) return deco
    const t0 = performance.now()
    let result
    if (forced) {
      result = Decoration.set(buildBlocks(tr.state, 1, tr.state.doc.lines), true)
    } else {
      let mapped = deco.map(tr.changes)
      const doc = tr.state.doc
      let lo = Infinity, hi = -1
      tr.changes.iterChangedRanges((fA, tA, fB, tB) => { lo = Math.min(lo, fB); hi = Math.max(hi, tB) })
      if (tr.selection) {                       // reveal-on-cursor moves the dirt
        const olds = tr.startState.selection.main, news = tr.state.selection.main
        const mapPos = p => { try { return tr.changes.mapPos(p) } catch (e) { return p } }
        lo = Math.min(lo, mapPos(olds.from), news.from)
        hi = Math.max(hi, mapPos(olds.to), news.to)
      }
      if (hi < 0) { result = mapped }
      else {
        lo = Math.max(0, Math.min(lo, doc.length)); hi = Math.max(0, Math.min(hi, doc.length))
        const [a, b] = dirtyBlock(doc, lo, hi)
        const from = doc.line(a).from, to = doc.line(b).to
        result = mapped.update({
          filterFrom: from, filterTo: to, filter: () => false,
          add: buildBlocks(tr.state, a, b), sort: true,
        })
      }
    }
    const ms = performance.now() - t0
    metrics.lastBlock = ms
    metrics.blockSamples.push(ms)
    return result
  },
  provide: f => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of(view => opts.atomicBlocks ? view.state.field(f) : Decoration.none),
  ],
})

// ────────────────────────────────────────────────────── instrumentation ─────

export const metrics = {
  paint: [],          // keystroke → frame after the painting frame (upper bound)
  paintLow: [],       // keystroke → the painting frame itself (lower bound)
  eventTiming: [],    // hardware event → presentation, browser-measured, ms (8ms buckets)
  inputDelay: [],     // hardware event → handler start: queueing under burst
  processing: [],     // handler duration
  inlineSamples: [],  // inline decoration rebuild cost (viewport scan)
  blockSamples: [],   // block decoration field update cost
  longTasks: 0,
  maxQueue: 0,
  lastInline: 0,
  lastBlock: 0,
  initialBlockScan: 0,
}

function pct(arr, p) {
  if (!arr.length) return NaN
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))]
}

let pendingKeys = []
let rafScheduled = false
function schedulePaintProbe() {
  if (rafScheduled) return
  rafScheduled = true
  requestAnimationFrame(t1 => {
    const batch = pendingKeys; pendingKeys = []
    for (const t0 of batch) metrics.paintLow.push(t1 - t0)
    requestAnimationFrame(t2 => {
      rafScheduled = false
      for (const t0 of batch) metrics.paint.push(t2 - t0)
      if (pendingKeys.length) schedulePaintProbe()
    })
  })
}

function installProbes(dom) {
  dom.addEventListener('keydown', e => {
    if (e.isComposing) return
    pendingKeys.push(e.timeStamp)
    metrics.maxQueue = Math.max(metrics.maxQueue, pendingKeys.length)
    schedulePaintProbe()
  }, true)

  try {
    new PerformanceObserver(list => {
      for (const en of list.getEntries()) {
        if (en.name !== 'keydown' && en.name !== 'keypress' && en.name !== 'input') continue
        if (en.name === 'keydown') {
          metrics.eventTiming.push(en.duration)
          metrics.inputDelay.push(en.processingStart - en.startTime)
          metrics.processing.push(en.processingEnd - en.processingStart)
        }
      }
    }).observe({ type: 'event', durationThreshold: 0, buffered: true })
  } catch (err) { /* Safari before 16.4 */ }

  try {
    new PerformanceObserver(l => { metrics.longTasks += l.getEntries().length })
      .observe({ type: 'longtask', buffered: true })
  } catch (err) { /* not in Safari */ }
}

// ──────────────────────────────────────────────────────────── theme ─────────

const themeComp = new Compartment()
const vimComp = new Compartment()
const caretComp = new Compartment()      // drawn cursor vs the browser's native caret
const matchComp = new Compartment()      // selection-match highlighting
const bracketComp = new Compartment()    // bracket matching
const syntaxComp = new Compartment()     // prose syntax highlighting
const wrapComp = new Compartment()       // line wrapping
const langComp = new Compartment()       // the markdown parser itself

function tephraTheme(cfg) {
  return EditorView.theme({
    '&': {
      fontSize: cfg.size + 'px',
      color: 'var(--text)',
      backgroundColor: 'var(--surface)',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: cfg.font,
      lineHeight: cfg.leading,
      letterSpacing: cfg.tracking + 'em',
      overflowX: 'hidden',
    },
    '.cm-content': {
      maxWidth: cfg.measure + 'ch',
      margin: '0 auto',
      padding: '3rem 1rem 60vh',
      caretColor: 'rgb(var(--accent))',
    },
    '.cm-line': { padding: '0 0 ' + cfg.paraSpace + 'em 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftWidth: cfg.caretWidth + 'px', borderLeftColor: 'rgb(var(--accent))' },
    '.cm-fat-cursor': { background: 'rgb(var(--accent)) !important', color: 'rgb(var(--surface)) !important' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgb(var(--accent-surface))',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-gutters': { display: 'none' },
    '.cm-panels': { fontFamily: 'var(--font-sidebar)', fontSize: '13px' },
  }, { dark: cfg.dark })
}

// ─────────────────────────────────────────────────────────── boot ───────────

const root = document.getElementById('editor')

async function boot() {
  const text = await (await fetch('corpus.md')).text()

  const cfg = {
    font: "'Lora', Georgia, serif", size: 18, leading: 1.62, measure: 74, dark: false,
    paraSpace: 0.55, tracking: -0.01, caretWidth: 2,
  }
  const feat = {                     // everything switchable, all on by default
    vim: true, drawnCaret: true, blink: 1200, selMatch: true, brackets: true,
    syntax: true, wrap: true, markdownParser: true, smoothing: true,
  }

  const view = new EditorView({
    parent: root,
    state: EditorState.create({
      doc: text,
      extensions: [
        vimComp.of(vim({ status: true })),
        history(),
        caretComp.of(drawSelection({ cursorBlinkRate: feat.blink })),
        rectangularSelection(),
        crosshairCursor(),
        matchComp.of(highlightSelectionMatches()),
        bracketComp.of(bracketMatching()),
        langComp.of(markdown()),
        syntaxComp.of(syntaxHighlighting(proseHighlight, { fallback: true })),
        wrapComp.of(EditorView.lineWrapping),
        blockField,
        inlinePlugin,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        themeComp.of(tephraTheme(cfg)),
      ],
    }),
  })
  window.view = view
  window.spikeOpts = opts
  window.spikeMetrics = metrics
  window.spikeRebuild = () => view.dispatch({ effects: rebuild.of(null) })
  installProbes(view.dom)

  // ── HUD ──
  const hud = document.getElementById('hud')
  const fmt = n => (Number.isNaN(n) ? '—' : n.toFixed(1))
  function refresh() {
    const m = metrics
    hud.querySelector('#stats').innerHTML = `
      <table>
        <tr><th></th><th>n</th><th>p50</th><th>p95</th><th>p99</th><th>max</th></tr>
        <tr><td title="hardware event → presentation, browser-measured, 8 ms buckets">to&nbsp;paint (browser)</td>
            <td>${m.eventTiming.length}</td><td>${fmt(pct(m.eventTiming, 50))}</td><td>${fmt(pct(m.eventTiming, 95))}</td>
            <td class="${pct(m.eventTiming, 99) > 30 ? 'bad' : 'ok'}">${fmt(pct(m.eventTiming, 99))}</td><td>${fmt(Math.max(0, ...m.eventTiming))}</td></tr>
        <tr><td title="keydown → the frame that paints the change (lower bound)">to&nbsp;paint (low)</td>
            <td>${m.paintLow.length}</td><td>${fmt(pct(m.paintLow, 50))}</td><td>${fmt(pct(m.paintLow, 95))}</td>
            <td class="${pct(m.paintLow, 99) > 30 ? 'bad' : 'ok'}">${fmt(pct(m.paintLow, 99))}</td><td>${fmt(Math.max(0, ...m.paintLow))}</td></tr>
        <tr><td title="keydown → the frame after that one (upper bound)">to&nbsp;paint (high)</td>
            <td>${m.paint.length}</td><td>${fmt(pct(m.paint, 50))}</td><td>${fmt(pct(m.paint, 95))}</td>
            <td class="${pct(m.paint, 99) > 30 ? 'bad' : 'ok'}">${fmt(pct(m.paint, 99))}</td><td>${fmt(Math.max(0, ...m.paint))}</td></tr>
        <tr><td title="event → handler start; rises if keystrokes queue">input delay</td>
            <td>${m.inputDelay.length}</td><td>${fmt(pct(m.inputDelay, 50))}</td><td>${fmt(pct(m.inputDelay, 95))}</td>
            <td>${fmt(pct(m.inputDelay, 99))}</td><td>${fmt(Math.max(0, ...m.inputDelay))}</td></tr>
        <tr><td>JS handler</td><td>${m.processing.length}</td><td>${fmt(pct(m.processing, 50))}</td><td>${fmt(pct(m.processing, 95))}</td>
            <td>${fmt(pct(m.processing, 99))}</td><td>${fmt(Math.max(0, ...m.processing))}</td></tr>
        <tr><td title="viewport rescan for inline widgets">inline widgets</td><td>${m.inlineSamples.length}</td><td>${fmt(pct(m.inlineSamples, 50))}</td><td>${fmt(pct(m.inlineSamples, 95))}</td>
            <td>${fmt(pct(m.inlineSamples, 99))}</td><td>${fmt(Math.max(0, ...m.inlineSamples))}</td></tr>
        <tr><td title="whole-document state field, incrementally updated">block widgets</td><td>${m.blockSamples.length}</td><td>${fmt(pct(m.blockSamples, 50))}</td><td>${fmt(pct(m.blockSamples, 95))}</td>
            <td>${fmt(pct(m.blockSamples, 99))}</td><td>${fmt(Math.max(0, ...m.blockSamples))}</td></tr>
      </table>
      <div class="sub">initial block scan: <b>${fmt(m.initialBlockScan)} ms</b> &middot; long tasks &gt;50 ms: <b>${m.longTasks}</b> &middot; max keystroke queue: <b>${m.maxQueue}</b>
        &middot; doc: <b>${(view.state.doc.length / 1e6).toFixed(2)} MB</b>, ${view.state.doc.lines} lines</div>`
  }
  setInterval(refresh, 400)

  // ── controls ──
  const $ = s => hud.querySelector(s)
  const relayout = () => {
    view.dispatch({ effects: themeComp.reconfigure(tephraTheme(cfg)) })
  }
  const rerender = () => view.dispatch({ effects: rebuild.of(null) })

  $('#t-widgets').onchange = e => { opts.widgets = e.target.checked; rerender(); clearStats(); showConfig() }
  $('#t-atomic').onchange = e => { opts.atomic = e.target.checked; rerender() }
  $('#t-atomicb').onchange = e => { opts.atomicBlocks = e.target.checked; rerender() }
  $('#t-reveal').onchange = e => { opts.reveal = e.target.checked; rerender(); clearStats() }
  $('#t-adj').onchange = e => { opts.revealAdjacent = e.target.checked; rerender() }
  const clearStats = () => {
    metrics.paint.length = 0; metrics.paintLow.length = 0; metrics.eventTiming.length = 0; metrics.inputDelay.length = 0
    metrics.processing.length = 0; metrics.inlineSamples.length = 0; metrics.blockSamples.length = 0
    metrics.longTasks = 0; metrics.maxQueue = 0
  }
  $('#reset').onclick = () => { clearStats(); view.focus() }

  // ── the fluidity dimensions ──
  // Each of these is a plausible answer to "it types fine but something is off".
  // Flip one at a time; the stats reset so the numbers describe the new config.
  const feature = {
    vim: on => vimComp.reconfigure(on ? vim({ status: true }) : []),
    drawnCaret: on => caretComp.reconfigure(on ? drawSelection({ cursorBlinkRate: feat.blink }) : []),
    selMatch: on => matchComp.reconfigure(on ? highlightSelectionMatches() : []),
    brackets: on => bracketComp.reconfigure(on ? bracketMatching() : []),
    syntax: on => syntaxComp.reconfigure(on ? syntaxHighlighting(proseHighlight, { fallback: true }) : []),
    wrap: on => wrapComp.reconfigure(on ? EditorView.lineWrapping : []),
    markdownParser: on => langComp.reconfigure(on ? markdown() : []),
  }
  function setFeature(name, on) {
    feat[name] = on
    if (name === 'smoothing') {
      document.body.style.webkitFontSmoothing = on ? 'antialiased' : 'auto'
    } else {
      view.dispatch({ effects: feature[name](on) })
    }
    clearStats()
    showConfig()
    view.focus()
  }
  for (const name of Object.keys(feature).concat('smoothing')) {
    const el = $('#f-' + name)
    if (el) el.onchange = e => setFeature(name, e.target.checked)
  }
  $('#blink').oninput = e => {
    feat.blink = Number(e.target.value)
    $('#blink-v').textContent = feat.blink === 0 ? 'off' : feat.blink
    if (feat.drawnCaret) view.dispatch({ effects: caretComp.reconfigure(drawSelection({ cursorBlinkRate: feat.blink })) })
  }
  $('#allon').onclick = () => {
    for (const n of Object.keys(feat)) if (typeof feat[n] === 'boolean') { const el = $('#f-' + n); if (el) { el.checked = true; setFeature(n, true) } }
  }
  $('#alloff').onclick = () => {
    for (const n of Object.keys(feat)) if (typeof feat[n] === 'boolean' && n !== 'wrap') { const el = $('#f-' + n); if (el) { el.checked = false; setFeature(n, false) } }
    opts.widgets = false; $('#t-widgets').checked = false; rerender()
  }
  function showConfig() {
    const off = Object.entries(feat).filter(([k, v]) => v === false).map(([k]) => k)
    if (!opts.widgets) off.push('widgets')
    $('#config').textContent = off.length ? 'off: ' + off.join(', ') : 'everything on'
  }
  showConfig()
  $('#top').onclick = () => { view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true }); view.focus() }
  $('#mid').onclick = () => {
    const p = Math.floor(view.state.doc.length / 2)
    view.dispatch({ selection: { anchor: p }, effects: EditorView.scrollIntoView(p, { y: 'center' }) })
    view.focus()
  }
  $('#end').onclick = () => {
    const p = view.state.doc.length
    view.dispatch({ selection: { anchor: p }, effects: EditorView.scrollIntoView(p, { y: 'center' }) })
    view.focus()
  }

  // Where you type inside a paragraph changes how much has to be re-laid out:
  // inserting at the head of a 3 000-character wrapped paragraph rewraps all of
  // it every keystroke, while appending to a short line rewraps one visual row.
  const goto = (pos, note) => {
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    clearStats()
    $('#where').textContent = note
    view.focus()
  }
  let longest = { len: 0, from: 0 }
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const l = view.state.doc.line(n)
    if (l.length > longest.len) longest = { len: l.length, from: l.from }
  }
  $('#p-head').onclick = () => goto(longest.from + 2, `head of a ${longest.len}-char paragraph`)
  $('#p-tail').onclick = () => goto(longest.from + longest.len, `tail of a ${longest.len}-char paragraph`)
  $('#p-short').onclick = () => {
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const l = view.state.doc.line(n)
      if (l.length > 40 && l.length < 90 && !l.text.startsWith('#') && !l.text.startsWith('|')) return goto(l.to, `end of a ${l.length}-char line`)
    }
  }
  $('#p-empty').onclick = () => {
    const l = view.state.doc.line(Math.floor(view.state.doc.lines / 2))
    view.dispatch({ changes: { from: l.to, insert: '\n' }, selection: { anchor: l.to + 1 } })
    goto(l.to + 1, 'a fresh empty line')
  }

  // exposed so the automated bisect drives exactly the same switches you do
  window.spikeSetFeature = (name, on) => {
    const el = $('#f-' + name); if (el) el.checked = on
    setFeature(name, on)
  }
  window.spikeGoto = kind => { $('#p-' + kind).click(); return $('#where').textContent }
  window.spikeSetWidgets = on => { $('#t-widgets').checked = on; opts.widgets = on; rerender(); clearStats(); showConfig() }
  window.spikeClearStats = clearStats
  window.spikePrint = () => printSelection(view)
  window.spikePaste = () => pasteImage(view, null)
  window.spikeSelect = (from, to) => { view.dispatch({ selection: { anchor: from, head: to } }); return view.state.sliceDoc(from, to).length }

  // ── Spike B: the two OS operations ──
  const say = msg => { $('#shellout').textContent = msg }
  $('#shellname').textContent = shell.name
  $('#print').onclick = async () => {
    say('printing…')
    try {
      const r = await printSelection(view)
      say(`print → ${r.via}${r.ms != null ? `, ${r.ms} ms` : ''}${r.note ? ` — ${r.note}` : ''}`)
    } catch (e) { say('print failed: ' + e.message) }
    view.focus()
  }
  $('#paste').onclick = async () => {
    say('reading clipboard…')
    try {
      const r = await pasteImage(view, null)
      say(r ? `paste → ${r.via}${r.path ? `, wrote ${r.path}` : ''}${r.bytes ? `, ${(r.bytes / 1024).toFixed(0)} KB` : ''}${r.note ? ` — ${r.note}` : ''}`
            : 'no image on the clipboard')
    } catch (e) { say('paste failed: ' + e.message) }
    view.focus()
  }
  // real Cmd+V, so the shell path is exercised the way it actually would be
  view.dom.addEventListener('paste', async e => {
    const r = await pasteImage(view, e)
    if (r) { e.preventDefault(); say(`paste → ${r.via}${r.path ? `, wrote ${r.path}` : ''}`) }
  })
  window.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') { e.preventDefault(); $('#print').click() }
  })

  const bind = (sel, key, fn) => { $(sel).oninput = e => { cfg[key] = fn(e.target.value); relayout(); $(sel + '-v').textContent = e.target.value } }
  $('#font').onchange = e => { cfg.font = e.target.value; relayout() }
  bind('#size', 'size', Number)
  bind('#measure', 'measure', Number)
  bind('#leading', 'leading', Number)
  bind('#paraSpace', 'paraSpace', Number)
  bind('#tracking', 'tracking', Number)
  bind('#caretWidth', 'caretWidth', Number)
  $('#theme').onchange = e => {
    document.documentElement.dataset.mode = e.target.value
    cfg.dark = e.target.value === 'dark'
    relayout()
  }

  // ── synthetic typing (repeatable load; real typing is the real criterion) ──
  let typing = null
  const SAMPLE = `The point of this paragraph is only to be typed. It is long enough to hold a rhythm, plain enough that nothing in it is surprising, and it repeats until stopped so that the measurement has as many samples as it needs. `
  $('#type').onclick = () => {
    if (typing) { clearInterval(typing); typing = null; $('#type').textContent = 'Synthetic typing'; return }
    const wpm = Number($('#wpm').value)
    const gap = 60000 / (wpm * 5)
    let i = 0
    view.focus()
    typing = setInterval(() => {
      const ch = SAMPLE[i++ % SAMPLE.length]
      const ok = document.execCommand && document.execCommand('insertText', false, ch)
      if (!ok) view.dispatch(view.state.replaceSelection(ch))
    }, gap)
    $('#type').textContent = 'Stop typing'
  }

  $('#dump').onclick = () => {
    const m = metrics
    const row = (name, a) => `${name}: n=${a.length} p50=${fmt(pct(a, 50))} p95=${fmt(pct(a, 95))} p99=${fmt(pct(a, 99))} max=${fmt(Math.max(0, ...a))}`
    const txt = [
      `ua: ${navigator.userAgent}`,
      `doc: ${(view.state.doc.length / 1e6).toFixed(2)} MB, ${view.state.doc.lines} lines`,
      `opts: widgets=${opts.widgets} atomicInline=${opts.atomic} atomicBlocks=${opts.atomicBlocks} reveal=${opts.reveal} revealAdjacent=${opts.revealAdjacent}`,
      row('to-paint (browser event timing)', m.eventTiming),
      row('to-paint (lower bound)', m.paintLow),
      row('to-paint (upper bound)', m.paint),
      row('input delay', m.inputDelay),
      row('JS handler', m.processing),
      row('inline widget rescan', m.inlineSamples),
      row('block widget update', m.blockSamples),
      `initial block scan: ${fmt(m.initialBlockScan)} ms`,
      `long tasks >50ms: ${m.longTasks}; max queue: ${m.maxQueue}`,
    ].join('\n')
    navigator.clipboard?.writeText(txt)
    console.log(txt)
    $('#dump').textContent = 'copied ✓'
    setTimeout(() => { $('#dump').textContent = 'Copy results' }, 1200)
  }

  // scroll-storm: measure widget behaviour as the document moves under us
  $('#scroll').onclick = async () => {
    const sc = view.scrollDOM
    const start = performance.now()
    let frames = 0, worst = 0, last = performance.now()
    const tick = () => {
      const now = performance.now()
      worst = Math.max(worst, now - last); last = now; frames++
      sc.scrollTop += 900
      if (now - start < 4000 && sc.scrollTop < sc.scrollHeight - sc.clientHeight) requestAnimationFrame(tick)
      else $('#scrollres').textContent = `${frames} frames in ${((performance.now() - start) / 1000).toFixed(1)}s · worst frame ${worst.toFixed(0)} ms`
    }
    requestAnimationFrame(tick)
  }

  view.focus()
  refresh()
}

boot().catch(e => { console.error("BOOT FAILED", e); document.title = "BOOT FAILED" })
