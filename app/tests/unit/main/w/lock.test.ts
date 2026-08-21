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
