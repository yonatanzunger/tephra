import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dayFile, dayDir, parseDayFile, noteFile, sectionFile, attachmentFile, isLocal, slug,
  relativePath, resolveInsideNotebook,
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

// ── following a link (M2.3) ──────────────────────────────────
//
// A document's text is data: it can be typed, pasted, or arrive with an
// imported file. These are the cases where "just open what the link says" would
// hand the whole filesystem to a line of prose.

test('a link into the notebook resolves', () => {
  assert.equal(
    resolveInsideNotebook('/n', '../../../notes/titration-curves.md'),
    'notes/titration-curves.md',
  )
  assert.equal(resolveInsideNotebook('/n', '../../../attachments/2026/03/x.png'), 'attachments/2026/03/x.png')
})

test('a link that climbs out of the notebook does not resolve', () => {
  for (const target of [
    '../../../../etc/passwd',
    '../../../../../../../../etc/passwd',
    '../../../notes/../../../../etc/passwd',
    '/etc/passwd',
    '../../..', // the notebook root itself is not a file to open
  ]) {
    assert.equal(resolveInsideNotebook('/n', target), null, `${target} should not resolve`)
  }
})

test('a URI scheme is not a file path', () => {
  for (const target of [
    'https://example.com/',
    'file:///etc/passwd',
    'tephra:mark/mortgage%20contact', // a real format, handled elsewhere
    'javascript:alert(1)',
  ]) {
    assert.equal(resolveInsideNotebook('/n', target), null, `${target} should not resolve`)
  }
})

test('a link resolves the same from any day, since every day is at one depth', () => {
  // The claim the resolver relies on: `stream/YYYY/MM/` is always three deep.
  const seen = new Set<string | null>()
  for (const date of ['2019-01-01', '2026-03-14', '2031-12-31']) {
    seen.add(resolveInsideNotebook('/n', '../../../notes/x.md'))
    assert.equal(dayFile(date as DateKey).split('/').length, 4, `${date} is not three deep`)
  }
  assert.equal(seen.size, 1)
})


test('a relative link between notebook files', () => {
  assert.equal(
    relativePath(dayFile('2026-03-14' as DateKey), noteFile('Titration curves')),
    '../../../notes/titration-curves.md',
  )
  assert.equal(relativePath(noteFile('a'), noteFile('b')), 'b.md')
})
