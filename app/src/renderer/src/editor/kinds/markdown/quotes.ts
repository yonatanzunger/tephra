// Quotes are curled as they are typed, except where they are not quotes (D87).
//
// `"` becomes `“` or `”` and `'` becomes `‘` or `’`, decided by what is already
// to the left of the caret — the rule every typesetter uses, and the one a
// typewriter keyboard has never been able to express.
//
// ## Two rules, and both are about restraint
//
// **Not inside code.** In a fenced block or a code span, a quote is a character
// of the language and a tick is a tick: `print("x")` must stay exactly that, and
// curling it would produce a program that does not run. Asked of the **syntax
// tree**, so the answer is the parser's rather than a guess from the text.
//
// **And never retroactively.** Nothing here ever re-examines text that is
// already written. A paragraph that becomes a code block keeps its curly quotes;
// a block that becomes a paragraph keeps its straight ones. That is deliberate:
// the alternative is an editor that rewrites what you wrote while you are
// reorganising it, which is a worse failure than an inconsistent quote — and it
// is unfixable in general, because *what you meant* is not recoverable from
// where the text has landed.
//
// ## Why this is a text transformation and not a rendering
//
// The file gets the curly character. Tephra's format is what it appears to be
// (R26, D20): a notebook read in any other editor shows the quotes a reader
// would expect, and `grep` finds what is on the page. A renderer that curled
// quotes on screen while the bytes stayed straight would be the *other* kind of
// lie — the one where the file and the page disagree.

import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import type { EditorState, Extension } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/** The four characters this produces. */
export const CURLY = {
  openDouble: '“',
  closeDouble: '”',
  openSingle: '‘',
  closeSingle: '’',
} as const

/**
 * Where a quote OPENS rather than closes: at the start, after space, or after
 * something that itself opens.
 *
 * **Decided by the character to the left and nothing else**, which is what makes
 * it predictable while you type. The dash cases matter in prose — *she said —
 * "later"* — and the bracket cases matter in everything.
 */
const OPENS_AFTER = /[\s([{<‘“—–…/]/

/**
 * Which character a typed quote becomes, given the one before it.
 *
 * Pure, and separately tested: the rule is the whole of this feature, and it is
 * the part that has to be right in cases nobody will think to try by hand.
 *
 * **An apostrophe is the closing single**, which is the same character, and that
 * is not a coincidence — *it's* and *don't* close an elision. The known wrong
 * answer is a leading elision: `'90s` and `'tis` want `’` and get `‘`, because
 * the rule cannot see the future and the text to the right does not exist yet.
 * Left wrong on purpose rather than special-cased from a word list.
 */
export function curlFor(quote: string, before: string): string | null {
  const opening = before === '' || OPENS_AFTER.test(before)
  if (quote === '"') return opening ? CURLY.openDouble : CURLY.closeDouble
  if (quote === "'") return opening ? CURLY.openSingle : CURLY.closeSingle
  return null
}

/**
 * Whether a position is inside code, asked of the parser.
 *
 * **The node names are lezer-markdown's**, and the set is deliberately wide:
 * `CodeText` and `CodeMark` are the inside and the fence of a block, `InlineCode`
 * is a span, and `CodeBlock` is the indented form nobody writes on purpose and
 * every pasted diff produces.
 */
const CODE_NODES = new Set([
  'InlineCode', 'CodeText', 'CodeMark', 'CodeBlock', 'FencedCode', 'CodeInfo',
])

export function inCode(state: EditorState, at: number): boolean {
  // **Biased left**, because the caret at the very end of a code span belongs to
  // the span you are typing in rather than to the prose after it.
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, -1)
  for (; node !== null; node = node.parent) if (CODE_NODES.has(node.name)) return true
  return false
}

/**
 * Curl quotes as they are typed.
 *
 * **An input handler rather than a transaction filter**, because this must see
 * *typing* and nothing else: a filter would also catch a paste, an undo and every
 * programmatic edit the app makes, and curling any of those is exactly the
 * retroactive rewriting this is built not to do.
 */
export function smartQuotes(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '"' && text !== "'") return false
    // **One caret only.** With several, the character before each is a different
    // character, and answering them all from one decision would be wrong for all
    // but one — so the straight quote goes in and nothing is claimed.
    if (view.state.selection.ranges.length > 1) return false
    if (inCode(view.state, from)) return false

    const before = from > 0 ? view.state.doc.sliceString(from - 1, from) : ''
    const curly = curlFor(text, before)
    if (curly === null) return false

    view.dispatch({
      changes: { from, to, insert: curly },
      selection: { anchor: from + curly.length },
      // **Typing, as far as everything else is concerned** — the undo history
      // groups it with the keystrokes around it, and the day clock counts it as
      // writing (D62), because that is what it is.
      userEvent: 'input.type',
      scrollIntoView: true,
    })
    return true
  })
}
