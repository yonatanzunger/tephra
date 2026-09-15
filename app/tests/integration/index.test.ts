// The corpus index (D52), which is a cache and must behave like one.
//
// The interesting claims are not "it can count tags". They are the three rules
// that make a cache safe to have at all: a loaded day answers for itself, a
// file that changed is rescanned, and deleting the whole thing costs nothing
// but time.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { StreamDocument } from '../../src/main/x/documents/kinds/stream.ts'
import { CorpusIndex } from '../../src/main/x/documents/corpus-index.ts'
import { dayLabel } from '../../src/shared/dates.ts'
import type { DateKey } from '../../src/shared/document-api.ts'
import { dayFile, indexFile, type RelPath } from '../../src/main/w/layout.ts'
import { rt } from '../support/text.ts'
import { RESOLVED_DAYS } from '../../src/shared/kinds/todo.ts'

const d = (s: string): DateKey => s as DateKey
const TAG = (s: string, text: string): string =>
  `<!--tephra:tag-start ${s}-->${text}<!--tephra:tag-end ${s}-->`

async function corpus(t: TestContext, days: readonly [string, string][], notes: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-idx-'))
  for (const [date, body] of days) {
    await mkdir(join(root, 'notebook.stream', date.slice(0, 4), date.slice(5, 7)), { recursive: true })
    await writeFile(join(root, dayFile(d(date))), `---\ntephra: 1\ndate: ${date}\n---\n${body}`)
  }
  for (const [name, body] of Object.entries(notes)) {
    await mkdir(join(root, 'notes'), { recursive: true })
    await writeFile(join(root, 'notes', name), `---\ntephra: 1\nkind: note\n---\n${body}`)
  }
  const notebook = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => notebook.close())
  const doc = new StreamDocument(notebook)
  return { root, notebook, doc, index: new CorpusIndex(notebook, async () => doc) }
}

test('subjects come back with their counts and where they first appear', async t => {
  const { index } = await corpus(t, [
    ['2026-03-01', `A ${TAG('House Deal', 'first mention')} here.\n`],
    ['2026-03-02', `And ${TAG('House Deal', 'another')} plus ${TAG('Physics', 'one more')}.\n`],
  ])
  const subjects = await index.subjects()
  assert.deepEqual(subjects.map(s => `${s.subject}:${s.count}`), ['House Deal:2', 'Physics:1'])
  assert.equal(subjects[0]?.first.date, '2026-03-01')
})

test('the timeline nests headings under their day, by the ranges they already have', async t => {
  const { index } = await corpus(t, [
    ['2026-03-01', '# Chapter\n\na\n\n## Section\n\nb\n\n# Next\n\nc\n'],
  ])
  const [day] = await index.timeline()
  assert.equal(day?.date, '2026-03-01')
  assert.deepEqual(day?.headings.map(h => h.title), ['Chapter', 'Next'])
  assert.deepEqual(day?.headings[0]?.children.map(h => h.title), ['Section'])
})

test('notes are in the corpus too, so a bookmark in one is findable', async t => {
  const { index } = await corpus(
    t,
    [['2026-03-01', 'A day.\n']],
    { 'the-note.md': 'A note with <!--tephra:mark somewhere-->a mark in it.\n' },
  )
  assert.deepEqual(
    (await index.bookmarks()).map(b => `${b.name} in ${b.at.file}`),
    ['somewhere in notes/the-note.md'],
  )
})

test('THE RULE: a loaded day answers for itself, edits and all', async t => {
  // A subject applied thirty seconds ago and not yet flushed must be in the
  // list of subjects. Otherwise the sidebar lags the file writer, which reads
  // as a bug in tagging rather than as a stale cache.
  const { doc, index } = await corpus(t, [['2026-03-01', 'Nothing tagged yet.\n']])
  assert.deepEqual(await index.subjects(), [])

  const at = doc.positionAt(d('2026-03-01'), 0)
  await doc.replace([{ span: { begin: at, end: at }, payload: rt(TAG('Fresh', 'just now')) }], 'user')

  assert.deepEqual((await index.subjects()).map(s => s.subject), ['Fresh'], 'from memory, not from the file')
})

