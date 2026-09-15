// The query engine (MS1, D65, D66).
//
// **Three steps and three claims.** Narrowing prevents reads rather than
// filtering their results; ordering is decided before anything is read, so the
// first hit can come back without the last being known; and a cursor reads only
// as far as it was asked to.
//
// The queries are written in the notation MS2 already implements, because a
// `Query` assembled by hand is a test nobody rereads — and MS2's own table is
// green beside these, so a red test here is a bug here.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { StreamDocument } from '../../src/main/x/documents/kinds/stream.ts'
import { CorpusIndex } from '../../src/main/x/documents/corpus-index.ts'
import { candidatesFor, Scanner } from '../../src/main/x/documents/search.ts'
import { parseQuery } from '../../src/shared/query-text.ts'
import { EVERYWHERE, type Hit, type Ordering, type Query, type QueryParams } from '../../src/shared/search-api.ts'
import { dayFile, type RelPath } from '../../src/main/w/layout.ts'
import type { DateKey, DocumentId } from '../../src/shared/document-api.ts'
import type { Located } from '../../src/shared/nav-api.ts'

const d = (s: string): DateKey => s as DateKey
const TAG = (s: string, text: string): string =>
  `<!--tephra:tag-start ${s}-->${text}<!--tephra:tag-end ${s}-->`

const NEWEST: Ordering = { kind: 'chronological', origin: 'now', direction: 'past' }
const OLDEST: Ordering = { kind: 'chronological', origin: 'now', direction: 'future' }

/** A notebook, plus a `read` that counts, so "it did not open that file" is testable. */
async function corpus(
  t: TestContext,
  days: readonly [string, string][],
  notes: Record<string, string> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-search-'))
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
  // **One stream document, as the app composes it** (`notebook-service.ts` passes
  // `() => this.#stream`). A fresh one per call re-probes the day files it might
  // be made of, which is reads this test would then blame on the search.
  const stream = new StreamDocument(notebook)
  const index = new CorpusIndex(notebook, async () => stream)
  // **The index is warmed before anything is counted.** Its first sweep reads
  // every file once, ever, which is the cache doing its job and not the search
  // doing its. Later sweeps read only the cache — which was not true until MS1
  // found `#loadedDate` comparing an `undefined` to `null`, and is the reason
  // this test can count reads at all.
  await index.files()

  const opened: RelPath[] = []
  const real = notebook.read.bind(notebook)
  notebook.read = async (rel: RelPath) => {
    opened.push(rel)
    return real(rel)
  }

  const params = (over: Partial<QueryParams> = {}): QueryParams =>
    ({ scope: EVERYWHERE, order: NEWEST, fold: 'auto', ...over })
  const query = (text: string, over: Partial<QueryParams> = {}): Query =>
    parseQuery(text, params(over)).query

  return {
    index,
    notebook,
    opened,
    query,
    params,
    async search(text: string, over: Partial<QueryParams> = {}, take = 100): Promise<readonly Hit[]> {
      opened.length = 0
      const cursor = new Scanner(notebook, index).open(query(text, over))
      const out = await cursor.next(take)
      cursor.close()
      return out
    },
  }
}

const CORPUS: readonly [string, string][] = [
  ['2026-03-01', 'Spoke to the agent about the survey.\n'],
  ['2026-03-02', `A note on ${TAG('House Deal', 'the survey came back clean')} today.\n`],
  ['2026-03-03', 'Nothing to do with any of it.\n'],
  ['2026-04-01', `April, and ${TAG('House Deal', 'the survey again')}.\n`],
]

// ── the scan ───────────────────────────────────────────────

test('a phrase finds the lines it is in', async t => {
  const { search } = await corpus(t, CORPUS)
  const hits = await search('the survey')
  assert.deepEqual(hits.map(h => h.at.date), ['2026-04-01', '2026-03-02', '2026-03-01'])
})

