// History as its own X object (D32), read-only in v1.
//
// The thing being tested is not "git works" — `repo.test.ts` covers that. It is
// that history speaks the reader's language: days and versions, not paths and
// object ids, with the frontmatter gone and the parts joined.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitRepository } from '../../src/main/w/git-repository.ts'
import { StreamHistory } from '../../src/main/x/history.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import type { DateKey, VersionId  } from '../../src/shared/document-api.ts'

const d = (s: string): DateKey => s as DateKey
const DAY = d('2026-08-22')
const OTHER = d('2026-08-21')

const dayText = (date: string, body: string): string =>
  `---\ntephra: 1\ndate: ${date}\nkind: stream\n---\n${body}`

async function history(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'tephra-hist-'))
  await mkdir(join(dir, 'stream', '2026', '08'), { recursive: true })
  await writeFile(join(dir, '.gitignore'), '.tephra/\n')
  const repo = await GitRepository.open(dir)
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, repo, hist: new StreamHistory(repo) }
}

const write = (dir: string, date: DateKey, body: string, part = 1): Promise<void> =>
  writeFile(join(dir, dayFile(date, part)), dayText(date, body))

test('versions come back newest first, carrying their message', async t => {
  const { dir, repo, hist } = await history(t)
  await write(dir, DAY, 'One.\n')
  await repo.save('2026-08-22 · One.')
  await write(dir, DAY, 'Two, and rather longer than the first.\n')
  await repo.save('2026-08-22 · Two.')

  const versions = await hist.versions()
  assert.equal(versions.length, 2)
  assert.equal(versions[0]?.reason, '2026-08-22 · Two.', 'newest first')
  assert.ok(versions[0]?.at instanceof Date, 'a Date, not a git timestamp')
})

test('a day reads back WITHOUT its frontmatter', async t => {
  // Storage metadata is not text anyone wrote. Handing it back would make
  // "copy the paragraph out" mean "and then delete the header".
  const { dir, repo, hist } = await history(t)
  await write(dir, DAY, 'The paragraph itself.\n')
  const oid = await repo.save('wrote it')

  const text = await hist.readDay(oid as VersionId, DAY)
  assert.equal(text, 'The paragraph itself.\n')
  assert.doesNotMatch(text ?? '', /tephra: 1|kind: stream|---/)
})

test('THE POINT: text deleted later is readable at an earlier version', async t => {
  const { dir, repo, hist } = await history(t)
  await write(dir, DAY, 'A paragraph I will delete by accident.\n')
  const before = await repo.save('wrote it')
  await write(dir, DAY, 'Oops.\n')
  await repo.save('destroyed it')

  assert.match((await hist.readDay(before as VersionId, DAY)) ?? '', /delete by accident/)
  assert.equal(await hist.readDay((await hist.versions())[0]?.id ?? ('' as VersionId), DAY), 'Oops.\n')
})

test('a day that did not exist at that version reads as null, not as empty', async t => {
  // Null and '' are different answers to different questions: "there was no
  // such day" versus "the day was blank". A browser showing a blank pane for
  // the first must say so.
  const { dir, repo, hist } = await history(t)
  await write(dir, OTHER, 'Only yesterday exists.\n')
  const oid = await repo.save('first')

  assert.equal(await hist.readDay(oid as VersionId, DAY), null)
  assert.equal(await hist.readDay(oid as VersionId, OTHER), 'Only yesterday exists.\n')
})

test('a split day reads back as ONE day', async t => {
  // D20: parts coalesce above the storage layer, so a split is invisible to
  // the API. History has to obey that too — a reader looking at last March
  // never agreed to know that the day happened to cross a size threshold.
  const { dir, repo, hist } = await history(t)
  await write(dir, DAY, 'First half.\n', 1)
  await write(dir, DAY, 'Second half.\n', 2)
  const oid = await repo.save('a long day')

  assert.equal(await hist.readDay(oid as VersionId, DAY), 'First half.\nSecond half.\n')
})

test('versionsTouching narrows to one day', async t => {
  const { dir, repo, hist } = await history(t)
  await write(dir, DAY, 'Today.\n')
  await repo.save('touched today')
  await write(dir, OTHER, 'Yesterday.\n')
  await repo.save('touched yesterday')
  await write(dir, DAY, 'Today again.\n')
  await repo.save('touched today again')

  const forToday = await hist.versionsTouching(DAY)
  assert.deepEqual(
    forToday.map(v => v.reason),
    ['touched today again', 'touched today'],
    'only the commits that changed that day, newest first',
  )
})

test('an empty repository has no versions, and that is not an error', async t => {
  const { hist } = await history(t)
  assert.deepEqual(await hist.versions(), [])
  assert.equal((await hist.status()).lastCommit, null)
})

test('restore refuses rather than pretending', async t => {
  // M0's rule, applied again: `untag` and `branch` threw rather than silently
  // doing nothing. A restore that quietly did nothing would be the worst
  // possible behaviour for the one feature people reach for in a panic.
  const { hist } = await history(t)
  await assert.rejects(() => hist.restore(), /M2/)
})