test('a file that changed behind the cache is rescanned', async t => {
  const { root, index } = await corpus(t, [['2026-03-01', `${TAG('Before', 'x')}\n`]])
  assert.deepEqual((await index.subjects()).map(s => s.subject), ['Before'])

  // A hand-edit, or another machine's sync: the stamp moves, and the entry
  // stops being trusted.
  await writeFile(
    join(root, dayFile(d('2026-03-01'))),
    `---\ntephra: 1\ndate: 2026-03-01\n---\n${TAG('After', 'a longer body now')}\n`,
  )
  assert.deepEqual((await index.subjects()).map(s => s.subject), ['After'])
})

test('THE POINT: deleting the whole index costs time and nothing else', async t => {
  const { root, index, notebook } = await corpus(t, [['2026-03-01', `${TAG('Kept', 'x')}\n`]])
  await index.rebuild()
  assert.equal(await notebook.has(indexFile('notebook.stream/2026/03' as RelPath)), true)

  await rm(join(root, '.tephra', 'index'), { recursive: true, force: true })
  await index.clear()
  assert.deepEqual((await index.subjects()).map(s => s.subject), ['Kept'], 'still answers')
})

test('a rebuild writes the cache, and verify finds a cache that has drifted', async t => {
  const { root, index } = await corpus(t, [['2026-03-01', `${TAG('Real', 'x')}\n`]])
  await index.rebuild()
  assert.deepEqual(await index.verify(), [], 'freshly built, nothing disagrees')

  // Tamper with the cache directly, the way a corrupt or truncated file would.
  await writeFile(
    join(root, indexFile('notebook.stream/2026/03' as RelPath)),
    JSON.stringify({ '2026-03-01.md': { stamp: { size: 1, mtime: 2 }, payload: [] } }),
  )
  assert.deepEqual(await index.verify(), ['notebook.stream/2026/03/2026-03-01.md'])
})

test('a day whose file is gone leaves nothing behind', async t => {
  const { root, index } = await corpus(t, [
    ['2026-03-01', `${TAG('Stays', 'x')}\n`],
    ['2026-03-02', `${TAG('Goes', 'y')}\n`],
  ])
  assert.equal((await index.subjects()).length, 2)
  await rm(join(root, dayFile(d('2026-03-02'))))
  assert.deepEqual((await index.subjects()).map(s => s.subject), ['Stays'])
})

test('occurrences are what a row traverses, in corpus order', async t => {
  const { index } = await corpus(t, [
    ['2026-03-01', `${TAG('Subject', 'one')}\n`],
    ['2026-03-02', `${TAG('Subject', 'two')} and ${TAG('Subject', 'three')}\n`],
  ])
  const found = await index.occurrences({ kind: 'tag', subject: 'Subject' })
  assert.equal(found.length, 3)
  assert.deepEqual(found.map(f => f.date), ['2026-03-01', '2026-03-02', '2026-03-02'])
})

test('THE EQUIVALENCE: the index says what the document would have said', async t => {
  // The index is a cache, so the only defensible test of it is that it changes
  // nothing except how long the answer takes — and WHO you ask. The document
  // answers about itself, the index about the corpus, and over a corpus that is
  // only the stream the two answers must agree span for span.
  const { doc, index } = await corpus(t, [
    ['2026-03-01', `# Chapter\n\nA ${TAG('Subject', 'phrase')} and <!--tephra:mark spot-->a mark.\n`],
    ['2026-03-02', `## Section\n\nMore ${TAG('Subject', 'text')} here.\n`],
  ])

  const asked = await doc.spans()
  const cached = (await index.spansOf()).filter(s => s.at.date !== null)

  assert.deepEqual(
    cached.map(s => `${s.at.date}:${s.span.kind}:${s.span.from}`),
    asked.map(s => `${s.span.begin.segment}:${s.kind}:${s.span.begin.offset as number}`),
  )
  assert.ok(asked.length >= 6, `six spans at least, got ${asked.length}`)
})

test('and the index does not need the corpus to be the stream', async t => {
  const { doc, index } = await corpus(
    t,
    [['2026-03-01', `${TAG('Shared', 'a')}\n`]],
    { 'note.md': `${TAG('Shared', 'b')}\n` },
  )

  // The document speaks for the stream; the index speaks for the corpus. A
  // note's spans have no DocumentPosition, so they are the sidebar's business.
  assert.equal((await doc.spans('tag')).length, 1)
  assert.equal((await index.occurrences({ kind: 'tag', subject: 'Shared' })).length, 2)
})

