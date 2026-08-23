// The notebook's git repository (D32, D34).
//
// The properties worth pinning down are the ones whose failure is silent: an
// empty commit every half hour forever, the WAL committed by accident, an
// existing repository clobbered on open. Each of those looks like nothing at
// the time and like a ruined history later.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitRepository } from '../../src/main/w/git-repository.ts'
import type { RelPath } from '../../src/main/w/layout.ts'

const rel = (s: string): RelPath => s as RelPath
const DAY = rel('stream/2026/08/2026-08-22.md')

async function scratch(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tephra-repo-'))
  await mkdir(join(dir, 'stream', '2026', '08'), { recursive: true })
  await writeFile(join(dir, '.gitignore'), '.tephra/\n')
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const put = (dir: string, path: string, text: string): Promise<void> =>
  writeFile(join(dir, path), text)

test('a first commit records the file', async t => {
  const dir = await scratch(t)
  const repo = await GitRepository.open(dir)
  await put(dir, DAY, 'The first paragraph.\n')

  const oid = await repo.save('2026-08-22 · The first paragraph.')
  assert.ok(oid !== null && oid.length === 40)

  const log = await repo.versions()
  assert.equal(log.length, 1)
  assert.equal(log[0]?.reason, '2026-08-22 · The first paragraph.')
})

test('a quiet notebook does NOT accrue empty commits', async t => {
  // The failure this guards is silent and cumulative: a timer that fires every
  // half hour forever, each time committing nothing, until the log is thousands
  // of entries deep and useless for the one job it has — finding a lost
  // paragraph. Staging an unchanged file still counts as "staged", so the guard
  // has to compare trees, not intentions.
  const dir = await scratch(t)
  const repo = await GitRepository.open(dir)
  await put(dir, DAY, 'Something.\n')
  await repo.save('first')

  for (let i = 0; i < 5; i++) {
    assert.equal(await repo.save(`tick ${i}`), null, 'nothing changed, nothing committed')
  }
  assert.equal((await repo.versions()).length, 1)
})

test('text overwritten in a later commit is recoverable from the earlier one', async t => {
  // The whole reason the milestone exists.
  const dir = await scratch(t)
  const repo = await GitRepository.open(dir)
  await put(dir, DAY, 'A paragraph I will regret deleting.\n')
  const first = await repo.save('wrote it')
  await put(dir, DAY, 'Something else entirely.\n')
  await repo.save('replaced it')

  assert.ok(first !== null)
  const recovered = await repo.contentAt(first, DAY)
  assert.match(recovered ?? '', /regret deleting/)
})

test('a deleted file is committed as a deletion, not as a failure', async t => {
  const dir = await scratch(t)
  const repo = await GitRepository.open(dir)
  await put(dir, DAY, 'Here for now.\n')
  await repo.save('wrote it')

  await rm(join(dir, DAY))
  const oid = await repo.save('deleted it')
  assert.ok(oid !== null, 'a deletion is a change worth committing')
  assert.equal(await repo.contentAt(oid, DAY), null, 'gone at the new commit')
})

test('the machine-local directory is never committed', async t => {
  // .tephra/ holds the WAL, the cursor and caches — disposable by design (D7).
  // It is in .gitignore as well; this is the belt to that pair of braces,
  // because the failure mode is committing the WAL on every single tick.
  const dir = await scratch(t)
  const repo = await GitRepository.open(dir)
  await mkdir(join(dir, '.tephra'), { recursive: true })
  await put(dir, '.tephra/wal', 'machine-local')
  await put(dir, DAY, 'Real content.\n')

  const oid = await repo.save('first')
  assert.ok(oid !== null)
  assert.equal(await repo.contentAt(oid, rel('.tephra/wal')), null, 'the WAL is not in the tree')
  assert.match((await repo.contentAt(oid, DAY)) ?? '', /Real content/)
})

test('opening an EXISTING repository adopts it and keeps its history', async t => {
  // The owner may have run `git init` here themselves, or be keeping the
  // notebook in a repository that predates Tephra. Re-initialising would
  // destroy exactly what this feature exists to protect.
  const dir = await scratch(t)
  const run = (...args: string[]): string =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=H', '-c', 'user.email=h@l', ...args], {
      encoding: 'utf8',
    })
  run('init', '-b', 'main')
  await put(dir, DAY, 'Written before Tephra existed.\n')
  run('add', '.')
  run('commit', '-m', 'theirs')

  const repo = await GitRepository.open(dir)
  const log = await repo.versions()
  assert.equal(log.length, 1, 'their commit survived')
  assert.equal(log[0]?.reason, 'theirs')
})