test('and a hit carries the line as a reader would read it', async t => {
  const { search } = await corpus(t, [['2026-03-01', `- [ ] Call the surveyor <!--tephra:item aaaa1111 1 2-->\n`]])
  const [hit] = await search('call the surveyor')
  assert.equal(hit?.line, 'Call the surveyor', 'no bullet, no checkbox, no marker')
  assert.deepEqual(hit?.within, { from: 0, to: 17 }, 'and the match is placed in THAT line')
})

test('THE TWO OFFSETS: `at` points into the file, `within` into the line', async t => {
  // A line with machinery in front of the match: one number cannot be both, and
  // the first draft of this used `at` for the highlight and drew it in the
  // wrong place.
  const { search } = await corpus(t, [['2026-03-01', `- [ ] ${TAG('x', 'ping')} pong\n`]])
  const [hit] = await search('pong')
  assert.ok(hit !== undefined)
  assert.equal(hit.line, 'ping pong')
  assert.deepEqual(hit.within, { from: 5, to: 9 })
  assert.ok(hit.at.from > 9, 'while the file offset is past the bullet and the marker')
})

test('machinery is not searchable text', async t => {
  // Finding "tag-start" inside a marker would report the filing system as
  // though somebody had written it.
  const { search } = await corpus(t, [['2026-03-01', `A ${TAG('house deal', 'passage')}.\n`]])
  assert.deepEqual(await search('tag-start'), [])
  assert.equal((await search('passage')).length, 1)
})

test('the phrase is literal, and adjacent', async t => {
  const { search } = await corpus(t, [['2026-03-01', 'the survey came back. survey the room.\n']])
  assert.equal((await search('the survey')).length, 1, 'not "survey the"')
  assert.equal((await search('survey the')).length, 1)
})

test('and whitespace in the line need not match whitespace in the query', async t => {
  const { search } = await corpus(t, [['2026-03-01', 'the\n  survey came back\n']])
  assert.equal((await search('came back')).length, 1)
  assert.equal((await search('the survey')).length, 0, 'a phrase does not cross a line')
})

test('several matches in one line are several hits', async t => {
  const { search } = await corpus(t, [['2026-03-01', 'survey and survey and survey\n']])
  assert.equal((await search('survey')).length, 3)
})

test('case folds for a lower-case query and does not for a capitalised one', async t => {
  const { search } = await corpus(t, [['2026-03-01', 'The Survey came back.\n']])
  assert.equal((await search('survey')).length, 1)
  assert.equal((await search('Survey')).length, 1)
  assert.equal((await search('SURVEY')).length, 0)
})

test('a phrase with regex characters in it is still a phrase', async t => {
  const { search } = await corpus(t, [['2026-03-01', 'the cost was $3.50 (plus tax)\n']])
  assert.equal((await search('$3.50 (plus')).length, 1)
})

// ── narrowing ──────────────────────────────────────────────

test('THE POINT: a tag scope stops the other files from being read', async t => {
  const { search, opened } = await corpus(t, CORPUS)
  const hits = await search('survey #\'house deal\'')
  assert.deepEqual(hits.map(h => h.at.date), ['2026-04-01', '2026-03-02'])
  assert.deepEqual(opened.filter(rel => rel.startsWith('notebook.stream')).sort(),
    [dayFile(d('2026-03-02')), dayFile(d('2026-04-01'))],
    'the other two days were never opened, not opened and discarded')
})

test('and the same claim without a filesystem: they are not candidates at all', async t => {
  // Why `candidatesFor` is exported. The test above is the honest end-to-end
  // one; this is the one that still says something when a scan is slow or a
  // cache is cold, because it never touches either.
  const { index, query } = await corpus(t, CORPUS)
  const candidates = await candidatesFor(index, query('survey #\'house deal\'').scope, NEWEST)
  assert.deepEqual(candidates.map(c => c.file), [dayFile(d('2026-04-01')), dayFile(d('2026-03-02'))])
})

test('and a tag scope means INSIDE the tagged text, not in a file that mentions it', async t => {
  const { search } = await corpus(t, [
    ['2026-03-01', `outside ${TAG('house', 'inside')} outside\n`],
  ])
  assert.deepEqual((await search('inside #house')).map(h => h.line), ['outside inside outside'])
  assert.deepEqual(await search('outside #house'), [], 'the words are in the file, not in the tag')
})

