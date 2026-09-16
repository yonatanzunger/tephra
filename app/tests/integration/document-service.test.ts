// The service that sits behind IPC. Electron-free by design, so the ordering
// guarantee — the part that is subtly wrong in a way no manual test notices —
// can actually be exercised.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { NotebookService, type ServiceOptions } from '../../src/main/services/notebook-service.ts'
import { StreamDocument } from '../../src/main/x/documents/kinds/stream.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import {
  ONLY_SEGMENT, STREAM_ID,
  type WindowPosition, type DateKey, type DocumentId, type VersionId,
} from '../../src/shared/document-api.ts'
import { pt } from '../support/text.ts'

const wp = (n: number): WindowPosition => n as WindowPosition

async function fixture(t: TestContext, options: ServiceOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-svc-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  t.after(async () => {
    // **Stop the service, then close the notebook.** The write tiers are
    // timers; one nobody cancels holds the process open for its whole
    // interval after the tests have passed — which for a fixture that sets
    // a long one is a minute of wall clock for half a second of work. The
    // app does this on quit (D32); a test that starts a service is a
    // process that has to do it too.
    await service.stop()
    await nb.close()
  })
  const service = new NotebookService(nb, options)
  const today = StreamDocument.today()
  const snapshot = await service.text.openWindow({ first: today, last: today })
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
      service.text.edit({
        id: snapshot.id,
        edits: [{ from: wp(at), to: wp(at), insert: pt(ch) }],
        origin: 'user',
        generation: 1 as never,
        heard: 0,
      }),
    )
    at += 1
  }
  const acks = await Promise.all(pending)
  const last = acks[acks.length - 1] as { length: number }
  assert.equal(last.length, 10)

  const window = await service.text.openWindow({ first: StreamDocument.today(), last: StreamDocument.today() })
  assert.equal(window.text, 'abcdefghij', 'characters landed in composition order')
})

test('a failed edit does not wedge the queue behind it', async t => {
  const { service, snapshot } = await fixture(t)
  await assert.rejects(() =>
    service.text.edit({ id: 9999 as never, edits: [], origin: 'user', generation: 1 as never , heard: 0}),
  )
  const ack = await service.text.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('still works') }],
    origin: 'user',
    generation: 1 as never,
    heard: 0,
  })
  assert.equal(ack.length, 'still works'.length)
})

test('the ack reports the length main actually holds', async t => {
  // The renderer compares this against its own buffer; a wrong number here is
  // worse than none, because it would make the two silently disagree.
  const { service, snapshot } = await fixture(t)
  const ack = await service.text.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('twelve chars') }],
    origin: 'user',
    generation: 1 as never,
    heard: 0,
  })
  assert.equal(ack.length, 12)
})

test('pushed messages reach every attached sink and stop when detached', async t => {
  const { service, snapshot } = await fixture(t)
  const seen: { channel: string }[] = []
  const detach = service.addSink({ send: channel => seen.push({ channel }) })

  // A change from elsewhere — not from this window — must be pushed out.
  await service.text.undo()
  await service.text.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('x') }],
    origin: 'user',
    generation: 1 as never,
    heard: 0,
  })
  await service.text.undo()
  assert.ok(seen.length > 0, 'undo reached the renderer')

  detach()
  const before = seen.length
  await service.text.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('y') }],
    origin: 'user',
    generation: 1 as never,
    heard: 0,
  })
  await service.text.undo()
  assert.equal(seen.length, before, 'a detached sink hears nothing')
})

