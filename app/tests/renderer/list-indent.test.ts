// Tab in a list, and only in a list.
//
// The claim being tested is as much about what the key does NOT do: an editor
// that swallows Tab everywhere is a keyboard trap, so the commands must decline
// outside a list and let the browser move focus.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { EditorState, EditorSelection, type Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { indentListItem, outdentListItem } from '../../src/renderer/src/editor/kinds/markdown/lists.ts'

/** A state with the caret at `|`, or a selection between two of them. */
function at(doc: string): EditorState {
  const marks: number[] = []
  let text = doc
  for (;;) {
    const i = text.indexOf('|')
    if (i < 0) break
    marks.push(i)
    text = text.slice(0, i) + text.slice(i + 1)
  }
  return EditorState.create({
    doc: text,
    extensions: [markdown()],
    selection: EditorSelection.single(marks[0] ?? 0, marks[1] ?? marks[0] ?? 0),
  })
}

/** Run a command and return the resulting text, or null if it declined. */
function run(state: EditorState, command: typeof indentListItem): string | null {
  let next: Transaction | null = null
  const handled = command({ state, dispatch: tr => (next = tr) })
  if (!handled) return null
  return (next as unknown as Transaction).state.doc.toString()
}

test('Tab indents the item the caret is in', () => {
  assert.equal(run(at('- one\n- t|wo\n'), indentListItem), '- one\n  - two\n')
})

test('an ordered list indents by ITS marker, not by two', () => {
  // `1. ` is three columns, and a nested item indented two is a paragraph of
  // its parent rather than a list — the failure is invisible until it renders.
  assert.equal(run(at('1. one\n1. t|wo\n'), indentListItem), '1. one\n   1. two\n')
})

test('a selection across a list moves all of it, the way Google Docs does', () => {
  assert.equal(
    run(at('- |one\n- two\n- th|ree\n'), indentListItem),
    '  - one\n  - two\n  - three\n',
  )
})

test('children come with their parent', () => {
  const before = '- one\n- t|wo\n  - nested\n  - also nested\n- three\n'
  assert.equal(
    run(at(before), indentListItem),
    '- one\n  - two\n    - nested\n    - also nested\n- three\n',
  )
})

test('a wrapped continuation line moves with its item', () => {
  assert.equal(
    run(at('- one\n- t|wo\n  spilling over\n'), indentListItem),
    '- one\n  - two\n    spilling over\n',
  )
})

test('Shift-Tab takes one level off, and never goes past the margin', () => {
  assert.equal(run(at('- one\n  - t|wo\n'), outdentListItem), '- one\n- two\n')
  assert.equal(run(at('- o|ne\n'), outdentListItem), null, 'nothing to give back')
})

test('THE POINT: outside a list, Tab is not ours', () => {
  // Declining is what hands the key back to the browser, and with it the way
  // out of the editor for someone navigating by keyboard.
  assert.equal(run(at('An ordinary paragraph.|\n'), indentListItem), null)
  assert.equal(run(at('# A hea|ding\n'), indentListItem), null)
  assert.equal(run(at('|'), indentListItem), null, 'and an empty document')
})

test('a blank line inside a selection is left alone', () => {
  assert.equal(
    run(at('- |one\n\n- two|\n'), indentListItem),
    '  - one\n\n  - two\n',
  )
})
