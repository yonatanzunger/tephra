// Losing the notebook to another copy of Tephra (2026-09-04).
//
// **Reported from use, and the fix opened this door.** A stale lock used to
// make the app unusable — liveness is decided by pid, pids are recycled, and a
// lock inherited by an unrelated process reads as held forever. So Tephra now
// asks the person, who is the only one who knows whether they have another
// window open, and takes the lock over when they say to.
//
// Which means an instance can be taken FROM. That is the dangerous half: two
// processes writing one corpus is the corruption the lock exists to prevent,
// and it would now be reachable through the door the fix opened. So the loser
// has to notice, and it has to stop before it writes.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { Notebook, NotebookLostError } from '../../src/main/w/notebook.ts'
import { LOCAL, type RelPath } from '../../src/main/w/layout.ts'

const NOTE = 'notes/a.md' as RelPath

async function held(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-lost-'))
  const notebook = await Notebook.open({ root, watch: false, lockCheckMs: 20 })
  t.after(() => notebook.close())
  return { root, notebook, lockPath: join(root, LOCAL.lock) }
}

/** Somebody else's name on the lock — which is what seizing looks like from here. */
const takenBy = async (path: string): Promise<void> =>
  writeFile(path, JSON.stringify({ pid: 999_999, host: hostname(), since: 'now' }))

test('a notebook that holds its lock writes as normal', async t => {
  const { notebook } = await held(t)
  await notebook.write(NOTE, 'mine\n')
  assert.equal(await notebook.read(NOTE), 'mine\n')
  assert.equal(notebook.lost, false)
})

test('THE POINT: once the lock is gone, every write is refused', async t => {
  const { notebook, lockPath } = await held(t)
  await takenBy(lockPath)
  await waitUntil(() => notebook.lost)

  await assert.rejects(() => notebook.write(NOTE, 'not mine\n'), NotebookLostError)
  await assert.rejects(() => notebook.remove(NOTE), NotebookLostError)
})

test('and the file the other copy owns is left exactly as it was', async t => {
  // The gate is on the write path itself, not only on the tiers that schedule
  // writes: stopping the timers is the tidy half, and a write that slips
  // through while that happens is the half that costs a corpus.
  const { notebook, root, lockPath } = await held(t)
  await notebook.write(NOTE, 'the other copy wrote this\n')
  await takenBy(lockPath)
  await waitUntil(() => notebook.lost)

  await notebook.write(NOTE, 'clobbered\n').catch(() => {})
  assert.equal(await readFile(join(root, NOTE), 'utf8'), 'the other copy wrote this\n')
})

test('reading still works, because what is on screen is not a lie', async t => {
  // Nothing typed after this can be written, and the app says so — but the text
  // already in front of somebody is still theirs to read and copy out.
  const { notebook, lockPath } = await held(t)
  await notebook.write(NOTE, 'still readable\n')
  await takenBy(lockPath)
  await waitUntil(() => notebook.lost)
  assert.equal(await notebook.read(NOTE), 'still readable\n')
})

test('losing it is announced once, and it is terminal', async t => {
  const { notebook, lockPath } = await held(t)
  let told = 0
  notebook.onLost(() => (told += 1))
  await takenBy(lockPath)
  await waitUntil(() => notebook.lost)
  // Long enough for several more polls; there is no coming back from another
  // process owning the notebook, so it says so once and stops asking.
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(told, 1)
})

test('and the loser does not take the winner\'s lock away on the way out', async t => {
  const { notebook, lockPath } = await held(t)
  await takenBy(lockPath)
  await waitUntil(() => notebook.lost)
  await notebook.close()
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).pid, 999_999)
})

test('SEIZING opens a notebook another instance appears to hold', async t => {
  // The startup half. `Notebook.open` refuses while a live process holds it —
  // that is the wall, and `seize` is how a person walks through it.
  const root = await mkdtemp(join(tmpdir(), 'tephra-lost-'))
  const first = await Notebook.open({ root, watch: false, lockCheckMs: 20 })
  t.after(() => first.close())
  await assert.rejects(() => Notebook.open({ root, watch: false }))

  const second = await Notebook.open({ root, watch: false, seize: true, lockCheckMs: 20 })
  t.after(() => second.close())
  await second.write(NOTE, 'the new owner\n')
  assert.equal(await second.read(NOTE), 'the new owner\n')

  // **The one that was open does NOT find out here**, and that is a fact about
  // this test rather than about the code: both notebooks are in one process, so
  // the lock the loser reads carries its own pid and its own host. Losing is
  // tested above, against a lock written by another process, which is the only
  // way it ever happens.
})

async function waitUntil(done: () => boolean): Promise<void> {
  for (let waited = 0; waited < 20_000; waited += 50) {
    if (done()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('the notebook never noticed it had lost the lock')
}

// ── running without the guard at all (2026-09-08) ──────
//
// **Reported from use, and it is D64's sharp edge.** Verification could not ask
// — a scene that stops on a modal reads as a hang — so it *took* the lock
// instead. That is right for a scratch fixture and exactly wrong for the real
// notebook: running any scene against `~/Tephra` killed the copy of Tephra
// being used. A foot-gun pointed at the one notebook that matters.
//
// The justification was orphaned verify runs holding locks, and it does not
// hold up: every acceptance scene gets its own fresh temporary notebook, so an
// orphan holds a *different* lock and was never in the way.

test('a notebook opened without the lock leaves whoever has it alone', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tephra-lost-'))
  const holder = await Notebook.open({ root, watch: false, lockCheckMs: 20 })
  t.after(() => holder.close())

  const guest = await Notebook.open({ root, watch: false, lock: false })
  t.after(() => guest.close())
  await guest.write(NOTE, 'a second look\n')
  assert.equal(await guest.read(NOTE), 'a second look\n')

  // The point: the one that was open is still the one that holds it.
  assert.equal(holder.lost, false)
  await holder.write(NOTE, 'and the first still writes\n')
  assert.equal(JSON.parse(await readFile(join(root, LOCAL.lock), 'utf8')).pid, process.pid)
})

test('and it does not remove a lock it never took', async t => {
  // `release` only removes a lock that is ours, and one we never acquired is
  // not — otherwise closing the guest would strip the holder of its guard.
  const root = await mkdtemp(join(tmpdir(), 'tephra-lost-'))
  const holder = await Notebook.open({ root, watch: false, lockCheckMs: 20 })
  t.after(() => holder.close())

  const guest = await Notebook.open({ root, watch: false, lock: false })
  await guest.close()

  assert.equal(JSON.parse(await readFile(join(root, LOCAL.lock), 'utf8')).pid, process.pid)
  await holder.write(NOTE, 'still ours\n')
})
