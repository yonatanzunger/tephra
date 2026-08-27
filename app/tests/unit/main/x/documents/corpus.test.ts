// The corpus: two guarantees, and the ways they can be broken (D54).
//
// The contract is small enough to state: **two callers asking for one id get
// the same object, and it stays valid while the work runs.** Everything below
// is one of those two, or one of the rules that keeps them affordable.

import { strict as assert } from 'node:assert'
import { test, type TestContext } from 'node:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../../../../src/main/w/notebook.ts'
import { Corpus, STREAM_ID } from '../../../../../src/main/x/documents/corpus.ts'
import { dayFile } from '../../../../../src/main/w/layout.ts'
import type { DateKey, Document, DocumentId } from '../../../../../src/shared/document-api.ts'
import { rt } from '../../../../support/text.ts'

const d = (s: string): DateKey => s as DateKey
const DAY = d('2026-03-01')

async function corpus(t: TestContext, options: { cache?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-corpus-'))
  await mkdir(join(root, 'stream', '2026', '03'), { recursive: true })
  await writeFile(join(root, dayFile(DAY)), `---\ntephra: 1\ndate: 2026-03-01\n---\nA day.\n`)
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'a-note.md'), '---\ntephra: 1\n---\nA note.\n')
  await mkdir(join(root, 'sections'), { recursive: true })
  await writeFile(join(root, 'sections', 'house.fileset.md'), '---\ntephra: 1\n---\n- [x](../a.md)\n')

  const notebook = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => notebook.close())
  return { root, notebook, corpus: new Corpus(notebook, options) }
}

/** Dirty the stream, the way an edit does. */
async function scribble(doc: Document): Promise<void> {
  const at = (doc as unknown as { positionAt(date: DateKey, offset: number): never }).positionAt(DAY, 0)
  await doc.replace([{ span: { begin: at, end: at }, payload: rt('x') }], 'user')
}

test('THE CONTRACT: two callers asking for one id get the same object', async t => {
  const { corpus: c } = await corpus(t)
  let first: Document | null = null
  let second: Document | null = null
  await c.use(STREAM_ID, async doc => void (first = doc))
  await c.use(STREAM_ID, async doc => void (second = doc))
  assert.equal(first, second)
})

test('and two COLD borrows racing still construct only one', async t => {
  // The segment cache did check-then-act across an await once, and two reads of
  // one day raced. This map holds the opening rather than the opened, which is
  // what fixed it there.
  const { corpus: c } = await corpus(t)
  const seen = await Promise.all(
    Array.from({ length: 20 }, () => c.use(STREAM_ID, async doc => doc)),
  )
  assert.equal(new Set(seen).size, 1, 'one document, however many asked at once')
})

test('a borrow stays valid while the work runs, whatever else is happening', async t => {
  const { corpus: c } = await corpus(t)
  await c.use(STREAM_ID, async held => {
    // Enough other borrows to blow any cache bound several times over.
    for (let i = 0; i < 50; i++) await c.use(STREAM_ID, async doc => assert.equal(doc, held))
    assert.equal(held.meta.kind, 'stream')
  })
})

test('THE RULE: a dirty document is never evicted', async t => {
  const { corpus: c } = await corpus(t, { cache: 1 })
  await c.use(STREAM_ID, scribble)
  await c.use(STREAM_ID, async doc => assert.equal(doc.isDirty, true, 'still dirty, still here'))
  assert.equal(c.held().length, 1)
})

test('nor is one a window is pointing at', async t => {
  const { corpus: c } = await corpus(t, { cache: 0 })
  const release = c.watch(STREAM_ID)
  await c.use(STREAM_ID, async doc => assert.ok(doc))
  assert.deepEqual(c.held().map(h => h.watched), [true])

  release()
  await c.use(STREAM_ID, async doc => assert.ok(doc))
  assert.deepEqual(c.held(), [], 'and let go once nothing is looking at it')
})

test('a batch borrow does not enter the cache at all', async t => {
  // What the index does when it sweeps the corpus: read everything, displace
  // nothing a person is working on.
  const { corpus: c } = await corpus(t, { cache: 8 })
  await c.use(STREAM_ID, async doc => doc, { mode: 'read', retain: false })
  assert.deepEqual(c.held(), [], 'nothing kept')
})

test('but it still reads the SAME document when one is already open', async t => {
  // `retain: false` means "do not add to the cache", never "open a second
  // copy". A read borrow is a VIEW of that one document — a different object,
  // deliberately, since its whole job is to refuse things — so the test is that
  // it sees what the writer did rather than that it is the same reference.
  const { corpus: c } = await corpus(t)
  await c.use(STREAM_ID, scribble)
  await c.use(
    STREAM_ID,
    async doc => assert.equal(doc.isDirty, true, 'the reader sees the writer\'s edit'),
    { mode: 'read', retain: false },
  )
})

test('and two read borrows are the same view', async t => {
  const { corpus: c } = await corpus(t)
  const first = await c.use(STREAM_ID, async doc => doc, { mode: 'read' })
  const second = await c.use(STREAM_ID, async doc => doc, { mode: 'read' })
  assert.equal(first, second)
})

test('a read borrow refuses to change anything', async t => {
  const { corpus: c } = await corpus(t)
  await c.use(
    STREAM_ID,
    async doc => {
      await assert.rejects(() => scribble(doc), /borrowed for reading/)
      assert.equal(doc.isDirty, false)
    },
    { mode: 'read' },
  )
})

test('the corpus enumerates its documents, by kind when asked', async t => {
  const { corpus: c } = await corpus(t)
  assert.deepEqual(await c.list('fileset'), ['sections/house.fileset.md'])
  assert.deepEqual(await c.list('markdown'), ['notes/a-note.md'])
  assert.deepEqual(await c.list('stream'), [STREAM_ID])

  const all = await c.list()
  assert.equal(all.length, 3, `stream, note, fileset — got ${all.join(', ')}`)
  assert.ok(all.includes(STREAM_ID))
})

test('a day file is part of the stream, not a document of its own', async t => {
  const { corpus: c } = await corpus(t)
  assert.equal((await c.list()).includes(dayFile(DAY) as string as DocumentId), false)
})

test('existence does not require opening', async t => {
  const { corpus: c } = await corpus(t)
  assert.equal(await c.exists(STREAM_ID), true)
  assert.equal(await c.exists('notes/a-note.md' as DocumentId), true)
  assert.equal(await c.exists('notes/imaginary.md' as DocumentId), false)
  assert.deepEqual(c.held(), [], 'and nothing was opened to answer')
})

test('a kind that is not built yet says so, rather than half-working', async t => {
  const { corpus: c } = await corpus(t)
  await assert.rejects(
    () => c.use('notes/a-note.md' as DocumentId, async doc => doc),
    /not built yet/,
  )
})