// ── the Timeline is days, and only days ────────────────
//
// **Reported from a screenshot**, after importing a few hundred markdown
// documents into a real notebook: the Timeline filled with their headings,
// formatted as dates, reading `NaN driven, market` and `**Introduction**`.
//
// Nothing was wrong with the index. The query was: this method was called
// `outline`, a corpus outline plausibly includes a note's headings, and so it
// pushed them in as top-level entries for any file with no date span. With a
// handful of day files that never showed. The sidebar then read every entry's
// `title` as a `DateKey` — through a cast, which is what let a heading reach a
// date formatter at all.

test('THE BUG: a note\'s headings are not days, and are not in the timeline', async t => {
  const { index } = await corpus(
    t,
    [['2026-03-01', '# A real day\n\nwritten in.\n']],
    { 'imported.md': '# AI-driven, market-shaping\n\nbody\n\n## **Introduction**\n\nmore\n' },
  )

  const days = await index.timeline()
  assert.deepEqual(days.map(d => d.date), ['2026-03-01'], 'one day, and it is the day')
  assert.deepEqual(days[0]?.headings.map(h => h.title), ['A real day'])
})

test('and the day it carries is a DateKey, so nothing has to cast it', async t => {
  // The sidebar formatted `node.title as DateKey`. `dayLabel` did what it was
  // asked with `AI-driven, market-shaping` and produced `NaN driven, market`.
  // Two things that are not the same type no longer share one.
  const { index } = await corpus(t, [['2026-03-01', '# Chapter\n\na\n']])
  const [day] = await index.timeline()
  assert.equal(day?.date, '2026-03-01')
  assert.equal(dayLabel(day?.date as DateKey), '1 Mar')
})

// ── the tag index (MT5b, T6, D56) ──────────────────────
//
// **Narrower than the milestone was planned to be**, because MT3 found the
// *live* tag set needs no index at all: it is the tags on today's items, which
// are already on screen. So what the corpus is asked for is the FULL set, and
// dormant is a subtraction done where both halves are known.
//
// And ids, which is the half D56 always wanted: an id minted against one day is
// unique enough within a list and says nothing about a second one, while
// `tephra:todo/<id>` resolves without naming a list at all.

const TODO = (date: string, lines: readonly string[]): string =>
  `---\ntephra: 1\ndate: ${date}\nkind: todo\n---\n${lines.join('\n')}\n`

async function withList(t: TestContext, days: Record<string, readonly string[]>) {
  const made = await corpus(t, [['2026-03-01', 'A day.\n']])
  for (const [date, lines] of Object.entries(days)) {
    const [y, m] = date.split('-') as [string, string]
    await mkdir(join(made.root, 'tasks.todo', y, m), { recursive: true })
    await writeFile(join(made.root, 'tasks.todo', y, m, `${date}.md`), TODO(date, lines))
  }
  return made
}

test('every tag ever put on a task is in the full set', async t => {
  const { index } = await withList(t, {
    '2026-02-01': ['- [x] fix the gate #house <!--tephra:item aaaa1111 100 100-->'],
    '2026-03-01': [
      '- [ ] call the surveyor #house #urgent <!--tephra:item aaaa2222 100 100-->',
      '- [ ] read the survey #tephra <!--tephra:item aaaa3333 100 100-->',
    ],
  })
  // Sorted, and `#house` once though it is on two items in two different days.
  assert.deepEqual(await index.todoTags(), ['house', 'tephra', 'urgent'])
})

test('THE POINT: a tag whose items are all finished is still in the set', async t => {
  // Which is the whole of what the index adds. `#house` has no live item, so
  // today's list cannot know about it — and T6 asks that the full set stay
  // reachable rather than vanish with the last live task.
  const { index } = await withList(t, {
    '2026-02-01': ['- [x] fix the gate #house <!--tephra:item aaaa1111 100 100-->'],
  })
  assert.deepEqual(await index.todoTags(), ['house'])
})

test('a hashtag in ordinary prose is not a task tag', async t => {
  // TODO tags are their own namespace (T5), and `#house` means nothing in a
  // day of the notebook. Read out of prose it would invent tags nobody wrote.
  const { index } = await corpus(t, [['2026-03-01', 'Thinking about #house and #money today.\n']])
  assert.deepEqual(await index.todoTags(), [])
})

