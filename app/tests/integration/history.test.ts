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
import { Notebook } from '../../src/main/w/notebook.ts'
import { StreamDocument } from '../../src/main/x/stream-document.ts'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { DateKey, VersionId  } from '../../src/shared/document-api.ts'
import { rt } from '../support/text.ts'

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

/** The same repository, with a live document over it — restore needs both. */
async function withDocument(t: TestContext) {
  const base = await history(t)
  const notebook = await Notebook.open({ root: base.dir, lock: false, watch: false })
  t.after(() => notebook.close())
  return { ...base, root: base.dir, doc: new StreamDocument(notebook) }
}

/** Replace a whole day through the document, so its segments are live. */
async function setDay(doc: StreamDocument, date: DateKey, body: string): Promise<void> {
  const segment = await doc.segment(date)
  await doc.replace(
    [
      {
        span: { begin: doc.positionAt(date, 0), end: doc.positionAt(date, segment.length) },
        payload: rt(body),
      },
    ],
    'user',
  )
}

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

test('restore puts every day back the way it was at a version', async t => {
  const { doc, hist, repo, root } = await withDocument(t)

  await setDay(doc, DAY, 'The first draft, which will be replaced.\n')
  await doc.flush()
  const first = (await repo.save('first')) as VersionId

  await setDay(doc, DAY, 'The second draft, which is a mistake.\n')
  await setDay(doc, OTHER, 'A day that did not exist at the first version.\n')
  await doc.flush()
  await repo.save('second')

  const report = await hist.restore(first, doc)
  await doc.flush()

  assert.equal(report.version, first)
  assert.equal(report.restored, 1)
  assert.equal(report.removed, 1, 'the later day should be gone, not blank')

  assert.match(await readFile(join(root, dayFile(DAY)), 'utf8'), /The first draft/)
  assert.equal(existsSync(join(root, dayFile(OTHER))), false)
})

test('a restore is a new version, not a rewrite of the old ones', async t => {
  const { doc, hist, repo } = await withDocument(t)
  await setDay(doc, DAY, 'One.\n')
  await doc.flush()
  const first = (await repo.save('first')) as VersionId
  await setDay(doc, DAY, 'Two.\n')
  await doc.flush()
  await repo.save('second')

  await hist.restore(first, doc)
  await doc.flush()
  await repo.save('restored')

  // The mistake is still in the history. Undoing a restore is another restore,
  // and that only works if nothing was thrown away.
  const versions = await hist.versions()
  assert.equal(versions.length >= 3, true)
  assert.equal(await hist.readDay(versions[1]!.id, DAY), 'Two.\n')
})

test('a restore truncates the undo stack', async t => {
  const { doc, hist, repo } = await withDocument(t)
  await setDay(doc, DAY, 'One.\n')
  await doc.flush()
  const first = (await repo.save('first')) as VersionId
  await setDay(doc, DAY, 'Two.\n')

  assert.notEqual(await doc.undo(), null, 'there is something to undo before the restore')
  await setDay(doc, DAY, 'Three.\n')

  await hist.restore(first, doc)
  // Mapping an undo through a change of this size is not well defined, and a
  // wrong answer is silent corruption. The way back from a bad restore is
  // another restore.
  assert.equal(await doc.undo(), null, 'undo should have nothing to say after a restore')
})