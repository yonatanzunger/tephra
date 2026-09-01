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
  await mkdir(join(root, 'notebook.stream', '2026', '03'), { recursive: true })
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

test('a note opens as its own document, with one segment (D27)', async t => {
  const { corpus: c } = await corpus(t)
  await c.use('notes/a-note.md' as DocumentId, async doc => {
    assert.equal(doc.meta.kind, 'markdown')
    assert.deepEqual(await doc.keys(), ['content'], 'one segment, and it is not a date')
  })
})

test('and a fileset opens as one too, until it has verbs of its own', async t => {
  const { corpus: c } = await corpus(t)
  await c.use('sections/house.fileset.md' as DocumentId, async doc => {
    assert.equal(doc.meta.kind, 'fileset')
  })
})

test('a note is not a stream, and says so rather than half-answering', async t => {
  const { corpus: c } = await corpus(t)
  await c.use('notes/a-note.md' as DocumentId, async doc => {
    // A position naming some other segment came from code that thinks this is
    // a stream; an empty segment would let it go on believing that.
    await assert.rejects(() => doc.spansAt({ segment: '2026-03-01' as never, offset: 0 as never, generation: doc.generation }))
  })
})

test('something that is not a document at all is refused', async t => {
  const { corpus: c } = await corpus(t)
  await assert.rejects(
    () => c.use('attachments/2026/03/a.png' as DocumentId, async doc => doc),
    /is not a document/,
  )
})

test('THE MULTI-DOCUMENT CASE: clean documents cycle, the dirty one stays', async t => {
  // Deferred from MC2d, which could not write it: with one openable kind there
  // was nothing to fill a cache WITH. The rule is the one eviction exists to
  // respect — never let go of unsaved work, however much pressure there is.
  const { corpus: c, root } = await corpus(t, { cache: 2 })
  await mkdir(join(root, 'notes'), { recursive: true })
  for (let i = 0; i < 6; i++) {
    await writeFile(join(root, 'notes', `n${i}.md`), `---\ntephra: 1\n---\nNote ${i}.\n`)
  }

  await c.use(STREAM_ID, scribble)
  for (let i = 0; i < 6; i++) {
    await c.use(`notes/n${i}.md` as DocumentId, async doc => doc.meta.kind)
  }

  const held = c.held().map(h => h.id)
  assert.ok(held.includes(STREAM_ID), `the dirty document is still held, got ${held.join(', ')}`)
  await c.use(STREAM_ID, async doc => assert.equal(doc.isDirty, true, 'and still has its edit'))
})

test('a batch sweep of the whole corpus leaves the cache where it found it', async t => {
  // What the index does. `retain: false` is what makes indexing affordable
  // without eviction being load-bearing (D54).
  const { corpus: c, root } = await corpus(t, { cache: 8 })
  await mkdir(join(root, 'notes'), { recursive: true })
  for (let i = 0; i < 12; i++) {
    await writeFile(join(root, 'notes', `s${i}.md`), `---\ntephra: 1\n---\nNote ${i}.\n`)
  }
  await c.use(STREAM_ID, async doc => doc) // one interactive open, kept

  for (const id of await c.list()) {
    await c.use(id, async doc => (await doc.keys()).length, { mode: 'read', retain: false })
  }

  assert.deepEqual(c.held().map(h => h.id), [STREAM_ID], 'the sweep displaced nothing')
})

// ── the tiers are the corpus's, not one document's (MC2c) ──────────────────

test('flushAll writes what is dirty, and nothing that is not', async t => {
  const { corpus: c, notebook } = await corpus(t)
  assert.deepEqual(await c.flushAll(), [], 'nothing open, nothing written')

  await c.use(STREAM_ID, scribble)
  const written = await c.flushAll()
  assert.equal(written.length, 1, `one day written, got ${written.join(', ')}`)
  assert.match((await notebook.read(dayFile(DAY))) ?? '', /^x/m)

  assert.deepEqual(await c.flushAll(), [], 'and again writes nothing, because nothing is dirty')
})

test('a document that failed to open is not unsaved work', async t => {
  // `flushAll` iterates what has been opened, and an opening that rejected is
  // in that map until it is evicted. Asking it whether it is dirty would throw
  // inside the commit path, which is the worst place to find out.
  // Something that is not a document at all: opening it rejects, and the
  // rejected opening sits in the map until it is evicted.
  const { corpus: c } = await corpus(t)
  await assert.rejects(() => c.use('attachments/a.png' as DocumentId, async doc => doc))
  assert.deepEqual(await c.flushAll(), [])
})

test('and a read borrow leaves nothing to flush', async t => {
  const { corpus: c } = await corpus(t)
  await c.use(STREAM_ID, async doc => doc, { mode: 'read', retain: false })
  assert.deepEqual(await c.flushAll(), [])
})

// ── under load, which is where a cache stops being obvious (MC2d) ──────────

test('twenty borrows racing, with edits among them, leave one document', async t => {
  // Not an ordering test — ordering is the service's serial queue (D20). What
  // this asks is the Corpus's own promise: however many callers arrive at once
  // and whatever they do, there is ONE document and it stays valid throughout.
  const { corpus: c } = await corpus(t, { cache: 1 })
  const seen: unknown[] = []

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      c.use(STREAM_ID, async doc => {
        seen.push(doc)
        if (i % 5 === 0) await scribble(doc)
        // Yield, so every borrow is genuinely interleaved with the others at an
        // await rather than running to completion in turn.
        await new Promise(resolve => setImmediate(resolve))
      }),
    ),
  )

  // **What is claimed is identity, not timing.** A borrow that ran before the
  // first edit landed sees a clean document, and is right to — the Corpus
  // promises one object, and the serial queue promises order (D20). Asserting
  // dirtiness mid-flight would be testing the queue through the wrong object.
  assert.equal(new Set(seen).size, 1, 'one document, twenty borrows')
  await c.use(STREAM_ID, async doc => {
    assert.equal(doc, seen[0], 'and the same one afterwards')
    assert.equal(doc.isDirty, true, 'carrying every edit those borrows made')
  })
  assert.equal(c.held().length, 1, 'still held, because it is dirty')
})

test('eviction pressure during a borrow cannot take the document away', async t => {
  const { corpus: c } = await corpus(t, { cache: 0 })
  await c.use(STREAM_ID, async held => {
    // Every one of these ends with an eviction sweep, at a cache bound of zero.
    await Promise.all(Array.from({ length: 10 }, () => c.use(STREAM_ID, async doc => {
      assert.equal(doc, held)
    })))
    assert.equal(held.meta.kind, 'stream', 'still usable after ten sweeps')
  })
  assert.deepEqual(c.held(), [], 'and let go the moment nothing is using it')
})

test('a borrow that throws still releases the document', async t => {
  // `finally`, not a happy path — a document held by a failed operation would
  // be held forever, which is the leak the scoped form exists to prevent.
  const { corpus: c } = await corpus(t, { cache: 0 })
  await assert.rejects(() =>
    c.use(STREAM_ID, async () => {
      throw new Error('the work went wrong')
    }),
  )
  assert.deepEqual(c.held(), [], 'released anyway')
})
