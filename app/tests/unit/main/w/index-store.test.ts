// The index store: files, stamps, and throwing itself away (D52).
//
// The claim under test is not that JSON round-trips. It is that this thing
// behaves like a CACHE: a shape it does not recognise is discarded rather than
// raised, an empty directory leaves no file behind, and clearing it is a
// supported operation rather than a disaster.

import { strict as assert } from 'node:assert'
import { test, type TestContext } from 'node:test'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../../../src/main/w/notebook.ts'
import { IndexStore, type Entries } from '../../../../src/main/w/index-store.ts'
import { indexFile, type RelPath } from '../../../../src/main/w/layout.ts'

type Spans = readonly string[]

async function store(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-index-'))
  const notebook = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => notebook.close())
  return { root, notebook, store: new IndexStore<Spans>(notebook) }
}

const entries = (of: Record<string, Spans>): Entries<Spans> =>
  new Map(Object.entries(of).map(([name, payload]) => [name, { stamp: { size: 1, mtime: 2 }, payload }]))

const DIR = 'stream/2026/08' as RelPath

test('what goes in comes out, keyed by file name within the directory', async t => {
  const { store: s } = await store(t)
  await s.write(DIR, entries({ '2026-08-24.md': ['a', 'b'], '2026-08-25.md': ['c'] }))
  const back = await s.read(DIR)
  assert.deepEqual([...back.keys()], ['2026-08-24.md', '2026-08-25.md'])
  assert.deepEqual(back.get('2026-08-24.md')?.payload, ['a', 'b'])
  assert.deepEqual(back.get('2026-08-25.md')?.stamp, { size: 1, mtime: 2 })
})

test('a directory nobody has indexed is empty, not missing', async t => {
  const { store: s } = await store(t)
  assert.equal((await s.read('notes' as RelPath)).size, 0)
})

test('THE POINT: a corrupt cache is empty, not an exception', async t => {
  // A cache that throws turns a disposable file into an application error. The
  // honest response to nonsense is to have nothing and rebuild.
  const { root, store: s } = await store(t)
  await mkdir(join(root, '.tephra', 'index', 'stream', '2026'), { recursive: true })
  await writeFile(join(root, indexFile(DIR)), '{ this is not json')
  assert.equal((await s.read(DIR)).size, 0)
})

test('an entry missing its stamp is discarded, and its neighbours are not', async t => {
  const { root, store: s } = await store(t)
  await mkdir(join(root, '.tephra', 'index', 'stream', '2026'), { recursive: true })
  await writeFile(
    join(root, indexFile(DIR)),
    JSON.stringify({ good: { stamp: { size: 1, mtime: 2 }, payload: ['x'] }, bad: { payload: ['y'] } }),
  )
  const back = await s.read(DIR)
  assert.deepEqual([...back.keys()], ['good'])
})

test('writing nothing removes the file rather than leaving an empty one', async t => {
  const { notebook, store: s } = await store(t)
  await s.write(DIR, entries({ 'a.md': ['x'] }))
  assert.equal(await notebook.has(indexFile(DIR)), true)
  await s.write(DIR, new Map())
  assert.equal(await notebook.has(indexFile(DIR)), false)
})

test('the store can list what it holds, and throw all of it away', async t => {
  const { notebook, store: s } = await store(t)
  await s.write(DIR, entries({ 'a.md': ['x'] }))
  await s.write('notes' as RelPath, entries({ 'b.md': ['y'] }))
  assert.deepEqual([...(await s.directories())].sort(), ['notes', 'stream/2026/08'])

  await s.clear()
  assert.deepEqual(await s.directories(), [])
  assert.equal(await notebook.has(indexFile(DIR)), false)
})

test('and the corpus is untouched by any of it', async t => {
  // The cache lives in `.tephra/`, which is machine-local and never committed.
  const { root, notebook, store: s } = await store(t)
  await mkdir(join(root, 'stream', '2026', '08'), { recursive: true })
  await writeFile(join(root, 'stream/2026/08/2026-08-24.md'), 'the real thing\n')
  await s.write(DIR, entries({ '2026-08-24.md': ['x'] }))
  await s.clear()
  assert.deepEqual(await notebook.list('stream' as RelPath), ['stream/2026/08/2026-08-24.md'])
})
