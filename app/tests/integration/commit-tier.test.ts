// The commit tier (D32): quiescence, a ceiling, and session end.
//
// The tier is specified in minutes and half-hours, which is untestable by
// waiting, so the intervals are constructor options and these run in
// milliseconds. That is the only concession — the logic under test is the
// shipping logic, not a reimplementation of it.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { DocumentService } from '../../src/main/document-service.ts'
import type { BufferPosition } from '../../src/shared/document-api.ts'

const bp = (n: number): BufferPosition => n as BufferPosition
const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

async function service(t: TestContext, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-tier-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  const svc = new DocumentService(nb, {
    quiesceMs: 20,
    maxIntervalMs: 60,
    commitQuiesceMs: 120,
    commitMaxMs: 600,
    ...options,
  })
  await svc.startHistory()
  t.after(async () => {
    // stop() BEFORE closing the notebook. Without it a pending timer fires
    // against a closed notebook after the test has ended, which node reports as
    // an unhandled rejection from a test that had already passed.
    await svc.stop()
    await nb.close()
    await rm(root, { recursive: true, force: true })
  })
  return { svc, nb, root }
}

/** Open a window on today and type into it, as the renderer would. */
async function type(svc: DocumentService, text: string): Promise<void> {
  const info = await svc.info()
  const opened = await svc.openWindow({ first: info.today, last: info.today })
  await svc.edit({
    id: opened.id,
    edits: [{ from: bp(opened.text.length), to: bp(opened.text.length), insert: text }],
    origin: 'user',
    generation: opened.generation,
  })
}

test('opening a fresh notebook makes an initial commit', async t => {
  const { svc } = await service(t)
  const log = await svc.repository?.log()
  assert.equal(log?.length, 1)
  assert.equal(log?.[0]?.message, 'Opened the notebook')
})

test('typing commits after quiescence, and the message quotes the text', async t => {
  const { svc } = await service(t)
  await type(svc, 'A sentence worth finding again later.\n')

  await wait(500)
  const log = await svc.repository?.log()
  assert.equal(log?.length, 2, 'one new commit')
  assert.match(log?.[0]?.message ?? '', /A sentence worth finding again later\./)
  assert.match(log?.[0]?.message ?? '', /^\d{4}-\d{2}-\d{2}/, 'prefixed by the date touched')
})

test('THE CEILING: continuous writing still commits', async t => {
  // The correction D32 records: quiescence alone fails under precisely the
  // condition this notebook exists for. Writing without pause never reaches
  // quiescence, so without a ceiling an hour of work would never be committed.
  const { svc } = await service(t, { commitQuiesceMs: 10_000, commitMaxMs: 400 })
  const started = Date.now()
  while (Date.now() - started < 700) {
    await type(svc, 'more, ')
    await wait(40)
  }
  const log = await svc.repository?.log()
  assert.ok((log?.length ?? 0) >= 2, `the ceiling fired despite no quiet moment (${log?.length} commits)`)
})

test('session end commits what is outstanding', async t => {
  // The trigger that makes "I wrote for ten minutes and quit" land in the
  // history rather than waiting for a quiescence that never comes.
  const { svc } = await service(t, { commitQuiesceMs: 60_000, commitMaxMs: 60_000 })
  await type(svc, 'Written just before quitting.\n')
  await svc.stop()

  const log = await svc.repository?.log()
  assert.equal(log?.length, 2)
  assert.match(log?.[0]?.message ?? '', /Written just before quitting\./)
})

test('a quiet session adds no commits at all', async t => {
  const { svc } = await service(t)
  await wait(400)
  await svc.stop()
  assert.equal((await svc.repository?.log())?.length, 1, 'still just the initial commit')
})

test('the committed file contains what was typed', async t => {
  // End to end: the point is not that a commit exists but that the text is in it.
  const { svc, root } = await service(t)
  await type(svc, 'Durable prose.\n')
  await svc.stop()

  const log = await svc.repository?.log()
  const oid = log?.[0]?.oid ?? ''
  const info = await svc.info()
  const [y, m] = info.today.split('-')
  const rel = `stream/${y}/${m}/${info.today}.md`
  const inCommit = await svc.repository?.readAt(oid, rel as never)
  assert.match(inCommit ?? '', /Durable prose\./)
  assert.match(await readFile(join(root, rel), 'utf8'), /Durable prose\./)
})

