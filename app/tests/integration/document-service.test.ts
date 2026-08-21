// The service that sits behind IPC. Electron-free by design, so the ordering
// guarantee — the part that is subtly wrong in a way no manual test notices —
// can actually be exercised.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { DocumentService } from '../../src/main/document-service.ts'
import { StreamDocument } from '../../src/main/x/stream-document.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import type { BufferPosition, DateKey } from '../../src/shared/document-api.ts'

const bp = (n: number): BufferPosition => n as BufferPosition

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-svc-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => nb.close())
  const service = new DocumentService(nb)
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
        edits: [{ from: bp(at), to: bp(at), insert: ch }],
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
    edits: [{ from: bp(0), to: bp(0), insert: 'still works' }],
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
    edits: [{ from: bp(0), to: bp(0), insert: 'twelve chars' }],
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
    edits: [{ from: bp(0), to: bp(0), insert: 'x' }],
    origin: 'user',
    generation: 1 as never,
  })
  await service.undo()
  assert.ok(seen.length > 0, 'undo reached the renderer')

  detach()
  const before = seen.length
  await service.edit({
    id: snapshot.id,
    edits: [{ from: bp(0), to: bp(0), insert: 'y' }],
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
    edits: [{ from: bp(0), to: bp(0), insert: 'persisted\n' }],
    origin: 'user',
    generation: 1 as never,
  })
  await service.flush()
  const onDisk = await readFile(join(root, dayFile(today as DateKey)), 'utf8')
  assert.match(onDisk, /persisted/)
  assert.match(onDisk, /^---\ntephra: 1\n/)
})