test('two tags mean both, which is the intersection of their ranges', async t => {
  const { search } = await corpus(t, [
    ['2026-03-01', `${TAG('a', `x ${TAG('b', 'both')} y`)}\n`],
    ['2026-03-02', `${TAG('a', 'only a')}\n`],
  ])
  assert.deepEqual((await search('#a #b')).map(h => h.at.date), ['2026-03-01'])
  assert.deepEqual((await search('y #a #b')), [], 'y is in a but not in b')
})

test('a date scope narrows by day, half-open at the far end', async t => {
  const { search } = await corpus(t, CORPUS)
  assert.deepEqual((await search('survey 2026-03')).map(h => h.at.date), ['2026-03-02', '2026-03-01'])
  assert.deepEqual((await search('survey 2026-03-01..2026-03-02')).map(h => h.at.date),
    ['2026-03-02', '2026-03-01'], 'both days named are included')
})

test('a note has no day, so it is in no date range', async t => {
  const { search } = await corpus(t, CORPUS, { 'thoughts.md': 'the survey of notes\n' })
  assert.equal((await search('survey')).some(h => h.at.file.startsWith('notes/')), true)
  assert.equal((await search('survey 2026-03')).some(h => h.at.file.startsWith('notes/')), false)
})

test('a document scope is the whole document, however many files it is', async t => {
  const { search } = await corpus(t, CORPUS, { 'thoughts.md': 'the survey of notes\n' })
  const stream = { ...EVERYWHERE, document: 'notebook.stream' as DocumentId }
  const hits = await search('survey', { scope: stream })
  assert.equal(hits.length, 3, 'every day, and the note is not one of them')
  assert.equal(hits.every(h => h.at.file.startsWith('notebook.stream/')), true)
})

test('a scope with no phrase is a whole query — that is the subject view', async t => {
  const { search } = await corpus(t, CORPUS)
  const hits = await search('#\'house deal\'')
  assert.deepEqual(hits.map(h => h.at.date), ['2026-04-01', '2026-03-02'])
  assert.deepEqual(hits.map(h => h.within), [null, null], 'nothing in the line is the match')
})

test('an empty query matches nothing, and reads nothing to find that out', async t => {
  const { notebook, index, query, opened } = await corpus(t, CORPUS)
  const cursor = new Scanner(notebook, index).open(query(''))
  opened.length = 0
  assert.deepEqual(await cursor.next(10), [])
  assert.deepEqual(opened, [], 'not even the index')
  assert.deepEqual(cursor.progress(), { read: 0, total: 0, done: false })
})

test('a tag nobody has used is over before it starts', async t => {
  const { index, query } = await corpus(t, CORPUS)
  assert.deepEqual(await candidatesFor(index, query('#nobody').scope, NEWEST), [])
})

// ── ordering ───────────────────────────────────────────────

test('direction reverses the sequence and changes nothing else', async t => {
  const { search } = await corpus(t, CORPUS)
  const back = await search('survey')
  const forth = await search('survey', { order: OLDEST })
  assert.deepEqual(forth.map(h => h.at.date), [...back].reverse().map(h => h.at.date))
})

test('and it reverses WITHIN a file too, not only between them', async t => {
  const { search } = await corpus(t, [['2026-03-01', 'survey one\nsurvey two\nsurvey three\n']])
  assert.deepEqual((await search('survey')).map(h => h.line), ['survey three', 'survey two', 'survey one'])
  assert.deepEqual((await search('survey', { order: OLDEST })).map(h => h.line),
    ['survey one', 'survey two', 'survey three'])
})

test('an origin walks from where the cursor is standing, not from the corpus end', async t => {
  const { search, index, query } = await corpus(t, CORPUS)
  const all = await search('survey')
  const middle = all[1]?.at as Located
  const before = await search('survey', { order: { ...NEWEST, origin: middle } })
  assert.deepEqual(before.map(h => h.at.date), ['2026-03-01'], 'strictly past it, and not itself')
  const after = await search('survey', { order: { ...OLDEST, origin: middle } })
  assert.deepEqual(after.map(h => h.at.date), ['2026-04-01'])
  void index
  void query
})

