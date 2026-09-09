// The table between a renderer's id and a cursor in main (MS3).
//
// Three claims, and the third is the one that only shows up after a long
// session: a query is opened from where the caret is, an id nobody knows is
// exhausted rather than an error, and a window closing takes its searches with
// it.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { StreamDocument } from '../../src/main/x/documents/kinds/stream.ts'
import { CorpusIndex } from '../../src/main/x/documents/corpus-index.ts'
import { Scanner } from '../../src/main/x/documents/search.ts'
import { Searches } from '../../src/main/searches.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import type { DateKey, DocumentId, SegmentKey } from '../../src/shared/document-api.ts'
import type { SearchRequest } from '../../src/shared/ipc.ts'
import type { QueryId } from '../../src/shared/search-api.ts'

const d = (s: string): DateKey => s as DateKey
const STREAM = 'notebook.stream' as DocumentId

const ASK: SearchRequest = {
  text: 'survey', document: null, direction: 'past', fold: 'auto', origin: null,
}

async function searches(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-searches-'))
  await mkdir(join(root, 'notebook.stream', '2026', '03'), { recursive: true })
  for (const [date, body] of [
    ['2026-03-01', 'the survey came back\n'],
    ['2026-03-02', 'another survey, and a survey after it\n'],
  ] as const) {
    await writeFile(join(root, dayFile(d(date))), `---\ntephra: 1\ndate: ${date}\n---\n${body}`)
  }
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'aside.md'), `---\ntephra: 1\n---\na survey of notes\n`)
  const notebook = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => notebook.close())
  const stream = new StreamDocument(notebook)
  const index = new CorpusIndex(notebook, async () => stream)
  return new Searches(new Scanner(notebook, index))
}

test('a query opens, pulls, and runs out', async t => {
  const table = await searches(t)
  const { id, problems } = table.open(1, ASK)
  assert.deepEqual(problems, [])
  const first = await table.next(id, 1)
  assert.equal(first.hits.length, 1)
  assert.equal(first.progress.done, false)
  const rest = await table.next(id, 10)
  assert.equal(rest.hits.length, 3, 'the other three, and then nothing')
  assert.equal((await table.next(id, 10)).hits.length, 0)
})

test('a document scope is honoured, and the note is not in the stream', async t => {
  const table = await searches(t)
  const { id } = table.open(1, { ...ASK, document: STREAM })
  const { hits } = await table.next(id, 10)
  assert.equal(hits.length, 3)
  assert.equal(hits.every(h => h.at.file.startsWith('notebook.stream/')), true)
})

test('THE TRANSLATION: an origin is a segment and an offset, and becomes a file', async t => {
  // The renderer says where the caret is in the words it speaks; which file a
  // day lives in is the floor's business (D54). Walking back from the start of
  // the second day must reach the first day and not the second.
  const table = await searches(t)
  const origin = { segment: '2026-03-02' as SegmentKey, offset: 0 }
  const { id } = table.open(1, { ...ASK, document: STREAM, origin })
  const { hits } = await table.next(id, 10)
  assert.deepEqual(hits.map(h => h.at.date), ['2026-03-01'])
})

test('and turning round from the same place walks the other way', async t => {
  const table = await searches(t)
  const origin = { segment: '2026-03-02' as SegmentKey, offset: 0 }
  const { id } = table.open(1, { ...ASK, document: STREAM, direction: 'future', origin })
  const { hits } = await table.next(id, 10)
  assert.deepEqual(hits.map(h => h.at.date), ['2026-03-02', '2026-03-02'])
})

test('an id nobody knows is exhausted, not an error', async t => {
  // The renderer's cursor and this table go out of step for ordinary reasons —
  // a window closed while a pull was in flight — and a rejection there would be
  // an error dialog about nothing.
  const table = await searches(t)
  const answer = await table.next('q999' as QueryId, 5)
  assert.deepEqual(answer, { hits: [], progress: { read: 0, total: 0, done: true } })
})

test('closing one leaves the others running', async t => {
  const table = await searches(t)
  const a = table.open(1, ASK)
  const b = table.open(1, ASK)
  assert.equal(table.running, 2)
  table.close(a.id)
  assert.equal(table.running, 1)
  assert.equal((await table.next(a.id, 1)).hits.length, 0, 'the closed one answers nothing')
  assert.equal((await table.next(b.id, 1)).hits.length, 1, 'and the other is untouched')
})

test('THE LEAK: a window closing takes its searches with it', async t => {
  const table = await searches(t)
  const mine = table.open(7, ASK)
  const theirs = table.open(9, ASK)
  table.closeFor(7)
  assert.equal(table.running, 1)
  assert.equal((await table.next(mine.id, 1)).hits.length, 0)
  assert.equal((await table.next(theirs.id, 1)).hits.length, 1)
})

test('closing twice, or closing what was never opened, costs nothing', async t => {
  const table = await searches(t)
  const { id } = table.open(1, ASK)
  table.close(id)
  table.close(id)
  table.close('q404' as QueryId)
  assert.equal(table.running, 0)
})

test('a query the field cannot fully parse still opens, and says why', async t => {
  const table = await searches(t)
  const { id, problems } = table.open(1, { ...ASK, text: 'survey 2026-13-02' })
  assert.equal(problems.length, 1)
  assert.match(problems[0]?.why ?? '', /date/)
  // And it searched for the words anyway, which is why there are no hits: no
  // line holds both. Losing the characters would have been worse.
  assert.equal((await table.next(id, 10)).hits.length, 0)
})