test('flush writes through the service, and the file is on disk', async t => {
  const { service, snapshot, root, today } = await fixture(t)
  await service.text.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('persisted\n') }],
    origin: 'user',
    generation: 1 as never,
    heard: 0,
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
  await service.text.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('unprompted\n') }],
    origin: 'user',
    generation: 1 as never,
    heard: 0,
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
    await service.text.edit({
      id: snapshot.id,
      edits: [{ from: wp(at), to: wp(at), insert: pt('x') }],
      origin: 'user',
      generation: 1 as never,
      heard: 0,
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

  await service.text.edit({
    id: snapshot.id,
    generation: snapshot.generation,
    edits: [{ from: wp(0), to: wp(0), insert: pt('The good version.\n') }],
    origin: 'user',
        heard: 0,
      })
  await service.flush()
  const first = (await service.repository?.save('first')) as VersionId

  const after = await service.text.openWindow({ first: today, last: today })
  await service.text.edit({
    id: after.id,
    generation: after.generation,
    edits: [{ from: wp(0), to: wp(0), insert: pt('A regrettable addition.\n') }],
    origin: 'user',
        heard: 0,
      })
  await service.flush()
  await service.repository?.save('second')

  const report = await service.pastVersions.restore(first)
  assert.equal(report.version, first)
  const now = await readFile(join(root, dayFile(today)), 'utf8')
  assert.match(now, /The good version\./)
  assert.doesNotMatch(now, /regrettable/, 'the restore did not take')

  // Three versions, and the regrettable one is still readable — nothing was
  // rewritten, which is the promise the purge procedure depends on too.
  // Four: opening the notebook is itself a version, then first, second, and
  // the restore. Nothing was rewritten — which is the promise the purge
  // procedure depends on too.
  const versions = await service.pastVersions.versions()
  assert.equal(versions.length, 4)
  assert.match(versions[0]?.reason ?? '', /^Restored to/)
  assert.match((await service.pastVersions.readDay(versions[1]!.id, today)) ?? '', /regrettable/)
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

  assert.equal(await service.library.documentAt(join(root, 'notes', 'offer.md')), 'notes/offer.md')
})

test('a path outside the notebook is not a document, and says so by being null', async t => {
  // Opening it would mean either editing a file this app does not manage or
  // importing a copy — different acts, both of which deserve to be asked for.
  const { service, root } = await fixture(t)
  const outside = join(root, '..', 'somewhere-else.md')
  await writeFile(outside, '# Not in the notebook\n')
  t.after(() => rm(outside, { force: true }))

  assert.equal(await service.library.documentAt(outside), null)
})

test('and a file inside the notebook that is not a document is not one either', async t => {
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'attachments'), { recursive: true })
  await writeFile(join(root, 'attachments', 'scan.png'), 'not really a png')

  assert.equal(await service.library.documentAt(join(root, 'attachments', 'scan.png')), null)
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

  const documents = await service.nav.documents()
  assert.equal(documents[0]?.title, 'Notebook', 'the one document that is not a file comes first')
  assert.deepEqual(
    documents.slice(1).map(d => d.title).sort(),
    ['The house', 'plain.md'],
    'a title when it has one, and its filename when it does not',
  )
})

// ── files from outside the notebook (MC6) ─────────────────────────────────

/** A file somewhere else on the machine, as a download would be. */
async function downloaded(t: TestContext, name: string, text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tephra-outside-'))
  const path = join(dir, name)
  await writeFile(path, text)
  t.after(() => rm(dir, { recursive: true, force: true }))
  return path
}

test('a file outside the notebook opens, and its id is its absolute path', async t => {
  const { service } = await fixture(t)
  const path = await downloaded(t, 'spec.md', '# A spec\n\nDownloaded, not mine.\n')

  const id = await service.library.documentForFile(path)
  assert.equal(id, path, 'named by where it is, which is what tells it from a corpus path')
})

test('and it opens READ-ONLY, refusing the edit rather than losing it later', async t => {
  // The alternative is the bad one: accept keystrokes, then fail at save time,
  // when what was typed is the only copy.
  const { service } = await fixture(t)
  const path = await downloaded(t, 'spec.md', 'Downloaded.\n')
  const id = (await service.library.documentForFile(path)) as DocumentId

  const meta = await service.text.info(id)
  assert.equal(meta.meta.readOnly, true, 'and it says so, so the surface can too')
  await assert.rejects(
    () =>
      service.corpus.use(id, async doc => {
        const at = doc.positionAt(ONLY_SEGMENT, 0)
        await doc.replace([{ span: { begin: at, end: at }, payload: 'no' as never }], 'user')
      }),
    /outside this notebook/,
  )
})

test('its KIND still comes from its name, so the right surface shows it', async t => {
  // Outside is a place, not a kind. A downloaded fileset is a fileset that
  // happens to be unwritable, and the renderer picks its surface by kind.
  const { service } = await fixture(t)
  const path = await downloaded(t, 'reading.fileset.md', '- [A thing](../x.md)\n')
  const id = (await service.library.documentForFile(path)) as DocumentId

  assert.equal((await service.text.info(id)).meta.kind, 'fileset')
})