test('an origin inside a file splits that file, which candidates alone cannot', async t => {
  const { search } = await corpus(t, [['2026-03-01', 'survey one\nsurvey two\nsurvey three\n']])
  const all = await search('survey', { order: OLDEST })
  const middle = all[1]?.at as Located
  assert.deepEqual((await search('survey', { order: { ...OLDEST, origin: middle } })).map(h => h.line),
    ['survey three'])
  assert.deepEqual((await search('survey', { order: { ...NEWEST, origin: middle } })).map(h => h.line),
    ['survey one'])
})

// ── the cursor ─────────────────────────────────────────────

test('THE PULL: one hit at a time reads only as far as it must', async t => {
  const { notebook, index, query, opened } = await corpus(t, CORPUS)
  const cursor = new Scanner(notebook, index).open(query('survey'))
  opened.length = 0

  const first = await cursor.next(1)
  assert.equal(first[0]?.at.date, '2026-04-01', 'the newest')
  assert.deepEqual(opened.filter(rel => rel.startsWith('notebook.stream')), [dayFile(d('2026-04-01'))],
    'one day opened, not four')

  await cursor.next(1)
  // Two more, not one: the day between them holds no match, and the cursor had
  // to look to find that out. **As far as it must, which is not the same as one.**
  assert.equal(cursor.progress().read, 3)
  assert.equal(cursor.progress().done, false, 'with the oldest day still unread')
  cursor.close()
})

test('and two pulls of one give exactly what one pull of two gives', async t => {
  const { notebook, index, query } = await corpus(t, CORPUS)
  const make = () => new Scanner(notebook, index).open(query('survey'))

  const a = make()
  const one = [...(await a.next(1)), ...(await a.next(1))]
  const readAfterSplit = a.progress().read
  a.close()

  const b = make()
  const two = await b.next(2)
  const readAfterOnce = b.progress().read
  b.close()

  assert.deepEqual(one, two)
  assert.equal(readAfterSplit, readAfterOnce, 'and cost the same')
})

test('a closed cursor stops reading', async t => {
  const { notebook, index, query, opened } = await corpus(t, CORPUS)
  const cursor = new Scanner(notebook, index).open(query('survey'))
  await cursor.next(1)
  opened.length = 0
  cursor.close()
  assert.deepEqual(await cursor.next(10), [])
  assert.deepEqual(opened, [], 'and opened nothing on the way out')
  cursor.close()
  assert.equal(cursor.progress().done, true, 'closing twice costs nothing')
})

test('exhaustion is fewer hits than asked for, and then none', async t => {
  const { notebook, index, query } = await corpus(t, CORPUS)
  const cursor = new Scanner(notebook, index).open(query('survey'))
  assert.equal((await cursor.next(100)).length, 3)
  assert.deepEqual(await cursor.next(100), [])
  assert.equal(cursor.progress().done, true)
})

test('progress knows its denominator before it has read anything', async t => {
  const { notebook, index, query } = await corpus(t, CORPUS)
  const cursor = new Scanner(notebook, index).open(query('survey'))
  assert.deepEqual(cursor.progress(), { read: 0, total: 0, done: false }, 'nothing is known until asked')
  await cursor.next(1)
  const after = cursor.progress()
  assert.equal(after.total, 4, 'every day is a candidate; the phrase has not been tested yet')
  assert.equal(after.read, 1)
  cursor.close()
})

test('a file deleted mid-scan is not an error', async t => {
  const { notebook, index, query } = await corpus(t, CORPUS)
  const cursor = new Scanner(notebook, index).open(query('survey'))
  await notebook.remove(dayFile(d('2026-04-01')))
  const hits = await cursor.next(10)
  assert.deepEqual(hits.map(h => h.at.date), ['2026-03-02', '2026-03-01'])
})
