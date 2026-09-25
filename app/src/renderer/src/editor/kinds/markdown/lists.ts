// Tab indents a list, and does nothing anywhere else.
//
// **The exception is the whole design.** CodeMirror's own advice is not to bind
// Tab, because a keyboard user needs it to leave the editor — and an editor that
// swallows Tab everywhere is a trap. So this claims the key ONLY when the caret
// is inside a list item, which is the one place a writer expects it to mean
// "one level in". Everywhere else it falls through and moves focus, exactly as
// it did before.
//
// The indent is the item's own marker width plus its space — 2 for `- `, 3 for
// `1. ` — which is the column CommonMark requires a nested item to reach in
// order to be nested rather than to be a paragraph of its parent.

import { syntaxTree } from '@codemirror/language'
import {
  type ChangeSpec, type EditorState, type Extension, Prec, RangeSetBuilder, type StateCommand,
} from '@codemirror/state'
import {
  Decoration, EditorView, keymap, ViewPlugin, WidgetType,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/** The list item a position sits in, or null if it is not in a list at all. */
function itemAt(state: EditorState, at: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1)
  for (; node !== null; node = node.parent) if (node.name === 'ListItem') return node
  return null
}

/**
 * One level, for this item: the width of its marker and the space after it.
 *
 * Measured from the marker rather than assumed, because `- ` and `1. ` are two
 * and three, and a list that indents by the wrong amount stops being a list —
 * the text becomes a paragraph belonging to the item above.
 */
function level(state: EditorState, item: SyntaxNode): number {
  const mark = item.getChild('ListMark')
  return mark === null ? 2 : mark.to - mark.from + 1
}

/** Where the text on a line begins, ignoring the indentation. */
const textStart = (text: string): number => text.length - text.trimStart().length

/**
 * The last line of an item's subtree: itself, its wrapped text, and anything
 * nested under it.
 *
 * **Children come along, the way they do in every list editor a person has
 * used.** Moving an item without them would leave its own sub-items at the
 * level it just left, which is to say as its siblings — the structure the
 * keystroke was meant to build, silently taken apart.
 */
function subtreeEnd(state: EditorState, from: number, indent: number): number {
  const last = state.doc.lines
  let n = from
  while (n < last) {
    const next = state.doc.line(n + 1)
    const deeper = textStart(next.text)
    if (next.text.trim() !== '' && deeper <= indent) break
    n++
  }
  // A trailing blank line belongs to whatever comes after it, not to this item.
  while (n > from && state.doc.line(n).text.trim() === '') n--
  return n
}

const shift = (direction: 'in' | 'out'): StateCommand => ({ state, dispatch }) => {
  const changes: ChangeSpec[] = []
  let previous = 0

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    let last = state.doc.lineAt(range.to).number
    for (let n = Math.max(first, previous + 1); n <= last; n++) {
      const line = state.doc.line(n)
      const indent = textStart(line.text)
      if (indent === line.text.length) continue // blank: nothing to indent

      const item = itemAt(state, line.from + indent)
      if (item === null) continue
      const by = level(state, item)

      // Everything under this item moves with it. Within a selection the lines
      // are being visited anyway; this is what makes a bare caret behave.
      last = Math.max(last, subtreeEnd(state, n, indent))

      if (direction === 'in') changes.push({ from: line.from, insert: ' '.repeat(by) })
      else if (indent > 0) changes.push({ from: line.from, to: line.from + Math.min(by, indent) })
      previous = n
    }
  }

  // Nothing in a list means this was not our keystroke. Returning false is what
  // hands Tab back to the browser, and with it the way out of the editor.
  if (changes.length === 0) return false
  dispatch(state.update({ changes, userEvent: `input.indent.${direction}`, scrollIntoView: true }))
  return true
}

export const indentListItem = shift('in')
export const outdentListItem = shift('out')

/**
 * **Tab indents a list item, and declines everywhere else.**
 *
 * This used to be bound ahead of vim's insert-mode Tab so that indenting did not
 * come and go with an unrelated setting (D67 removed vim). Declining outside a
 * list is what remains of that care, and it is still the right shape: Tab in
 * running prose is not this command's business.
 */
/**
 * A wrapped bullet hangs under its own text, not under its marker.
 *
 * **The marker is not part of the sentence.** When an item wraps, the second
 * line running back to the page margin puts it under the `-`, where it reads as
 * a new item rather than as the rest of this one — the list loses its shape at
 * exactly the point a reader needs it most. Aligning the continuation with the
 * text above it is what every list in print does, and what the eye is looking
 * for when it scans a list.
 *
 * Done as a negative `text-indent` against an equal `padding-left`: the first
 * line pulls back to make room for the marker, and every wrapped line after it
 * starts where the text does.
 *
 * **In pixels, from measuring the marker itself.** `ch` is the width of a zero,
 * and in a serif face `- ` is narrower than that — near enough to look like an
 * alignment somebody tried and failed at, which is worse than not trying. The
 * prefix of each line is measured in the face it is actually set in, so the
 * continuation lands on the text above it exactly, whatever the marker is:
 * `- ` and `1. ` differ, and a nested item carries its own indentation too.
 */
