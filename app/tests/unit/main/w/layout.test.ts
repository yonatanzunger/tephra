import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STREAM_DIR, directoryKind, documentRoot, kindOf,
  dayFile, dayDir, parseDayFile, noteFile, sectionFile, attachmentFile, isLocal, slug,
  relativePath, relativeTo, resolveInsideNotebook,
  type RelPath,
} from '../../../../src/main/w/layout.ts'
import { STREAM_ID, type DateKey } from '../../../../src/shared/document-api.ts'

const d = (s: string): DateKey => s as DateKey

// ── directory documents (D59) ──────────────────────────────────────────────

test('a directory declares its kind the way a filename does', () => {
  assert.equal(directoryKind('notebook.stream'), 'stream')
  assert.equal(directoryKind('main.todo'), 'todo')
  assert.equal(directoryKind('work-tasks.todo'), 'todo')
  // Only the kinds that ARE directories. A fileset and a note are single files,
  // so a directory claiming to be one is claiming nothing.
  assert.equal(directoryKind('things.fileset'), null)
  assert.equal(directoryKind('notes'), null)
  assert.equal(directoryKind('.todo'), null, 'a bare extension is not a name')
  assert.equal(directoryKind('2026-03-14.md'), null)
})

test('a file inside a directory document belongs to it, however deep', () => {
  assert.equal(documentRoot('notebook.stream/2026/03/2026-03-14.md'), 'notebook.stream')
  assert.equal(documentRoot('main.todo/2026/09/2026-09-01.md'), 'main.todo')
  assert.equal(documentRoot('work/tasks.todo/2026/09/2026-09-01.md'), 'work/tasks.todo')
  // A root answers with itself, which is what lets one call resolve both a
  // directory document's id and the files inside it.
  assert.equal(documentRoot('notebook.stream'), 'notebook.stream')
  assert.equal(documentRoot('notes/offer.md'), null)
  assert.equal(documentRoot('sections/house.fileset.md'), null)
})

test('kindOf answers for a directory document and for everything in it', () => {
  assert.equal(kindOf('notebook.stream'), 'stream')
  assert.equal(kindOf('notebook.stream/2026/03/2026-03-14.md'), 'stream')
  assert.equal(kindOf('main.todo'), 'todo')
  assert.equal(kindOf('main.todo/2026/09/2026-09-01.md'), 'todo')
  assert.equal(kindOf('notes/offer.md'), 'markdown')
  assert.equal(kindOf('sections/house.fileset.md'), 'fileset')
  assert.equal(kindOf('attachments/2026/03/x.png'), null)
})

test('THE DRIFT GUARD: the stream is spelled the same in both processes', () => {
  // `STREAM_ID` is in `shared/` because the renderer names it too, and
  // `STREAM_DIR` is in `w/layout.ts` because main composes paths from it. They
  // are the same string and nothing but this test says so.
  assert.equal(STREAM_ID as string, STREAM_DIR)
  assert.equal(kindOf(STREAM_ID as string), 'stream')
})

test('day files nest by year and month', () => {
  assert.equal(dayFile(d('2026-03-14')), 'notebook.stream/2026/03/2026-03-14.md')
  assert.equal(dayDir(d('2026-03-14')), 'notebook.stream/2026/03')
})

test('part 1 has no suffix, later parts do', () => {
  // The common case must read as an ordinary dated file: a human browsing the
  // directory is a supported way to use this.
  assert.equal(dayFile(d('2026-03-14'), 1), 'notebook.stream/2026/03/2026-03-14.md')
  assert.equal(dayFile(d('2026-03-14'), 2), 'notebook.stream/2026/03/2026-03-14.2.md')
})

test('a day file names the document it belongs to', () => {
  // Shared grammar, different roots: a todo list's days are laid out exactly
  // like the stream's, so a caller meaning "a day of the STREAM" has to ask.
  assert.deepEqual(parseDayFile('main.todo/2026/09/2026-09-01.md'), {
    date: '2026-09-01', part: 1, root: 'main.todo',
  })
  assert.equal(parseDayFile('notes/2026/09/2026-09-01.md'), null, 'notes is not a document root')
})

test('day files round-trip through parsing', () => {
  for (const [date, part] of [['2026-03-14', 1], ['2026-03-14', 2], ['2024-02-29', 7]] as const) {
    const parsed = parseDayFile(dayFile(d(date), part))
    assert.deepEqual(parsed, { date, part, root: STREAM_DIR })
  }
})

test('parseDayFile rejects things that merely look like day files', () => {
  assert.equal(parseDayFile('notes/2026-03-14.md'), null, 'a note named like a date is not a day')
  assert.equal(parseDayFile('notebook.stream/2026/03/2026-03-14.txt'), null)
  assert.equal(parseDayFile('notebook.stream/2026/03/hello.md'), null)
  assert.equal(parseDayFile('notebook.stream/2026/03/2026-02-30.md'), null, 'that day does not exist')
  assert.equal(parseDayFile('notebook.stream/2026/03/2026-03-14.1.md'), null, 'not how part 1 is spelled')
  assert.equal(parseDayFile('notebook.stream/2026/03/2026-03-14.0.md'), null)
})

test('a misfiled day file is rejected rather than guessed at', () => {
  // Name and nesting disagree. Either could be the truth, and picking one would
  // be a data loss dressed as a convenience.
  assert.equal(parseDayFile('notebook.stream/2026/04/2026-03-14.md'), null)
  assert.equal(parseDayFile('notebook.stream/2025/03/2026-03-14.md'), null)
})

test('the local directory is recognised, and only it', () => {
  assert.ok(isLocal('.tephra'))
  assert.ok(isLocal('.tephra/wal/x.jsonl'))
  assert.ok(!isLocal('notes/.tephra-ish.md'))
  assert.ok(!isLocal('notebook.stream/2026/03/2026-03-14.md'))
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
  // The claim the resolver relies on: `notebook.stream/YYYY/MM/` is always three deep.
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

// ── a link is relative to the document it is written in (D53, D54) ─────────

test('a link in a section resolves from the section, not from the stream', () => {
  // THE BUG: `../notes/offer.md` in `sections/house.fileset.md` was resolved
  // from a day file's depth, landed outside the notebook, failed containment,
  // and the row reported "not found" — a correct link, a real file, and a
  // sidebar entry that could not be clicked.
  assert.equal(
    resolveInsideNotebook('/n', '../notes/offer.md', 'sections/house.fileset.md' as RelPath),
    'notes/offer.md',
  )
  assert.equal(
    resolveInsideNotebook('/n', 'offer.md', 'notes/index.md' as RelPath),
    'notes/offer.md',
    'a sibling, which is the commonest link of all',
  )
})

test('and containment still holds, whichever document is asking', () => {
  for (const target of ['../../../../etc/passwd', '/etc/passwd', '../..']) {
    assert.equal(
      resolveInsideNotebook('/n', target, 'sections/house.fileset.md' as RelPath),
      null,
      `${target} should not resolve`,
    )
  }
})

test('relativeTo is the same rule without the disk', () => {
  // What the panel uses for every entry it draws: a stat per link would be a
  // filesystem call per row per repaint.
  assert.equal(relativeTo('sections/house.fileset.md' as RelPath, '../notes/offer.md'), 'notes/offer.md')
  assert.equal(relativeTo('sections/house.fileset.md' as RelPath, 'other.fileset.md'), 'sections/other.fileset.md')
  assert.equal(relativeTo('a.md' as RelPath, 'https://example.com'), null, 'a URL is not a path')
  assert.equal(relativeTo('a.md' as RelPath, '..'), null, 'and the root is not a document')
})