test('THE IMPORT: a copy comes in, and the original is left where it was', async t => {
  const { service, root } = await fixture(t)
  const path = await downloaded(t, 'spec.md', '# A spec\n\nWorth keeping.\n')
  const outside = (await service.library.documentForFile(path)) as DocumentId

  const brought = await service.library.importFile(outside)
  await service.flush()

  assert.equal(brought, 'notes/spec.md')
  const copy = await readFile(join(root, 'notes', 'spec.md'), 'utf8')
  assert.match(copy, /Worth keeping\./)
  assert.match(copy, /^---\ntephra: 1\n/, 'and it is a document of ours now, frontmatter and all')
  assert.match(copy, /source: .*spec\.md/, 'saying where it came from (D47)')
  assert.equal(await readFile(path, 'utf8'), '# A spec\n\nWorth keeping.\n', 'the original is untouched')
})

test('and the copy is writable, because being inside is what that means', async t => {
  const { service } = await fixture(t)
  const path = await downloaded(t, 'spec.md', 'Worth keeping.\n')
  const brought = await service.library.importFile((await service.library.documentForFile(path)) as DocumentId)

  assert.equal((await service.text.info(brought)).meta.readOnly, undefined)
  await service.corpus.use(brought, async doc => {
    const at = doc.positionAt(ONLY_SEGMENT, 0)
    await doc.replace([{ span: { begin: at, end: at }, payload: 'Mine now. ' as never }], 'user')
  })
})

test('importing the same file twice makes two notes, not one overwrite', async t => {
  // A second import is a second act. Silently replacing the first would throw
  // away whatever had been done to it since.
  const { service } = await fixture(t)
  const path = await downloaded(t, 'spec.md', 'Downloaded.\n')
  const outside = (await service.library.documentForFile(path)) as DocumentId

  assert.equal(await service.library.importFile(outside), 'notes/spec.md')
  assert.equal(await service.library.importFile(outside), 'notes/spec-2.md')
})

test('importing something already inside the notebook is a no-op, not a copy', async t => {
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'mine.md'), '---\ntephra: 1\nkind: markdown\n---\nMine.\n')

  assert.equal(await service.library.importFile('notes/mine.md' as DocumentId), 'notes/mine.md')
})

// ── the file lifecycle (D13's update-references step, filled in) ───────────

test('a new document is a real file from the first keystroke', async t => {
  // Not an unsaved buffer: Tephra has no unsaved state, so a buffer with no
  // file behind it would be the one losable thing in the app — and it would be
  // the newest thing, which is the worst one to lose.
  //
  // **And it is a DRAFT** (D90): unnamed is a place, not a state. It is
  // versioned, journalled and indexed like everything else; what it lacks is a
  // name somebody chose, and keeping those together is what stops `untitled-7`
  // turning up in the middle of a list of real notes.
  const { service, root } = await fixture(t)
  const id = await service.library.newDocument()

  assert.equal(id, 'drafts/untitled.md')
  assert.match(await readFile(join(root, 'drafts', 'untitled.md'), 'utf8'), /^---\ntephra: 1\n/)
  assert.equal(await service.library.newDocument(), 'drafts/untitled-2.md', 'and the second is its own')
})

test('NAMING A DRAFT IS WHAT MOVES IT, which is why there is no second verb', async t => {
  // *Save…* on a draft and *Rename…* on anything else are the same act, and the
  // name decides both what it is called and where it goes (D90). Reported from
  // use: *renaming requires a "rename" command that goes through a menu with no
  // keyboard shortcut* — this is the other half of that, the half about where an
  // unnamed document sits while you write it.
  const { service, root } = await fixture(t)
  const draft = await service.library.newDocument()
  assert.equal(draft, 'drafts/untitled.md')

  const named = await service.library.renameDocument(draft, 'Notes on the Lima closing')
  assert.equal(named, 'notes/notes-on-the-lima-closing.md')
  // The write tiers are asynchronous by design (D32); the file is the claim.
  await service.flush()
  assert.equal(existsSync(join(root, 'drafts', 'untitled.md')), false, 'it left the drafts')

  // **And it is CALLED what you called it** (D59): the filename is the identity
  // and the frontmatter title is the name. A draft has no title to preserve, so
  // naming it writes one — where an ordinary rename leaves a title-less document
  // without one rather than inventing a heading for it.
  const file = await readFile(join(root, 'notes', 'notes-on-the-lima-closing.md'), 'utf8')
  assert.match(file, /^title: Notes on the Lima closing$/m)
})

