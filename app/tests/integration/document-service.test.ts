// The service that sits behind IPC. Electron-free by design, so the ordering
// guarantee — the part that is subtly wrong in a way no manual test notices —
// can actually be exercised.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { DocumentService, type ServiceOptions } from '../../src/main/document-service.ts'
import { StreamDocument } from '../../src/main/x/documents/kinds/stream.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import type { WindowPosition, DateKey, VersionId } from '../../src/shared/document-api.ts'
import { pt } from '../support/text.ts'

const wp = (n: number): WindowPosition => n as WindowPosition

async function fixture(t: TestContext, options: ServiceOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-svc-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => nb.close())
  const service = new DocumentService(nb, options)
  const today = StreamDocument.today()
  const snapshot = await service.openWindow({ first: today, last: today })
  return { service, snapshot, root, today, nb }
}

test('a window snapshot carries everything the synchronous half needs', async t => {
  const { snapshot } = await fixture(t)
  assert.equal(typeof snapshot.id, 'number')
  assert.equal(snapshot.text, '')
  assert.equal(snapshot.placement.length, 1, 'one segment, one placement entry')
  assert.equal(snapshot.placement[0]!.start, 0)
})

test('edits apply in the order they were composed, not the order they finish', async t => {
  // IPC delivery is ordered, but async handlers interleave. Without the serial
  // queue two keystrokes reorder relative to what the typist saw — and the
  // result looks like a flaky editor rather than a broken queue.
  const { service, snapshot } = await fixture(t)
  const pending: Promise<unknown>[] = []
  let at = 0
  for (const ch of 'abcdefghij') {
    pending.push(
      service.edit({
        id: snapshot.id,
        edits: [{ from: wp(at), to: wp(at), insert: pt(ch) }],
        origin: 'user',
        generation: 1 as never,
      }),
    )
    at += 1
  }
  const acks = await Promise.all(pending)
  const last = acks[acks.length - 1] as { length: number }
  assert.equal(last.length, 10)

  const window = await service.openWindow({ first: StreamDocument.today(), last: StreamDocument.today() })
  assert.equal(window.text, 'abcdefghij', 'characters landed in composition order')
})

test('a failed edit does not wedge the queue behind it', async t => {
  const { service, snapshot } = await fixture(t)
  await assert.rejects(() =>
    service.edit({ id: 9999 as never, edits: [], origin: 'user', generation: 1 as never }),
  )
  const ack = await service.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('still works') }],
    origin: 'user',
    generation: 1 as never,
  })
  assert.equal(ack.length, 'still works'.length)
})

test('the ack reports the length main actually holds', async t => {
  // The renderer compares this against its own buffer; a wrong number here is
  // worse than none, because it would make the two silently disagree.
  const { service, snapshot } = await fixture(t)
  const ack = await service.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('twelve chars') }],
    origin: 'user',
    generation: 1 as never,
  })
  assert.equal(ack.length, 12)
})

test('pushed messages reach every attached sink and stop when detached', async t => {
  const { service, snapshot } = await fixture(t)
  const seen: { channel: string }[] = []
  const detach = service.addSink({ send: channel => seen.push({ channel }) })

  // A change from elsewhere — not from this window — must be pushed out.
  await service.undo()
  await service.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('x') }],
    origin: 'user',
    generation: 1 as never,
  })
  await service.undo()
  assert.ok(seen.length > 0, 'undo reached the renderer')

  detach()
  const before = seen.length
  await service.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('y') }],
    origin: 'user',
    generation: 1 as never,
  })
  await service.undo()
  assert.equal(seen.length, before, 'a detached sink hears nothing')
})

test('flush writes through the service, and the file is on disk', async t => {
  const { service, snapshot, root, today } = await fixture(t)
  await service.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('persisted\n') }],
    origin: 'user',
    generation: 1 as never,
  })
  await service.flush()
  const onDisk = await readFile(join(root, dayFile(today as DateKey)), 'utf8')
  assert.match(onDisk, /persisted/)
  assert.match(onDisk, /^---\ntephra: 1\n/)
})

test('a change is written without anyone asking, on quiescence', async t => {
  // Durability is main's job. The renderer is the process most likely to die,
  // so asking it to remember to save is asking the least reliable component to
  // own the most important guarantee.
  const { service, snapshot, root, today } = await fixture(t)
  await service.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('unprompted\n') }],
    origin: 'user',
    generation: 1 as never,
  })
  await new Promise(r => setTimeout(r, 1400)) // past the quiescence window
  const onDisk = await readFile(join(root, dayFile(today as DateKey)), 'utf8')
  assert.match(onDisk, /unprompted/)
})

