// What leaves the app when a range of days is printed or exported.
//
// Two claims, and both were mistakes made once already elsewhere: what comes
// out is PROSE, never the document's text with its markers in it (D44), and a
// day nobody wrote in is not a day.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { StreamDocument } from '../../src/main/x/documents/kinds/stream.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import type { DateKey } from '../../src/shared/document-api.ts'
import { stripHandles } from '../../src/shared/prose.ts'

const d = (s: string): DateKey => s as DateKey

async function notebook(t: TestContext, days: readonly [string, string][]) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-range-'))
  for (const [date, body] of days) {
    await mkdir(join(root, 'notebook.stream', date.slice(0, 4), date.slice(5, 7)), { recursive: true })
    await writeFile(join(root, dayFile(d(date))), `---\ntephra: 1\ndate: ${date}\n---\n${body}`)
  }
  const nb = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => nb.close())
  return new StreamDocument(nb)
}

test('the days come back oldest first, whatever order they were found in', async t => {
  const doc = await notebook(t, [
    ['2026-03-03', 'Third.\n'],
    ['2026-03-01', 'First.\n'],
    ['2026-03-02', 'Second.\n'],
  ])
  const days = await doc.proseIn(d('2026-03-01'), d('2026-03-03'))
  assert.deepEqual(days.map(day => day.date), ['2026-03-01', '2026-03-02', '2026-03-03'])
})

test('the range is inclusive at both ends and excludes what is outside it', async t => {
  const doc = await notebook(t, [
    ['2026-03-01', 'Before.\n'],
    ['2026-03-02', 'Inside.\n'],
    ['2026-03-03', 'Also inside.\n'],
    ['2026-03-04', 'After.\n'],
  ])
  const days = await doc.proseIn(d('2026-03-02'), d('2026-03-03'))
  assert.deepEqual(days.map(day => day.date), ['2026-03-02', '2026-03-03'])
})

test('a range handed over backwards is read the way it was meant', async t => {
  const doc = await notebook(t, [['2026-03-01', 'One.\n'], ['2026-03-02', 'Two.\n']])
  const days = await doc.proseIn(d('2026-03-02'), d('2026-03-01'))
  assert.equal(days.length, 2, 'not an empty range')
})

test('THE POINT: markers do not come out, in either form', async t => {
  // Printing what the file holds would put `<!--tephra:tag-start …-->` on paper,
  // and printing the buffer's prose would put a U+FFFC box there instead — a
  // handle stands in for a mark on screen and has nothing to stand in for here.
  const doc = await notebook(t, [
    [
      '2026-03-01',
      'A <!--tephra:tag-start Subject-->tagged phrase<!--tephra:tag-end Subject--> here.\n' +
        '<!--tephra:mark somewhere-->And a bookmark.\n',
    ],
  ])
  const [day] = await doc.proseIn(d('2026-03-01'), d('2026-03-01'))
  // The TEXT still carries handles — they are what a mark is anchored to, and
  // dropping them is the printer's business now, not the document's (D50).
  assert.doesNotMatch(day?.prose.text ?? '', /tephra:/)
  assert.equal(stripHandles(day?.prose.text ?? ''), 'A tagged phrase here.\nAnd a bookmark.\n')

  // And the annotations came with it, which is the point of the shape.
  const kinds = (day?.prose.annotations ?? []).map(a => a.kind).sort()
  assert.deepEqual(kinds, ['anchor', 'date', 'tag'])
})

test('a day nobody wrote in is left out, rather than printed empty', async t => {
  // The stream files a day whenever the app is opened (D8), so a fortnight of
  // ordinary use is full of these. Printing them is a page of dates.
  const doc = await notebook(t, [
    ['2026-03-01', 'Something.\n'],
    ['2026-03-02', '\n\n'],
    ['2026-03-03', 'Something else.\n'],
  ])
  const days = await doc.proseIn(d('2026-03-01'), d('2026-03-03'))
  assert.deepEqual(days.map(day => day.date), ['2026-03-01', '2026-03-03'])
})

test('an unwritten stretch is an empty answer, not a failure', async t => {
  const doc = await notebook(t, [['2026-03-01', 'Only this.\n']])
  assert.deepEqual(await doc.proseIn(d('2025-01-01'), d('2025-12-31')), [])
})
