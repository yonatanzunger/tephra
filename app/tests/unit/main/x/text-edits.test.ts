import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEdits, invertEdits, mapOffset, checkBatch, minimalReplacement, composeEdits,
  OverlappingEditsError, type TextEdit,
} from '../../../../src/main/x/text-edits.ts'

const e = (from: number, to: number, insert: string): TextEdit => ({ from, to, insert })

test('applies a batch against pre-edit coordinates', () => {
  // Every span is relative to the ORIGINAL text, not to the result of the
  // previous edit. That is the whole point of a batch.
  const text = 'one two three'
  assert.equal(applyEdits(text, [e(0, 3, 'ONE'), e(8, 13, 'THREE')]), 'ONE two THREE')
})

test('insert and delete are the degenerate cases', () => {
  assert.equal(applyEdits('abcd', [e(2, 2, 'XY')]), 'abXYcd')
  assert.equal(applyEdits('abcd', [e(1, 3, '')]), 'ad')
  assert.equal(applyEdits('abcd', []), 'abcd')
})

test('an overlapping or unsorted batch throws rather than guessing', () => {
  assert.throws(() => checkBatch('abcdef', [e(0, 3, 'x'), e(2, 4, 'y')]), OverlappingEditsError)
  assert.throws(() => checkBatch('abcdef', [e(4, 5, 'x'), e(0, 1, 'y')]), OverlappingEditsError)
  assert.throws(() => checkBatch('abc', [e(0, 99, 'x')]), OverlappingEditsError)
  assert.throws(() => checkBatch('abc', [e(2, 1, 'x')]), OverlappingEditsError)
})

test('inverting a batch restores the original exactly', () => {
  for (const [text, edits] of [
    ['one two three', [e(0, 3, 'ONE'), e(8, 13, 'THREE')]],
    ['abcd', [e(2, 2, 'inserted')]],
    ['abcd', [e(0, 4, '')]],
    ['a😀b', [e(1, 3, 'X')]],
    ['line\nline\n', [e(0, 0, 'top\n'), e(5, 9, 'LINE')]],
  ] as const) {
    const list: readonly TextEdit[] = edits
    const after = applyEdits(text, list)
    const back = applyEdits(after, invertEdits(text, list))
    assert.equal(back, text, `round trip failed for ${JSON.stringify(text)}`)
  }
})

test('the inverse is expressed against the post-edit text', () => {
  const text = 'hello world'
  const edits = [e(0, 5, 'goodbye')]
  const after = applyEdits(text, edits)
  const inverse = invertEdits(text, edits)
  assert.deepEqual(inverse, [{ from: 0, to: 7, insert: 'hello' }])
  assert.equal(applyEdits(after, inverse), text)
})

test('offsets before an edit are untouched; after, they slide', () => {
  const edits = [e(5, 5, 'XXX')]
  assert.equal(mapOffset(0, edits), 0)
  assert.equal(mapOffset(9, edits), 12)
})

test('a position at an insertion point follows the association', () => {
  // A cursor wants 'after' — you type, the cursor follows. A range start wants
  // 'before', so the range grows rather than being pushed aside.
  const edits = [e(5, 5, 'XXX')]
  assert.equal(mapOffset(5, edits, 'after'), 8)
  assert.equal(mapOffset(5, edits, 'before'), 5)
})

test('a position inside deleted text maps to null, not to an edge', () => {
  // Saying "it moved to the boundary" would invent a location for text that no
  // longer exists — which is exactly how an operation gets applied to the wrong
  // range after the document moved underneath it.
  const edits = [e(2, 8, '')]
  assert.equal(mapOffset(5, edits), null)
  assert.equal(mapOffset(2, edits), 2, 'the start of the deletion survives')
  assert.equal(mapOffset(8, edits), 2)
})

test('mapping through several edits accumulates the drift', () => {
  const edits = [e(0, 1, 'XX'), e(4, 4, 'Y'), e(7, 9, '')]
  assert.equal(mapOffset(3, edits), 4)
  assert.equal(mapOffset(6, edits), 8)
  assert.equal(mapOffset(10, edits), 10)
})

test('minimalReplacement trims common prefix and suffix', () => {
  assert.deepEqual(minimalReplacement('the quick fox', 'the slow fox'), { from: 4, to: 9, insert: 'slow' })
  assert.equal(minimalReplacement('same', 'same'), null)
  assert.deepEqual(minimalReplacement('', 'new'), { from: 0, to: 0, insert: 'new' })
  assert.deepEqual(minimalReplacement('gone', ''), { from: 0, to: 4, insert: '' })
})

test('composing two batches yields one that produces the same text', () => {
  const text = 'alpha beta gamma'
  const first = [e(0, 5, 'ALPHA')]
  const middle = applyEdits(text, first)
  const second = [e(11, 16, 'GAMMA')]
  const composed = composeEdits(text, first, second)
  assert.equal(applyEdits(text, composed), applyEdits(middle, second))
})

test('two insertions at the same point both count for a following cursor', () => {
  const edits = [e(3, 3, 'AA'), e(3, 3, 'BB')]
  assert.equal(mapOffset(3, edits, 'after'), 7)
  assert.equal(mapOffset(3, edits, 'before'), 3)
})
