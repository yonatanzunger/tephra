// The session, as it survives a quit (MC6).
//
// Soft state, and lenient by construction: a file this cannot read means "start
// fresh", never a crash and never a lost notebook. What it must NOT do is lose
// the reader's place to a schema change — which is the one thing a rewrite of
// this shape could quietly cost.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultUiState, parseUiState } from '../../../src/shared/ui-state.ts'

test('a session is a set of windows, in the order they were opened', () => {
  const state = parseUiState(
    JSON.stringify({
      version: 1,
      windows: [
        { location: { kind: 'today' }, cursor: null },
        { location: { kind: 'document', id: 'notes/offer.md' }, cursor: { segment: 'content', offset: 4 } },
      ],
      theme: 'sage',
    }),
  )
  assert.equal(state.windows.length, 2)
  assert.deepEqual(state.windows[1]?.location, { kind: 'document', id: 'notes/offer.md' })
})

test('THE MIGRATION: a file from before windows were a set still opens its window', () => {
  // Every notebook in existence has one of these. Reading it as "no session"
  // would drop the reader where they were for a shape change they never made.
  const state = parseUiState(
    JSON.stringify({
      version: 1,
      location: { kind: 'date', date: '2026-03-04' },
      cursor: { segment: '2026-03-04', offset: 12 },
      vim: false,
      theme: 'sage',
    }),
  )
  assert.equal(state.windows.length, 1)
  assert.deepEqual(state.windows[0]?.location, { kind: 'date', date: '2026-03-04' })
  assert.equal(state.windows[0]?.cursor?.offset, 12)
})

test('one unreadable entry loses one window, not the session', () => {
  const state = parseUiState(
    JSON.stringify({
      version: 1,
      windows: [{ location: { kind: 'today' }, cursor: null }, 'nonsense', { nothing: true }],
      vim: false,
      theme: 'sage',
    }),
  )
  assert.equal(state.windows.length, 1, 'the good one survived')
})

test('an empty set is not a session, and reads as a fresh one', () => {
  // Written on the way out only when there is something to write; a file
  // saying "no windows" is a file that lost the argument, not an instruction
  // to open nothing.
  const state = parseUiState(JSON.stringify({ version: 1, windows: [], vim: false, theme: 'sage' }))
  assert.deepEqual(state.windows, defaultUiState.windows)
})

test('nonsense is a fresh session rather than a crash', () => {
  for (const text of ['', '{', 'null', '[]', JSON.stringify({ version: 2, windows: [] })]) {
    assert.deepEqual(parseUiState(text), defaultUiState, JSON.stringify(text))
  }
  assert.deepEqual(parseUiState(null), defaultUiState, 'and so is no file at all')
})