test('and a document made WITH a name was never a draft', async t => {
  // Which is the whole rule, read the other way: naming at creation is a place
  // already chosen. Both call sites already do one or the other — the sidebar
  // asks for a name, the File menu does not.
  const { service } = await fixture(t)
  assert.equal(await service.library.newDocument('A thought'), 'notes/a-thought.md')
  assert.equal(
    await service.library.newDocument(undefined, undefined, 'docket'),
    'dockets/untitled.docket.md',
    'and a docket is never a draft: it belongs to one directory by decision (MH1)',
  )
})

test('THE POINT: renaming rewrites the sections that pointed at it', async t => {
  // A fileset links by relative path, so a rename without this leaves every
  // section naming the document pointing at nothing. This is the step that has
  // been present and empty in `branch` since M2 (D13).
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(join(root, 'sections'), { recursive: true })
  await writeFile(join(root, 'notes', 'offer.md'), '---\ntephra: 1\nkind: markdown\n---\nText.\n')
  await writeFile(
    join(root, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n- [The offer](../notes/offer.md) — worth keeping\n',
  )

  const to = await service.library.renameDocument('notes/offer.md' as DocumentId, 'Counter offer')
  await service.flush()

  assert.equal(to, 'notes/counter-offer.md')
  assert.equal(existsSync(join(root, 'notes', 'offer.md')), false, 'the old file is gone')
  const section = await readFile(join(root, 'sections', 'house.fileset.md'), 'utf8')
  assert.match(section, /\.\.\/notes\/counter-offer\.md/, 'and the section points at the new name')
  assert.doesNotMatch(section, /notes\/offer\.md/, 'not at the old one')
  assert.match(section, /The offer/, 'keeping the label somebody chose')
  assert.match(section, /worth keeping/, 'and the summary they wrote')
})

test('the rewritten link is relative to the SECTION, not to the notebook', async t => {
  // The same document is `../notes/x.md` from one section and `x.md` from
  // another, so an entry is matched by what it resolves to and rewritten for
  // the file it is going into.
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'sections', 'deep'), { recursive: true })
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'a.md'), '---\ntephra: 1\nkind: markdown\n---\nA.\n')
  await writeFile(
    join(root, 'sections', 'deep', 'nested.fileset.md'),
    '---\ntephra: 1\nkind: fileset\n---\n- [A](../../notes/a.md)\n',
  )

  await service.library.renameDocument('notes/a.md' as DocumentId, 'Renamed')
  await service.flush()
  const section = await readFile(join(root, 'sections', 'deep', 'nested.fileset.md'), 'utf8')
  assert.match(section, /\.\.\/\.\.\/notes\/renamed\.md/, 'two levels up, as it was')
})

test('a name already taken is not overwritten, it is numbered', async t => {
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'plan.md'), '---\ntephra: 1\nkind: markdown\n---\nThe plan.\n')
  await writeFile(join(root, 'notes', 'other.md'), '---\ntephra: 1\nkind: markdown\n---\nOther.\n')

  assert.equal(await service.library.renameDocument('notes/other.md' as DocumentId, 'Plan'), 'notes/plan-2.md')
  assert.match(await readFile(join(root, 'notes', 'plan.md'), 'utf8'), /The plan/, 'untouched')
})

test('a rename carries unwritten edits with it', async t => {
  // The file is flushed before it moves. Moving yesterday's bytes would lose
  // whatever had been typed since the last write tier ran.
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'draft.md'), '---\ntephra: 1\nkind: markdown\n---\nOld.\n')
  await service.corpus.use('notes/draft.md' as DocumentId, async doc => {
    await doc.setBodyOf(ONLY_SEGMENT, 'Typed, not yet written.\n' as never)
  })

  await service.library.renameDocument('notes/draft.md' as DocumentId, 'Kept')
  assert.match(await readFile(join(root, 'notes', 'kept.md'), 'utf8'), /Typed, not yet written/)
})

test('a duplicate is a second document; the original is left alone', async t => {
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'plan.md'), '---\ntephra: 1\nkind: markdown\n---\nThe plan.\n')

  const copy = await service.library.duplicateDocument('notes/plan.md' as DocumentId, 'Plan v2')
  assert.equal(copy, 'notes/plan-v2.md')
  assert.match(await readFile(join(root, 'notes', 'plan-v2.md'), 'utf8'), /The plan/)
  assert.equal(existsSync(join(root, 'notes', 'plan.md')), true)
})

