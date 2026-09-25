// Fenced code blocks, as a place rather than as a colour.
//
// **A block, not a run of monospace.** Face and size can ride on the inline
// highlight — a `tags.monospace` rule reaches every character of a fenced
// block — but leading, an inset and a measure are properties of a LINE, and a
// highlight cannot set them. So the lines of a fence are marked here, and the
// theme styles the class.
//
// The measure is the reason this matters. Prose is set to a reading measure;
// code is written to eighty columns, and wrapping it at sixty destroys the one
// thing its layout carries — a wrapped Python line looks like an indent that is
// not there. A marked line can be given a width of its own and reach past the
// prose column to get it.

import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder, type EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

const CODE_LINE = Decoration.line({ class: 'tx-code' })
/** The fence rows themselves — ``` and its info string — which are apparatus. */
const FENCE_LINE = Decoration.line({ class: 'tx-code tx-fence' })

/**
 * Every line of every code block, by start offset, in document order.
 *
 * **Exported because a second layer asks the same question** (D98). Code is
 * left-to-right whatever alphabet it is written in — its columns are its
 * meaning — so the bidi layer has to know which lines are code, and walking the
 * tree for it twice would be one rule kept in two places.
 */
export function codeRows(state: EditorState): readonly { at: number; fence: boolean }[] {
  const rows: { at: number; fence: boolean }[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return
      const first = state.doc.lineAt(node.from).number
      const last = state.doc.lineAt(Math.min(node.to, state.doc.length)).number
      for (let n = first; n <= last; n++) {
        const line = state.doc.line(n)
        // The opening and closing rows are the fence, not the code: they take
        // the block's face so the shape holds, and can be quietened separately.
        rows.push({ at: line.from, fence: n === first || n === last })
      }
    },
  })

  // The tree is walked in document order, but a nested block would not be, and
  // `RangeSetBuilder` requires sorted input rather than merely usually-sorted.
  rows.sort((a, b) => a.at - b.at)
  return rows
}

function build(state: EditorState): DecorationSet {
  const rows = codeRows(state)
  const builder = new RangeSetBuilder<Decoration>()
  let previous = -1
  for (const row of rows) {
    if (row.at === previous) continue
    builder.add(row.at, row.at, row.fence ? FENCE_LINE : CODE_LINE)
    previous = row.at
  }
  return builder.finish()
}

/**
 * A view plugin rather than a state field, and the difference is not cosmetic.
 *
 * **The syntax tree is parsed lazily.** A field built in `create` sees whatever
 * had been parsed by then — for a document that opens with a code block, that
 * is nothing — and a field that rebuilds only on `docChanged` never sees the
 * parse finish, so the block renders as prose forever and typing anywhere fixes
 * it. Watching `syntaxTree` change is what catches the parse arriving.
 */
export function codeBlocks(): ReturnType<typeof ViewPlugin.fromClass> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = build(view.state)
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = build(update.state)
        }
      }
    },
    { decorations: plugin => plugin.decorations },
  )
}