test('continuous typing still reaches disk, because quiescence is not the only trigger', async t => {
  // Quiescence alone fails under exactly the condition this notebook exists
  // for: an hour of continuous writing never goes quiet, so nothing is ever
  // written. The ceiling is what closes that.
  const { service, snapshot, root, today } = await fixture(t)
  const deadline = Date.now() + 5_600
  let at = 0
  while (Date.now() < deadline) {
    await service.edit({
      id: snapshot.id,
      edits: [{ from: wp(at), to: wp(at), insert: pt('x') }],
      origin: 'user',
      generation: 1 as never,
    })
    at++
    await new Promise(r => setTimeout(r, 300)) // never quiet for a full second
  }
  const onDisk = await readFile(join(root, dayFile(today as DateKey)), 'utf8')
  assert.match(onDisk, /x{5,}/, 'the ceiling fired even though quiescence never did')
})

test('a restore is flushed and committed at once, and is itself a version', async t => {
  // Someone doing a restore cannot afford for it not to have happened: one that
  // lived only in memory would be undone by a crash. Committing it straight
  // away is also what makes "the way back from a bad restore is another
  // restore" true, since the restore becomes a point to come back FROM.
  // Short version timers: the tier's real clock is five minutes, and a pending
  // timer of that size keeps the test process alive long after the assertions
  // are done.
  const { service, snapshot, root, today } = await fixture(t, {
    versionQuiesceMs: 60,
    versionMaxMs: 200,
  })
  await service.openHistory()

  await service.edit({
    id: snapshot.id,
    generation: snapshot.generation,
    edits: [{ from: wp(0), to: wp(0), insert: pt('The good version.\n') }],
    origin: 'user',
  })
  await service.flush()
  const first = (await service.repository?.save('first')) as VersionId

  const after = await service.openWindow({ first: today, last: today })
  await service.edit({
    id: after.id,
    generation: after.generation,
    edits: [{ from: wp(0), to: wp(0), insert: pt('A regrettable addition.\n') }],
    origin: 'user',
  })
  await service.flush()
  await service.repository?.save('second')

  const report = await service.restore(first)
  assert.equal(report.version, first)
  const now = await readFile(join(root, dayFile(today)), 'utf8')
  assert.match(now, /The good version\./)
  assert.doesNotMatch(now, /regrettable/, 'the restore did not take')

  // Three versions, and the regrettable one is still readable — nothing was
  // rewritten, which is the promise the purge procedure depends on too.
  // Four: opening the notebook is itself a version, then first, second, and
  // the restore. Nothing was rewritten — which is the promise the purge
  // procedure depends on too.
  const versions = await service.versions()
  assert.equal(versions.length, 4)
  assert.match(versions[0]?.reason ?? '', /^Restored to/)
  assert.match((await service.readDay(versions[1]!.id, today)) ?? '', /regrettable/)
})

// ── what a path means, which is what File ▸ Open… asks (MC6) ───────────────

test('an absolute path inside the notebook resolves to the document it is', async t => {
  // The system dialog hands back an absolute path; the notebook is what turns
  // one into a document. Untestable through the dialog itself — a native modal
  // cannot be driven from the acceptance harness — so it is tested here, where
  // the resolution actually lives.
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'offer.md'), '---\ntephra: 1\nkind: markdown\n---\nText.\n')

  assert.equal(await service.documentAt(join(root, 'notes', 'offer.md')), 'notes/offer.md')
})

test('a path outside the notebook is not a document, and says so by being null', async t => {
  // Opening it would mean either editing a file this app does not manage or
  // importing a copy — different acts, both of which deserve to be asked for.
  const { service, root } = await fixture(t)
  const outside = join(root, '..', 'somewhere-else.md')
  await writeFile(outside, '# Not in the notebook\n')
  t.after(() => rm(outside, { force: true }))

  assert.equal(await service.documentAt(outside), null)
})

test('and a file inside the notebook that is not a document is not one either', async t => {
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'attachments'), { recursive: true })
  await writeFile(join(root, 'attachments', 'scan.png'), 'not really a png')

  assert.equal(await service.documentAt(join(root, 'attachments', 'scan.png')), null)
})

test('the documents list names every document, the notebook first', async t => {
  // What the sidebar's "Pin to…" chooser will ask for, and what the acceptance
  // harness uses to find a document by name.
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'sections'), { recursive: true })
  await writeFile(
    join(root, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n',
  )
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'plain.md'), '---\ntephra: 1\nkind: markdown\n---\nNo title.\n')

  const documents = await service.documents()
  assert.equal(documents[0]?.title, 'Notebook', 'the one document that is not a file comes first')
  assert.deepEqual(
    documents.slice(1).map(d => d.title).sort(),
    ['The house', 'plain.md'],
    'a title when it has one, and its filename when it does not',
  )
})