test('DELETING leaves the entry that named it dangling, and visibly (D7)', async t => {
  // Not the same as rename. An entry pointing at a document somebody deleted is
  // a true statement about the notebook; removing it would edit a curated list
  // on the strength of a guess about what they meant.
  const { service, root } = await fixture(t)
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(join(root, 'sections'), { recursive: true })
  await writeFile(join(root, 'notes', 'gone.md'), '---\ntephra: 1\nkind: markdown\n---\nText.\n')
  await writeFile(
    join(root, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\n---\n- [Was here](../notes/gone.md)\n',
  )

  await service.library.deleteDocument('notes/gone.md' as DocumentId)
  await service.flush()

  assert.equal(existsSync(join(root, 'notes', 'gone.md')), false)
  const tree = await service.nav.sections()
  const entry = tree.entries.flatMap(e => e.children?.entries ?? []).find(e => e.label === 'Was here')
  assert.notEqual(entry, undefined, 'the entry is still there')
  assert.equal(entry?.missing, true, 'and it says it cannot be found')
})

test('the notebook itself cannot be deleted', async t => {
  const { service } = await fixture(t)
  await assert.rejects(() => service.library.deleteDocument(STREAM_ID), /cannot be deleted/)
})

// ── an edit composed against a buffer that has moved (D88) ──────────────────

test('A STALE EDIT IS REFUSED, not applied at offsets that have moved', async t => {
  // **Reported from use, with the sequence** (2026-09-15): type a paragraph,
  // select a phrase, ⌥⌘M, write the comment, Done — then type. The next
  // keystroke landed a few characters from where it belonged, joined a comment's
  // byline to the paragraph above it, and so stopped the block being a
  // blockquote: 210 characters of thread became ordinary prose in main, the
  // window desynchronised, and everything typed afterwards landed 210 characters
  // away.
  //
  // The renderer fires edits without awaiting (D37), so its offsets are always a
  // moment old — which is fine, because its own edits are the only thing moving
  // the text. A change from ELSEWHERE breaks that, and `heard` is what makes it
  // visible: main refuses rather than guessing.
  const { service, snapshot, today } = await fixture(t)
  await service.text.edit({
    id: snapshot.id,
    edits: [{ from: wp(0), to: wp(0), insert: pt('The premise is stated here.\n\nAnd more prose.\n') }],
    origin: 'user',
    generation: snapshot.generation,
    heard: 0,
  })

  // Main writes a comment: a change the renderer has not been told about.
  const w = await service.text.openWindow({ first: today, last: today })
  const anchor = w.text.indexOf('premise')
  const stream = (await service.corpus.use(STREAM_ID, async d => d)) as StreamDocument
  const span = {
    begin: stream.positionAt(today, anchor),
    end: stream.positionAt(today, anchor + 7),
  }
  await service.comments.startComment(span, 'A thought about the premise.')

  // And now the keystroke that was composed before it.
  const ack = await service.text.edit({
    id: w.id,
    edits: [{ from: wp(w.text.length), to: wp(w.text.length), insert: pt('S') }],
    origin: 'user',
    generation: w.generation,
    heard: w.heard,
  })

  assert.equal(ack.refused, true, 'the edit was applied at stale offsets')
  // **And the document is untouched by it**, which is the whole point: the
  // character is lost and the file is right, where before the character landed
  // and the file was wrong.
  const after = await service.text.openWindow({ first: today, last: today })
  assert.equal(after.text.includes('S\n'), false, JSON.stringify(after.text))
  // The refusal is the claim; `heard` on a freshly opened window is that
  // window's own count and says nothing about the one that was refused.
})

test('and an edit that is merely LATE is still applied, which is ordinary typing', async t => {
  // Several edits are in flight at once and all carry the same generation; the
  // check must not refuse them. `heard` counts announcements only, so typing
  // — which the window originates — never moves it.
  const { service, snapshot } = await fixture(t)
  for (const ch of 'abcdef') {
    const ack = await service.text.edit({
      id: snapshot.id,
      edits: [{ from: wp(0), to: wp(0), insert: pt(ch) }],
      origin: 'user',
      generation: snapshot.generation,
      heard: snapshot.heard,
    })
    assert.notEqual(ack.refused, true, `refused ${ch} — typing is not a stale edit`)
  }
})