interface Row {
  readonly at: number
  readonly hang: number
  /** The `-` to draw as a bullet, when this item has one. */
  readonly bullet: { readonly from: number; readonly to: number } | null
}

function listRows(state: EditorState, font: string): DecorationSet {
  const rows: Row[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'ListItem') return
      const line = state.doc.lineAt(node.from)
      const mark = node.node.getChild('ListMark')
      const marker = mark === null ? '-' : state.doc.sliceString(mark.from, mark.to)
      const chars = textStart(line.text) + marker.length + 1

      // **Measured on what is DISPLAYED, not on what is stored.** A bullet is
      // wider than a hyphen, so measuring the source would hang the wrap where
      // the text no longer starts — the alignment this exists for, off by the
      // difference between two glyphs.
      const shown = BULLETS.has(marker)
        ? `${line.text.slice(0, chars - marker.length - 1)}${BULLET} `
        : line.text.slice(0, chars)

      rows.push({
        at: line.from,
        hang: textWidth(shown, font),
        // **The separator goes with the marker, not with the sentence.** The
        // space after `-` is punctuation belonging to the list, and leaving it
        // in the text node makes the item's text begin with a space — which
        // renders, so the first word sits a space to the right of where the DOM
        // says the text starts. It aligns either way, because the hang counts
        // the space too, but a reader inspecting it cannot tell that.
        bullet:
          mark !== null && BULLETS.has(marker)
            ? { from: mark.from, to: Math.min(mark.to + 1, line.to) }
            : null,
      })
    },
  })

  rows.sort((a, b) => a.at - b.at)
  const builder = new RangeSetBuilder<Decoration>()
  let previous = -1
  for (const row of rows) {
    if (row.at === previous) continue
    builder.add(
      row.at,
      row.at,
      Decoration.line({
        class: 'tx-list',
        attributes: {
          // Inline-start, so an RTL list hangs its marker off the right (D98);
          // `text-indent` is already relative to the direction.
          style: `padding-inline-start:${row.hang.toFixed(2)}px;text-indent:-${row.hang.toFixed(2)}px`,
        },
      }),
    )
    // After the line decoration, which must come first at the same offset.
    if (row.bullet !== null) {
      builder.add(row.bullet.from, row.bullet.to, BULLET_MARK)
    }
    previous = row.at
  }
  return builder.finish()
}

/** What markdown accepts as a bullet, all of which read as one thing. */
const BULLETS = new Set(['-', '*', '+'])
const BULLET = '\u2022'

/**
 * The bullet a reader sees, over the hyphen the file keeps.
 *
 * **Display only, and that is the whole point.** The file stays `- item`, which
 * is what markdown is and what every other tool will read; the page shows the
 * character a list has been set with since long before markdown. Copying takes
 * the source, because a decoration is not text.
 *
 * Not revealed under the cursor, unlike a heading's `##`. A `##` tells you what
 * level you are editing — information the rendered form drops — and a `-` tells
 * you nothing the bullet does not, so revealing it would only make the line
 * twitch as the caret passed through.
 */
const BULLET_MARK = Decoration.replace({
  widget: new (class extends WidgetType {
    override toDOM(): HTMLElement {
      const dot = document.createElement('span')
      dot.className = 'tx-bullet'
      // The gap is inside the widget for the same reason: marker and separator
      // are one thing, and the hang is measured on exactly this string.
      dot.textContent = `${BULLET} `
      return dot
    }
    override eq(): boolean {
      return true
    }
  })(),
})

/**
 * The rendered width of a string in a given font.
 *
 * A canvas rather than the DOM: measuring by inserting an element would touch
 * the layout CodeMirror is in the middle of computing, and this is asked once
 * per list line per repaint. Cached on font-and-string, of which there are very
 * few — `- `, `1. `, and the same with indentation in front.
 */
const widths = new Map<string, number>()
function textWidth(text: string, font: string): number {
  const key = `${font}\u0000${text}`
  const known = widths.get(key)
  if (known !== undefined) return known
  const context = (canvas ??= document.createElement('canvas')).getContext('2d')
  if (context === null) return text.length * 8 // no canvas: an estimate beats nothing
  context.font = font
  const measured = context.measureText(text).width
  widths.set(key, measured)
  return measured
}
let canvas: HTMLCanvasElement | null = null

/** The face a line is actually set in, which is what the marker must be measured in. */
function contentFont(view: EditorView): string {
  const style = getComputedStyle(view.contentDOM)
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}

/**
 * A view plugin, not a state field, for the reason `code.ts` is one: the syntax
 * tree parses lazily, so anything built once at startup sees a document with no
 * lists in it yet.
 */
export function listLayout(): ReturnType<typeof ViewPlugin.fromClass> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = listRows(view.state, contentFont(view))
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.geometryChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          // The font is read fresh: changing the face or the size in the theme
          // panel moves every one of these, and a cached width would leave the
          // list aligned for the face before last.
          this.decorations = listRows(update.state, contentFont(update.view))
        }
      }
    },
    { decorations: plugin => plugin.decorations },
  )
}

export function listIndent(): Extension {
  return Prec.high(keymap.of([
    { key: 'Tab', run: indentListItem },
    { key: 'Shift-Tab', run: outdentListItem },
  ]))
}
