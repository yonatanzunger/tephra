// Which way a line runs (D98).
//
// **Reported from use, in a memorial prayer.** Nine lines of Hebrew, rendered
// left-aligned, with each line's trailing comma parked at the *right* edge of
// the text — *as though we're in some kind of LTR-override state.* Which is
// precisely what it was, and the override was a default.
//
// ## What the browser already does, and the one thing it waits to be asked
//
// Chromium implements the bidi algorithm: the reordering rules, the resolution
// of neutrals, all of it. That is why the fault read as *nearly right* — every
// Hebrew run was ordered correctly, because ordering a run is the part nobody
// has to ask for.
//
// What it does not decide unasked is the **paragraph's base direction** — rules
// P2 and P3, *take the direction of the first strongly-directional character* —
// because a block of markup has an author who may mean either. `dir="auto"` is
// how you ask, and asking is the whole of this file. **Nothing here implements
// the algorithm**, and an earlier draft that did was wrong in two ways within
// twenty lines: it inferred *strong* from `Script=`, which makes an Arabic-Indic
// digit (`Bidi_Class=AN`) and a Hebrew vowel point (`NSM`) look strong when both
// are weak and P2 skips them. Measured in Chromium, `dir="auto"` gets both right
// — it is reading ICU's real `Bidi_Class` table, which JavaScript cannot: only
// `General_Category`, `Script` and `Script_Extensions` are exposed to `\p{…}`,
// so `\p{Bidi_Class=R}` is a syntax error, and `Intl` offers nothing per
// character either.
//
// ## Why it is not already on
//
// Two defaults, and both had to move.
//
// **CodeMirror reads the direction rather than assigning it** —
// `getComputedStyle(line).direction` — and only per line when
// `EditorView.perLineTextDirection` is turned on, which is off by default
// because it costs a measurement per line. So every line inherited the
// document's `ltr`, the trailing commas resolved to that direction, and they
// landed at its end, which in a left-to-right paragraph is the right-hand side.
//
// **And our own theme said `text-align: left`**, a physical value, so a line
// given the right direction would still have been flush left. It is `start`
// now, which is *left* for English and *right* for Hebrew.
//
// ## Per line, which is per element — and the cost of that
//
// `dir="auto"` resolves on the element it sits on, and an element here is one
// source line. Tephra's paragraphs are runs of consecutive lines (markdown's
// rule, and why there is no leading between them), so a Hebrew paragraph whose
// fourth line happens to open with a name in Latin letters will have that line
// alone flip and align against its neighbours. The honest reading of that is
// that the line really does begin with an English word — and the escape hatch
// is Unicode's own: a U+200F at the start of the line is strong, and settles it
// without printing anything. Deciding per paragraph instead would mean asking
// the question ourselves, and this file is what that looked like.

import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { codeRows } from './code.ts'

/** *You decide*: P2 and P3, over this line's own text, in ICU rather than here. */
const AUTO = Decoration.line({ attributes: { dir: 'auto' } })

/**
 * **Code is left-to-right whatever alphabet it is written in**, because its
 * columns are its meaning: a line of Python that begins with a Hebrew comment is
 * still indented from the left. Said outright rather than left to inherit, so it
 * does not depend on what the content element happens to be set to.
 */
const CODE = Decoration.line({ attributes: { dir: 'ltr' } })

function build(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const code = new Set(codeRows(state).map(row => row.at))
  const builder = new RangeSetBuilder<Decoration>()
  // **Two visible ranges can share a line**, their edges being document offsets
  // rather than line boundaries, and a line decoration added twice is an error
  // rather than a duplicate.
  let done = 0
  for (const range of ranges) {
    const last = state.doc.lineAt(range.to).number
    for (let n = Math.max(done + 1, state.doc.lineAt(range.from).number); n <= last; n += 1) {
      const line = state.doc.line(n)
      builder.add(line.from, line.from, code.has(line.from) ? CODE : AUTO)
      done = n
    }
  }
  return builder.finish()
}

/**
 * Each line runs the way its own words do (D98).
 *
 * **A view plugin over the viewport, like the code blocks it asks about**, and
 * it watches `syntaxTree` for the same reason `codeBlocks` does: the parse
 * arrives after the first render, and a code block must not be read as prose
 * until then.
 */
export function textDirection(): Extension {
  return [
    // **Without this, CodeMirror uses one direction for the whole editor**, and
    // the attribute below would style the text while the caret, the selection
    // rectangles and every coordinate lookup went on believing otherwise.
    // Correct arrow keys in Hebrew are worth a measurement per line.
    EditorView.perLineTextDirection.of(true),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = build(view.state, view.visibleRanges)
        }

        update(update: ViewUpdate): void {
          if (
            update.docChanged
            || update.viewportChanged
            || syntaxTree(update.startState) !== syntaxTree(update.state)
          ) {
            this.decorations = build(update.view.state, update.view.visibleRanges)
          }
        }
      },
      { decorations: plugin => plugin.decorations },
    ),
  ]
}