test('and a markdown checkbox in a note is not a task either', async t => {
  // `- [ ] something #house` is a markdown task list wherever it appears. What
  // makes it an item is the file it is in, which is why the scan asks the kind.
  const { index } = await corpus(t, [['2026-03-01', 'A day.\n']], {
    'plan.md': '- [ ] buy paint #house <!--tephra:item bbbb1111 100 100-->\n',
  })
  assert.deepEqual(await index.todoTags(), [])
  assert.deepEqual([...(await index.itemIds())], [])
})

test('every item id in the corpus is known, across days and across lists', async t => {
  const { index, root } = await withList(t, {
    '2026-02-01': ['- [ ] fix the gate <!--tephra:item aaaa1111 100 100-->'],
    '2026-03-01': ['- [ ] fix the gate <!--tephra:item aaaa1111 100 100-->'],
  })
  // A second list, which is what corpus-wide uniqueness is actually for.
  await mkdir(join(root, 'blog.todo', '2026', '03'), { recursive: true })
  await writeFile(
    join(root, 'blog.todo', '2026', '03', '2026-03-01.md'),
    TODO('2026-03-01', ['- [ ] write the post <!--tephra:item bbbb2222 100 100-->']),
  )

  const ids = await index.itemIds()
  // Carried forward, so it is one item in two days and one id.
  assert.deepEqual([...ids].sort(), ['aaaa1111', 'bbbb2222'])
})

test('a line nobody has adopted yet has no id, and contributes none', async t => {
  const { index } = await withList(t, { '2026-03-01': ['- [ ] typed in by hand #house'] })
  assert.deepEqual([...(await index.itemIds())], [])
  assert.deepEqual(await index.todoTags(), [], 'and no tag either, until it is an item')
})

// ── the link directory (ML2, R10a, T10, D60, D61) ──────
//
// **Search's sibling, and the half nobody has ever served**: search finds text
// you remember writing, this finds documents you remember opening. Era 1 had no
// links at all; era 2 had them and no way to find them again.
//
// Driven straight through the index with no surface, the same discipline as
// MT2 — the data model is where the decisions are.

const linkDay = (date: string, body: string): [string, string] => [date, body]

test('a link written in the notebook is in the directory', async t => {
  const { index } = await corpus(t, [
    linkDay('2026-03-01', 'Reading [the paper](https://example.com/a) today.\n'),
  ])
  const rows = await index.links()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.target, 'https://example.com/a')
  assert.equal(rows[0]?.label, 'the paper')
  assert.equal(rows[0]?.appearances[0]?.line, 'Reading [the paper](https://example.com/a) today.')
})

test('THE POINT: two spellings of one destination are ONE row', async t => {
  // Which is what the canonical form is for — and it is derived on read, so
  // changing what counts as the same destination is a rebuild, not a reindex.
  const { index } = await corpus(t, [
    linkDay('2026-03-01', 'First: [the paper](https://example.com/a?utm_source=news).\n'),
    linkDay('2026-03-02', 'Again: [that paper](https://example.com/a#part-2).\n'),
  ])
  const rows = await index.links()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.appearances.length, 2)
})

test('and the row shows what was WRITTEN, most recently', async t => {
  // The canonical form is a key, not a thing anybody typed.
  const { index } = await corpus(t, [
    linkDay('2026-03-01', 'First: [the paper](https://example.com/a?utm_source=news).\n'),
    linkDay('2026-03-02', 'Again: [that paper](https://example.com/a#part-2).\n'),
  ])
  const [row] = await index.links()
  assert.equal(row?.target, 'https://example.com/a#part-2')
  assert.equal(row?.label, 'that paper')
  assert.equal(row?.canonical, 'https://example.com/a', 'the key is neither of them')
})

test('newest first, which is the order the requirement asks for', async t => {
  const { index } = await corpus(t, [
    linkDay('2026-03-01', 'Old: [one](https://example.com/one).\n'),
    linkDay('2026-03-05', 'New: [two](https://example.com/two).\n'),
  ])
  assert.deepEqual((await index.links()).map(r => r.label), ['two', 'one'])
})

test('a link in a NOTE is found too, and dated by the file', async t => {
  const { index } = await corpus(t, [['2026-03-01', 'A day.\n']], {
    'plan.md': 'See [the spec](https://example.com/spec).\n',
  })
  const rows = await index.links()
  assert.deepEqual(rows.map(r => r.label), ['the spec'])
  assert.equal(rows[0]?.appearances[0]?.at.date, null, 'a note has no day')
  assert.ok((rows[0]?.appearances[0]?.when ?? 0) > 0, 'and is dated by its stamp instead')
})

