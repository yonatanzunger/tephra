// The write-ahead log (D32).
//
// It exists for one event: the process dying between a keystroke and the file
// write a second later. That event cannot be waited for, so these tests stage
// it — build a service, let it journal, then throw it away without flushing and
// bring up a new one over the same notebook.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { DocumentService } from '../../src/main/document-service.ts'
import { dayFile, walFile } from '../../src/main/w/layout.ts'
import type { WindowPosition, DateKey } from '../../src/shared/document-api.ts'
import { pt } from '../support/text.ts'

const wp = (n: number): WindowPosition => n as WindowPosition
const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

async function session(t: TestContext, root: string, options = {}) {
  const nb = await Notebook.open({ root, lock: false, watch: false })
  const svc = new DocumentService(nb, {
    walBatchMs: 10,
    // Long enough that the file tier will NOT rescue us: whatever survives has
    // to have survived through the log.
    quiesceMs: 60_000,
    maxIntervalMs: 60_000,
    history: false,
    ...options,
  })
  t.after(() => nb.close())
  return { nb, svc }
}

async function type(svc: DocumentService, text: string): Promise<DateKey> {
  const info = await svc.info()
  const w = await svc.openWindow({ first: info.today, last: info.today })
  await svc.edit({
    id: w.id,
    edits: [{ from: wp(w.text.length), to: wp(w.text.length), insert: pt(text) }],
    origin: 'user',
    generation: w.generation,
  })
  return info.today
}

async function scratch(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tephra-wal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('typing reaches the log before it reaches the file', async t => {
  const root = await scratch(t)
  const { svc } = await session(t, root)
  const today = await type(svc, 'Unsaved when the lights went out.\n')
  await wait(120)

  const log = await readFile(join(root, walFile('stream')), 'utf8')
  assert.match(log, /Unsaved when the lights went out/, 'the edit is in the log')
  assert.equal(
    await readFile(join(root, dayFile(today)), 'utf8').catch(() => null),
    null,
    'and the file tier has not run yet',
  )
})

test('THE POINT: a crash between keystroke and file write loses nothing', async t => {
  const root = await scratch(t)
  const first = await session(t, root)
  const today = await type(first.svc, 'The sentence that must survive.\n')
  await wait(120)
  // No stop(), no flush: the process simply ceases to exist.

  const second = await session(t, root)
  const recovered = await second.svc.recover()
  assert.equal(recovered, 1)

  const onDisk = await readFile(join(root, dayFile(today)), 'utf8')
  assert.match(onDisk, /The sentence that must survive\./)
})

test('recovery is safe to run twice', async t => {
  // The crash can also land AFTER the files were written and before the log was
  // cleared. Replaying then would append the same paragraph a second time —
  // silently, and to the one place it was supposed to be safe.
  const root = await scratch(t)
  const first = await session(t, root)
  const today = await type(first.svc, 'Exactly once, please.\n')
  await wait(120)

  const second = await session(t, root)
  assert.equal(await second.svc.recover(), 1, 'the first recovery applies it')

  const third = await session(t, root)
  assert.equal(await third.svc.recover(), 0, 'the second finds nothing to do')

  const onDisk = await readFile(join(root, dayFile(today)), 'utf8')
  const hits = onDisk.split('Exactly once, please.').length - 1
  assert.equal(hits, 1, `the text appears once, not ${hits} times`)
})

test('a flush empties the log', async t => {
  const root = await scratch(t)
  const { svc } = await session(t, root)
  await type(svc, 'Written and done.\n')
  await wait(120)
  await svc.flush()

  assert.equal((await readFile(join(root, walFile('stream')), 'utf8')).trim(), '')
})

test('a torn last line does not cost the records before it', async t => {
  // A crash is exactly the event that leaves half a line behind. Refusing to
  // recover anything because the final fragment is incomplete would give up at
  // the precise moment the log was needed.
  const root = await scratch(t)
  const first = await session(t, root)
  const today = await type(first.svc, 'Good record.\n')
  await wait(120)

  const log = await readFile(join(root, walFile('stream')), 'utf8')
  await writeFile(join(root, walFile('stream')), `${log}{"date":"2026-08-2`)

  const second = await session(t, root)
  assert.equal(await second.svc.recover(), 1)
  assert.match(await readFile(join(root, dayFile(today)), 'utf8'), /Good record\./)
})

test('an empty log costs nothing at startup', async t => {
  const root = await scratch(t)
  const { svc } = await session(t, root)
  assert.equal(await svc.recover(), 0)
})