test('the machine-local directory never reaches the history', async t => {
  const { svc } = await service(t)
  await type(svc, 'Something.\n')
  await svc.stop()
  const oid = (await svc.repository?.log())?.[0]?.oid ?? ''
  assert.equal(await svc.repository?.readAt(oid, '.tephra/ui-state.json' as never), null)
  assert.equal(await svc.repository?.readAt(oid, '.tephra/wal' as never), null)
})

async function watched(t: TestContext, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-ext-'))
  const nb = await Notebook.open({ root, lock: false, watch: true })
  const svc = new DocumentService(nb, {
    quiesceMs: 20,
    maxIntervalMs: 60,
    commitQuiesceMs: 120,
    commitMaxMs: 600,
    ...options,
  })
  await svc.startHistory()
  t.after(async () => {
    await svc.stop()
    await nb.close()
    await rm(root, { recursive: true, force: true })
  })
  const info = await svc.info()
  const [y, m] = info.today.split('-')
  await mkdir(join(root, 'stream', y as string, m as string), { recursive: true })
  return { svc, root, today: info.today, rel: `stream/${y}/${m}/${info.today}.md` }
}

test('a file edited outside Tephra is committed while the app is still running', async t => {
  // Measured before this worked: the answer was "not at all until restart".
  // A notebook is left open for days, and hand-editing is a supported way to
  // use it (D5, R26) — so leaving those edits outside the safety net until the
  // next launch would make "the corpus is safe" false for exactly the case the
  // format was designed to allow.
  const { svc, root, rel, today } = await watched(t)
  const before = (await svc.repository?.log())?.length ?? 0

  await writeFile(join(root, rel), `---\ndate: ${today}\n---\n\nTyped in another editor.\n`)
  await wait(900)

  const log = await svc.repository?.log()
  assert.equal(log?.length, before + 1, 'the hand-edit was committed')
  assert.equal(log?.[0]?.message, 'Changes made outside Tephra')
  assert.match((await svc.repository?.readAt(log?.[0]?.oid ?? '', rel as never)) ?? '', /another editor/)
})

test("someone else's edit never ends up quoted in OUR commit message", async t => {
  // The subtler half of the same bug. `onChanged` fires for external changes
  // too, so before the guard a hand-edit set the headline and the next commit
  // triggered by typing quoted text its author never wrote — a history that
  // misattributes both edits at once.
  const { svc, root, rel, today } = await watched(t)
  await writeFile(join(root, rel), `---\ndate: ${today}\n---\n\nWORDS FROM ELSEWHERE.\n`)
  await wait(500)

  await type(svc, 'My own sentence.\n')
  await svc.stop()

  const log = await svc.repository?.log()
  const ours = log?.find(c => c.message.includes('My own sentence'))
  assert.ok(ours !== undefined, 'our typing produced its own commit')
  assert.doesNotMatch(ours.message, /WORDS FROM ELSEWHERE/, 'and it quotes only what we wrote')
  assert.ok(
    log?.some(c => c.message === 'Changes made outside Tephra'),
    'the hand-edit is recorded, separately',
  )
})

test('REGRESSION: git’s own directory is never committed, and never feeds the tier', async t => {
  // Found by inspecting a real repository rather than by any assertion: HEAD
  // contained `.git/index`, `.git/refs/heads/main` and loose objects. The
  // repository lives INSIDE the notebook, so the watcher sees it — and since
  // every commit rewrites those files, each commit reported an external change
  // that scheduled another commit. A feedback loop that also made a clean tree
  // impossible.
  const { svc, root, rel, today } = await watched(t)
  await writeFile(join(root, rel), `---\ndate: ${today}\n---\n\nOne edit.\n`)
  await wait(900)

  const tracked = execFileSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', 'HEAD'], {
    encoding: 'utf8',
  })
  assert.doesNotMatch(tracked, /\.git\//, 'the repository is not inside its own history')
  assert.doesNotMatch(tracked, /\.tephra\//, 'nor is the machine-local state')
  assert.match(tracked, /stream\//, 'but the notebook is')

  const settled = (await svc.repository?.log())?.length ?? 0
  await wait(700) // long enough for another tier cycle, if one were coming
  assert.equal((await svc.repository?.log())?.length, settled, 'the tier came to rest')

  assert.equal(
    execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
    '',
    'and the tree can actually reach clean',
  )
})
