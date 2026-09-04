import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { NotebookLock, LockHeldError } from '../../../../src/main/w/lock.ts'

const scratch = async () => mkdtemp(join(tmpdir(), 'tephra-lock-'))

test('acquire then release', async () => {
  const path = join(await scratch(), 'lock')
  const lock = new NotebookLock(path)
  await lock.acquire()
  assert.ok(lock.held)
  await lock.release()
  assert.ok(!lock.held)
  await new NotebookLock(path).acquire() // free again
})

test('a live holder blocks a second instance', async () => {
  // The corruption this prevents: two processes fighting over the WAL and the
  // fold. The failure mode without it is corruption, not an error.
  const path = join(await scratch(), 'lock')
  await new NotebookLock(path).acquire()
  await assert.rejects(() => new NotebookLock(path).acquire(), LockHeldError)
})

test('a stale lock from a dead process is taken over', async () => {
  // A crash must not lock the notebook forever. A guard that does teaches the
  // user to delete the lock file, which teaches them to delete it always.
  const path = join(await scratch(), 'lock')
  await writeFile(path, JSON.stringify({ pid: 999_999, host: hostname(), since: '2020-01-01T00:00:00Z' }))
  const lock = new NotebookLock(path)
  await lock.acquire()
  assert.ok(lock.held)
  assert.equal(JSON.parse(await readFile(path, 'utf8')).pid, process.pid)
})

test('an unreadable lock carries no information and is treated as stale', async () => {
  const path = join(await scratch(), 'lock')
  await writeFile(path, 'this is not json')
  await new NotebookLock(path).acquire()
})

test('a lock from another host is honoured, since liveness cannot be tested', async () => {
  const path = join(await scratch(), 'lock')
  await writeFile(path, JSON.stringify({ pid: 1, host: 'some-other-machine', since: 'x' }))
  await assert.rejects(() => new NotebookLock(path).acquire(), LockHeldError)
})

test('release does not remove a lock that was taken over', async () => {
  // If ours went stale and another instance claimed it, releasing must not
  // strip the new holder of its guard.
  const path = join(await scratch(), 'lock')
  const mine = new NotebookLock(path)
  await mine.acquire()
  await writeFile(path, JSON.stringify({ pid: 4242, host: hostname(), since: 'x' }))
  await mine.release()
  assert.equal(JSON.parse(await readFile(path, 'utf8')).pid, 4242)
})

// ── taking over, and being taken from (2026-09-04) ─────
//
// **Reported from use: a stale lock made the app unusable.** Liveness is
// decided by pid, and pids are recycled — so a lock left behind by a crash can
// be inherited by an unrelated process and read as held forever. The error then
// escaped startup unhandled: a stack trace from `run.sh`, and a packaged app
// that came up with no notebook behind it.
//
// Neither the guard nor a cleverer liveness test is the answer. The person
// knows whether they have another Tephra open, and nothing else does — so the
// app asks. Which means seizing has to exist, and therefore so does losing.

test('SEIZING takes a lock a live process is holding, because a person said so', async () => {
  const path = join(await scratch(), 'lock')
  const held = new NotebookLock(path)
  await held.acquire()
  // This process is alive, so `acquire` refuses — which is right, and is
  // exactly the wall a person has to be able to walk through.
  await assert.rejects(() => new NotebookLock(path).acquire(), LockHeldError)

  const taker = new NotebookLock(path)
  await taker.seize()
  assert.ok(taker.held)
  assert.equal(JSON.parse(await readFile(path, 'utf8')).pid, process.pid)
})

test('THE OTHER HALF: a holder can tell when the lock stops being its own', async () => {
  // If taking over is possible then losing it is too, and an instance that goes
  // on writing after another has taken the notebook is the corruption the lock
  // exists to prevent, arriving through the door the fix opened.
  const path = join(await scratch(), 'lock')
  const mine = new NotebookLock(path)
  await mine.acquire()
  assert.equal(await mine.stillMine(), true)

  await writeFile(path, JSON.stringify({ pid: 999_999, host: hostname(), since: 'now' }))
  assert.equal(await mine.stillMine(), false)
})

test('and a lock that has simply vanished is not ours either', async () => {
  const path = join(await scratch(), 'lock')
  const mine = new NotebookLock(path)
  await mine.acquire()
  await writeFile(path, 'not json at all')
  assert.equal(await mine.stillMine(), false)
})

test('a lock nobody took is nobody\'s', async () => {
  assert.equal(await new NotebookLock(join(await scratch(), 'lock')).stillMine(), false)
})

test('the loser does not remove the winner\'s lock on the way out', async () => {
  // The rule `release` already followed, now reachable on purpose rather than
  // only by a stale-lock accident.
  const path = join(await scratch(), 'lock')
  const loser = new NotebookLock(path)
  await loser.acquire()
  // The winner has to be ANOTHER process, which is the whole point — two locks
  // in this one share a pid, and `release` could not tell them apart.
  await writeFile(path, JSON.stringify({ pid: 999_999, host: hostname(), since: 'now' }))
  assert.equal(await loser.stillMine(), false)

  await loser.release()
  assert.equal(JSON.parse(await readFile(path, 'utf8')).pid, 999_999, 'the winner still holds it')
})