test('a tephra: reference is not in the directory (D61)', async t => {
  // The sidebar already serves those, and they would bury the documents.
  const { index } = await corpus(t, [
    linkDay('2026-03-01', 'See [that day](tephra:day/2026-02-01) and [a task](tephra:todo/aaaa1111).\n'),
  ])
  assert.deepEqual(await index.links(), [])
})

test('nor is an image, because an embedded picture is not a document', async t => {
  const { index } = await corpus(t, [linkDay('2026-03-01', 'Here: ![a plan](../plan.png)\n')])
  assert.deepEqual(await index.links(), [])
})

test('one document linked from two days, spelled differently, is one row', async t => {
  // The relative spelling differs by where it was written; the document does
  // not. This is why canonicalization takes the containing file.
  const { index } = await corpus(
    t,
    [linkDay('2026-03-01', 'See [the covenants](../../../notes/c.md).\n')],
    { 'c.md': 'The covenants.\n', 'plan.md': 'And [the covenants](c.md) again.\n' },
  )
  const rows = await index.links()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.canonical, 'notes/c.md')
  assert.equal(rows[0]?.appearances.length, 2)
})

test('every appearance carries the way back to it', async t => {
  const { index } = await corpus(t, [
    linkDay('2026-03-01', 'Reading [the paper](https://example.com/a) today.\n'),
  ])
  const at = (await index.links())[0]?.appearances[0]?.at
  assert.equal(at?.file, 'notebook.stream/2026/03/2026-03-01.md')
  assert.equal(at?.date, '2026-03-01')
  assert.ok((at?.from ?? -1) >= 0 && (at?.to ?? 0) > (at?.from ?? 0))
})

test('A LINK NOBODY WROTE ANY MORE IS GONE (D52, D60)', async t => {
  // The index is a cache of the corpus as it stands, unweakened. What keeps
  // links from finished work is the corpus's own shape — a past day keeps every
  // line that ever stood in it — and not an index that accumulates.
  const { index, root } = await corpus(t, [
    linkDay('2026-03-01', 'Reading [the paper](https://example.com/a) today.\n'),
  ])
  assert.equal((await index.links()).length, 1)

  await writeFile(join(root, dayFile(d('2026-03-01'))), '---\ntephra: 1\ndate: 2026-03-01\n---\nNothing now.\n')
  await index.rebuild()
  assert.deepEqual(await index.links(), [])
})

test('a long day\'s later parts are covered by its first file', async t => {
  // Day files are scanned through the stream, not the generic path — which is
  // deliberate (a loaded day answers for itself) and is exactly why the links
  // had to be added there too. Scanned the ordinary way, the notebook — where
  // most links are written — would have contributed none at all.
  const { index, root } = await corpus(t, [linkDay('2026-03-01', 'One: [a](https://example.com/a)\n')])
  await writeFile(
    join(root, 'notebook.stream', '2026', '03', '2026-03-01.2.md'),
    '---\ntephra: 1\ndate: 2026-03-01\npart: 2\n---\nTwo: [b](https://example.com/b)\n',
  )
  await index.rebuild()
  assert.deepEqual((await index.links()).map(r => r.label).sort(), ['a', 'b'])
})

// ── what became of the items that stopped being carried (MT6) ──
//
// **The one question today's list cannot answer.** Today's items are on screen
// and answer for themselves; these are the ones that were done, or dropped, or
// put down, on some earlier day and are no longer carried forward. All three of
// MT6's views ask it, which is why the index learned status here and not in
// MT5b — where nobody needed it.

const RESOLVED = '2026-03-05' as DateKey

test('an item is what its NEWEST instance says it is', async t => {
  // A carry copies an item forward verbatim (D56), so one id appears in as many
  // days as it survived, each holding that day's status. Reading the newest is
  // the rule `tephra:todo/<id>` already resolves by.
  const { index } = await withList(t, {
    '2026-03-01': ['- [ ] fix the gate #house <!--tephra:item aaaa1111 100 100-->'],
    '2026-03-02': ['- [/] fix the gate #house <!--tephra:item aaaa1111 100 100-->'],
    '2026-03-03': ['- [x] fix the gate #house <!--tephra:item aaaa1111 100 100-->'],
  })
  const now = await index.itemsNow()
  assert.equal(now.size, 1, 'one item, not three')
  assert.equal(now.get('aaaa1111')?.status, 'done')
  assert.equal(now.get('aaaa1111')?.on, '2026-03-03')
})

