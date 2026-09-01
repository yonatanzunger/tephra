// Timing-sensitive and touching a real filesystem, so these live here rather
// than in unit/. They cover two failures that cannot be observed by using the
// app normally: T5 (a watcher that dies silently on atomic replace) and the
// self-write echo that would make every autosave look like a hand-edit.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import type { FileChange } from '../../src/main/w/watcher.ts'

const settle = (ms = 400): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * Open a notebook that is always closed again, even when the test fails.
 *
 * A leaked watcher keeps the event loop alive, so the run hangs and prints no
 * report at all — which is how the directory-event bug below hid the first time
 * it fired. Cleanup that only happens on the success path is not cleanup.
 */
async function openScratch(t: TestContext): Promise<Notebook> {
  const root = await mkdtemp(join(tmpdir(), 'tephra-watch-'))
  const nb = await Notebook.open({ root, lock: false })
  t.after(() => nb.close())
  return nb
}

/** Collects change batches, so a test can assert on what X would have seen. */
function collector(nb: Notebook): { seen: FileChange[] } {
  const seen: FileChange[] = []
  nb.onExternalChange(changes => seen.push(...changes))
  return { seen }
}

test('an external edit is reported', async t => {
  const nb = await openScratch(t)
  await mkdir(join(nb.root, 'notebook.stream/2026/03'), { recursive: true })
  await settle(200)
  const { seen } = collector(nb)
  await writeFile(join(nb.root, 'notebook.stream/2026/03/2026-03-14.md'), 'hand-edited\n')
  await settle()
  assert.ok(
    seen.some(c => c.rel === 'notebook.stream/2026/03/2026-03-14.md' && c.kind === 'changed'),
    `expected a change, saw ${JSON.stringify(seen)}`,
  )
})

test('our own atomic write is NOT reported as an external change', async t => {
  // Without content-hash suppression this fires on every autosave, X treats it
  // as a hand-edit, reloads, and fights the editor.
  const nb = await openScratch(t)
  await settle(200)
  const { seen } = collector(nb)
  await nb.write('notebook.stream/2026/03/2026-03-14.md', 'written by us\n')
  await settle()
  assert.deepEqual(seen, [], `own write leaked: ${JSON.stringify(seen)}`)
})

test('creating a directory is not reported as a deleted file', async t => {
  // The bug this caught: a new month's directory fires an event, reading a
  // directory fails, and folding that into "content is null" reported
  // `notebook.stream/2026` as DELETED — on the ordinary path of writing a month's first
  // note. Loudest possible wrong answer, on the most common path.
  const nb = await openScratch(t)
  await settle(200)
  const { seen } = collector(nb)
  await mkdir(join(nb.root, 'notebook.stream/2027/01'), { recursive: true })
  await settle()
  assert.deepEqual(seen.filter(c => c.kind === 'deleted'), [], JSON.stringify(seen))
})

test('the watcher survives an atomic replace and still reports later edits', async t => {
  // T5: an fd-based watcher dies *without erroring* at exactly this point, and
  // the app keeps running while quietly ceasing to notice the disk.
  const nb = await openScratch(t)
  const rel = 'notebook.stream/2026/03/2026-03-14.md'
  await nb.write(rel, 'first\n') // atomic replace, ours
  await settle()

  const { seen } = collector(nb)
  await writeFile(join(nb.root, rel), 'external after a rename\n')
  await settle()
  assert.ok(
    seen.some(c => c.rel === rel && c.kind === 'changed'),
    'watcher went deaf after an atomic rename',
  )
})

test('an external edit right after our own write is still seen', async t => {
  // The reason suppression is by content and not by a time window: a hand-edit
  // landing inside such a window would be silently dropped.
  const nb = await openScratch(t)
  const rel = 'notes/thing.md'
  await settle(200)
  const { seen } = collector(nb)

  await nb.write(rel, 'ours\n')
  await writeFile(join(nb.root, rel), 'theirs, immediately\n')
  await settle()

  assert.ok(seen.some(c => c.rel === rel && c.kind === 'changed'), 'hand-edit was swallowed')
})

test('rewriting a file with identical content reports nothing', async t => {
  const nb = await openScratch(t)
  const rel = 'notes/same.md'
  await nb.write(rel, 'unchanged\n')
  await settle()
  const { seen } = collector(nb)
  await writeFile(join(nb.root, rel), 'unchanged\n')
  await settle()
  assert.deepEqual(seen, [], 'nothing actually changed')
})

test('deletion is reported as deletion', async t => {
  const nb = await openScratch(t)
  const rel = 'notes/gone.md'
  await nb.write(rel, 'here\n')
  await settle()
  const { seen } = collector(nb)
  await unlink(join(nb.root, rel))
  await settle()
  assert.ok(seen.some(c => c.rel === rel && c.kind === 'deleted'), JSON.stringify(seen))
})

test('the notebook\'s own bootstrap writes are not reported as external', async t => {
  // Notebook.open creates .gitignore and the version file. A watcher started
  // after those writes has no record of them, so their queued events arrive
  // looking like hand-edits and X reloads at startup for no reason. This only
  // showed up as a flake under parallel test load.
  const nb = await openScratch(t)
  const { seen } = collector(nb)
  await settle(600)
  assert.deepEqual(seen, [], `bootstrap leaked: ${JSON.stringify(seen)}`)
})

test('.tephra is never reported — it would be a permanent event storm', async t => {
  const nb = await openScratch(t)
  await settle(200)
  const { seen } = collector(nb)
  await writeFile(join(nb.root, '.tephra/wal/doc.jsonl'), '{"a":1}\n')
  await writeFile(join(nb.root, '.tephra/ui-state.json'), '{}')
  await settle()
  assert.deepEqual(seen, [])
})
