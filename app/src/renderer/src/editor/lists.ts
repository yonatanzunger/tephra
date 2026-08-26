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
import { type ChangeSpec, type EditorState, type Extension, Prec, type StateCommand } from '@codemirror/state'
import { keymap } from '@codemirror/view'
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
 * Ahead of vim's binding, and deliberately.
 *
 * With vim on, insert-mode Tab is otherwise vim's, and a list would stop
 * indenting the moment the mode was switched on — a feature that comes and goes
 * with an unrelated setting is worse than one that is not there. Outside a list
 * both commands decline, so vim keeps every Tab it has a use for.
 */
export function listIndent(): Extension {
  return Prec.high(keymap.of([
    { key: 'Tab', run: indentListItem },
    { key: 'Shift-Tab', run: outdentListItem },
  ]))
}