test('the startup scan catches what changed while the app was closed', async t => {
  const dir = await scratch(t)
  const repo = await GitRepository.open(dir)
  await put(dir, DAY, 'Session one.\n')
  await repo.save('session one')

  // Edited by something else entirely, with Tephra not running.
  await put(dir, DAY, 'Edited in another program.\n')
  await put(dir, 'stream/2026/08/2026-08-23.md', 'A day created by hand.\n')

  const oid = await repo.save('Changes made outside Tephra')
  assert.ok(oid !== null, 'the scan found them')
  assert.match((await repo.contentAt(oid, DAY)) ?? '', /another program/)
  assert.match((await repo.contentAt(oid, rel('stream/2026/08/2026-08-23.md'))) ?? '', /by hand/)

  assert.equal(await repo.save('again'), null, 'and nothing is left outstanding')
})

test('what we write is readable by the git binary', async t => {
  // D34's acceptance test, asserted rather than assumed: the entire argument
  // for git over a store of our own is that the exit extends to the history.
  const dir = await scratch(t)
  const repo = await GitRepository.open(dir)
  await put(dir, DAY, 'Readable by everything.\n')

  // Through the startup scan, which is how the app reaches its first commit —
  // and the reason that matters here is `.gitignore`. Committing only the day
  // file leaves it untracked, so the tree is not clean and, worse, anyone who
  // cloned the notebook would not know to ignore `.tephra/`. The bootstrap
  // writes that file; the first commit has to carry it.
  await repo.save('a commit')

  execFileSync('git', ['-C', dir, 'fsck', '--strict'], { encoding: 'utf8' })
  const log = execFileSync('git', ['-C', dir, 'log', '--oneline'], { encoding: 'utf8' })
  assert.match(log, /a commit/)
  const status = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' })
  assert.equal(status.trim(), '', 'the working tree is clean after our commit')
  assert.match(
    execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' }),
    /\.gitignore/,
    'a clone must know to ignore the machine-local directory',
  )
  void readFile
})

test('REGRESSION: an edit that does not change the file’s LENGTH is still committed', async t => {
  // isomorphic-git's `status` and `statusMatrix` are stat-based and both report
  // "unmodified" here — measured, and still wrong more than a second later,
  // while the git binary correctly says the file is modified. Same-length edits
  // are ordinary in a notebook: fixing a typo, swapping a word, correcting a
  // digit. Trusting either primitive meant those edits reached the disk and
  // were SILENTLY never committed, which is the exact failure this milestone
  // exists to remove. Detection is by content hash now.
  const dir = await scratch(t)
  const repo = await GitRepository.open(dir)
  await put(dir, DAY, 'Teh quick brown fox.\n')
  await repo.save('with the typo')

  await put(dir, DAY, 'The quick brown fox.\n') // same length, one letter moved

  // No hint needed: `add` hashes as it walks, so the same second and the same
  // length are both irrelevant to it.
  const oid = await repo.save('typo fixed')
  assert.ok(oid !== null, 'the fix was committed')
  assert.match((await repo.contentAt(oid, DAY)) ?? '', /^The quick/m)
  assert.equal((await repo.versions()).length, 2)
})

test('REGRESSION: the startup scan also catches a same-length change', async t => {
  const dir = await scratch(t)
  const repo = await GitRepository.open(dir)
  await put(dir, DAY, 'AAAAAAAAAA\n')
  await repo.save('first')

  await put(dir, DAY, 'BBBBBBBBBB\n') // identical length, app not running
  const oid = await repo.save('caught at startup')
  assert.ok(oid !== null, 'the scan noticed')
  assert.match((await repo.contentAt(oid, DAY)) ?? '', /BBBB/)
})
