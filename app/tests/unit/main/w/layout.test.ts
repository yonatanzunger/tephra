import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dayFile, dayDir, parseDayFile, noteFile, sectionFile, attachmentFile, isLocal, slug,
} from '../../../../src/main/w/layout.ts'
import type { DateKey } from '../../../../src/shared/document-api.ts'

const d = (s: string): DateKey => s as DateKey

test('day files nest by year and month', () => {
  assert.equal(dayFile(d('2026-03-14')), 'stream/2026/03/2026-03-14.md')
  assert.equal(dayDir(d('2026-03-14')), 'stream/2026/03')
})

test('part 1 has no suffix, later parts do', () => {
  // The common case must read as an ordinary dated file: a human browsing the
  // directory is a supported way to use this.
  assert.equal(dayFile(d('2026-03-14'), 1), 'stream/2026/03/2026-03-14.md')
  assert.equal(dayFile(d('2026-03-14'), 2), 'stream/2026/03/2026-03-14.2.md')
})

test('day files round-trip through parsing', () => {
  for (const [date, part] of [['2026-03-14', 1], ['2026-03-14', 2], ['2024-02-29', 7]] as const) {
    const parsed = parseDayFile(dayFile(d(date), part))
    assert.deepEqual(parsed, { date, part })
  }
})

test('parseDayFile rejects things that merely look like day files', () => {
  assert.equal(parseDayFile('notes/2026-03-14.md'), null, 'a note named like a date is not a day')
  assert.equal(parseDayFile('stream/2026/03/2026-03-14.txt'), null)
  assert.equal(parseDayFile('stream/2026/03/hello.md'), null)
  assert.equal(parseDayFile('stream/2026/03/2026-02-30.md'), null, 'that day does not exist')
  assert.equal(parseDayFile('stream/2026/03/2026-03-14.1.md'), null, 'not how part 1 is spelled')
  assert.equal(parseDayFile('stream/2026/03/2026-03-14.0.md'), null)
})

test('a misfiled day file is rejected rather than guessed at', () => {
  // Name and nesting disagree. Either could be the truth, and picking one would
  // be a data loss dressed as a convenience.
  assert.equal(parseDayFile('stream/2026/04/2026-03-14.md'), null)
  assert.equal(parseDayFile('stream/2025/03/2026-03-14.md'), null)
})

test('the local directory is recognised, and only it', () => {
  assert.ok(isLocal('.tephra'))
  assert.ok(isLocal('.tephra/wal/x.jsonl'))
  assert.ok(!isLocal('notes/.tephra-ish.md'))
  assert.ok(!isLocal('stream/2026/03/2026-03-14.md'))
})

test('slugs are safe, readable and never empty', () => {
  assert.equal(slug('House Deal'), 'house-deal')
  assert.equal(slug('  Titration / curves!  '), 'titration-curves')
  assert.equal(slug('café'), 'cafe')
  assert.equal(slug('???'), 'untitled', 'a name that slugs to nothing still needs a file')
  assert.ok(slug('x'.repeat(200)).length <= 80)
})

test('notes, sections and attachments land where the format says', () => {
  assert.equal(noteFile('Titration curves'), 'notes/titration-curves.md')
  assert.equal(sectionFile('House deal'), 'sections/house-deal.fileset.md')
  assert.equal(
    attachmentFile(d('2026-03-14'), 'plot', 'a1b2c3d4e5', '.png'),
    'attachments/2026/03/2026-03-14-plot-a1b2c3.png',
  )
})