test('THE RESOLVED TAIL: what was finished under a tag, newest first', async t => {
  const { index } = await withList(t, {
    '2026-03-04': ['- [x] fix the gate #house <!--tephra:item aaaa1111 100 100-->'],
    '2026-03-03': ['- [x] paint the shed #house <!--tephra:item aaaa2222 100 100-->'],
    '2026-03-02': ['- [-] reroof it #house <!--tephra:item aaaa3333 100 100-->'],
  })
  const byTag = await index.resolvedByTag(RESOLVED, RESOLVED_DAYS)
  // **The text is the sentence** (D85); the tag is a field, which is why it is
  // not repeated in what the row would draw.
  assert.deepEqual(byTag.get('house')?.map(i => i.text),
    ['fix the gate', 'paint the shed', 'reroof it'])
})

test('THE WINDOW: three days back, and the fourth is the scrub\'s business', async t => {
  // A reminder of recent work, not a record of all of it — the first cut had no
  // window at all, so a tag buried its live items under every task ever
  // finished under it. These are FULLY resolved items, so there is no picking
  // one up again: what is older than a few days is a question for a past day
  // (T7's flow 7), which answers it exactly.
  const { index } = await withList(t, {
    '2026-03-02': ['- [x] three days back #house <!--tephra:item aaaa1111 100 100-->'],
    '2026-03-01': ['- [x] four days back #house <!--tephra:item aaaa2222 100 100-->'],
  })
  const byTag = await index.resolvedByTag(RESOLVED, RESOLVED_DAYS)
  assert.deepEqual(byTag.get('house')?.map(i => i.text), ['three days back'])
})

test('and a LIVE item is not in it, however recent', async t => {
  const { index } = await withList(t, {
    '2026-03-03': ['- [ ] still going #house <!--tephra:item aaaa1111 100 100-->'],
    '2026-03-04': ['- [?] blocked, not finished #house <!--tephra:item aaaa2222 100 100-->'],
  })
  assert.equal((await index.resolvedByTag(RESOLVED, RESOLVED_DAYS)).get('house'), undefined)
})

test('nor is one finished TODAY, because it is still on the list', async t => {
  // It is carried, greyed and on screen (T7). Showing it underneath as well
  // would be showing it twice.
  const { index } = await withList(t, {
    '2026-03-05': ['- [x] done this morning #house <!--tephra:item aaaa1111 100 100-->'],
  })
  assert.equal((await index.resolvedByTag(RESOLVED, RESOLVED_DAYS)).get('house'), undefined)
})

test('THE DRAWER: backlogged items, which nothing else can see', async t => {
  // A backlogged item is not carried forward (D55), so it sits in the day it
  // was put down and only the corpus knows it is there. That is the graveyard
  // risk T14 names, which is why it is counted rather than merely reachable.
  const { index } = await withList(t, {
    '2026-03-01': ['- [>] someday, the loft #house <!--tephra:item aaaa1111 100 100-->'],
    '2026-03-02': ['- [x] and this one got done <!--tephra:item aaaa2222 100 100-->'],
    '2026-03-03': ['- [>] someday, the fence <!--tephra:item aaaa3333 100 100-->'],
  })
  const drawer = await index.backlog()
  assert.deepEqual(drawer.map(i => i.text), ['someday, the fence', 'someday, the loft'])
})

test('and a backlogged item is NOT in the resolved tail, because it is waiting', async t => {
  // Resolved means finished with. Backlogged means put down — a different
  // thing, with a different place to live.
  const { index } = await withList(t, {
    '2026-03-04': ['- [>] someday, the loft #house <!--tephra:item aaaa1111 100 100-->'],
  })
  assert.equal((await index.resolvedByTag(RESOLVED, RESOLVED_DAYS)).get('house'), undefined)
  assert.equal((await index.backlog()).length, 1)
})

test('an item picked back UP is live again, and leaves both', async t => {
  const { index } = await withList(t, {
    '2026-03-03': ['- [>] someday, the loft #house <!--tephra:item aaaa1111 100 100-->'],
    '2026-03-04': ['- [ ] actually, now #house <!--tephra:item aaaa1111 100 100-->'],
  })
  assert.deepEqual(await index.backlog(), [])
  assert.equal((await index.resolvedByTag(RESOLVED, RESOLVED_DAYS)).get('house'), undefined)
})
