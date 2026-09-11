// A docket as a document (MH1, D68, D72).
//
// **The claims are about the file**, because that is what survives: a verb
// rewrites one matter and disturbs nothing around it, an id is minted once and
// kept forever, and a hand-written docket is adopted rather than reformatted.
//
// The kind is `SegmentedDocument` with the segmentation removed, so undo, spans,
// the journal and the rest are inherited and tested elsewhere. What is new is the
// block as the unit of edit.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { DocketDocument } from '../../src/main/x/documents/kinds/docket.ts'
import { kindOf, type RelPath } from '../../src/main/w/layout.ts'
import type { DocumentId } from '../../src/shared/document-api.ts'

const REL = 'house.docket.md' as RelPath
const ID = REL as string as DocumentId

async function docket(t: TestContext, body?: string) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-docket-'))
  if (body !== undefined) await writeFile(join(root, REL), body)
  const nb = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => nb.close())
  const doc = new DocketDocument(nb, ID)
  return {
    root,
    doc,
    async file(): Promise<string> {
      await doc.flush()
      return readFile(join(root, REL), 'utf8').catch(() => '')
    },
  }
}

test('a docket is a kind, declared by its suffix', () => {
  assert.equal(kindOf('house.docket.md' as RelPath), 'docket')
  assert.equal(kindOf('misc.docket.md' as RelPath), 'docket')
  // And nothing else is caught by it.
  assert.equal(kindOf('notes/docket-notes.md' as RelPath), 'markdown')
})

test('a docket that does not exist yet is an empty one, not an error', async t => {
  const { doc } = await docket(t)
  assert.deepEqual(await doc.matters(), [])
})

test('THE POINT: a matter is added, and the file says so', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('The oven is broken')
  const text = await file()
  assert.match(text, /^## The oven is broken$/m)
  assert.match(text, /^when: —$/m)
  assert.match(text, new RegExp(`<!--tephra:matter ${id} \\d+ 0-->`))
  assert.equal((await doc.matters())[0]?.name, 'The oven is broken')
})

test('and it is dated on arrival, which cannot be reconstructed later', async t => {
  const { doc } = await docket(t)
  const before = Math.floor(Date.now() / 1000)
  await doc.add('Repaint the house')
  const matter = (await doc.matters())[0]
  assert.ok(matter !== undefined)
  assert.ok(matter.arrived >= before, 'a move records no date of its own, so this one must')
  assert.equal(matter.declines, 0)
})

test('THE BLOCK RULE: editing one matter leaves the others byte-identical', async t => {
  const { doc, file } = await docket(t, [
    '---', 'tephra: 1', 'kind: docket', '---', '',
    '## The oven is broken',
    'when: —',
    'quoted: 480 for the part',
    '<!--tephra:matter aaaa1111 1757462400 0-->',
    '',
    '',
    '## Repaint the house',
    'when: —',
    '<!--tephra:matter bbbb2222 1757462400 0-->',
    '',
    '## Change the air filters',
    'when: every 90d',
    '<!--tephra:matter cccc3333 1757462400 0-->',
    '',
  ].join('\n'))

  await doc.setWhen('bbbb2222', { kind: 'season', from: '2026-03', until: '2026-05' })
  const text = await file()

  assert.match(text, /^## Repaint the house\nwhen: 2026-03\.\.2026-05$/m)
  // Everything else, exactly as it was — including somebody's own `quoted:` line
  // and the two blank lines they left above the edited block.
  assert.match(text, /^quoted: 480 for the part$/m)
  assert.match(text, /\n\n\n## Repaint the house/)
  assert.match(text, /^## Change the air filters\nwhen: every 90d$/m)
  assert.equal((await doc.matters()).length, 3)
})

test('a hand-written docket is adopted, not reformatted', async t => {
  // Somebody started this in another editor. Nothing has ids; Tephra reads it,
  // and only the matter it touches gains one.
  const { doc, file } = await docket(t, [
    '# The house', '', 'Everything true about it.', '',
    '## The gate sticks', 'when: 2026-10-01', '',
    '## The oven is broken', 'when: —', '',
  ].join('\n'))

  const matters = await doc.matters()
  assert.deepEqual(matters.map(m => m.name), ['The gate sticks', 'The oven is broken'])
  assert.deepEqual(matters.map(m => m.id), [null, null])

  await doc.add('Repaint the house')
  const text = await file()
  // The prose above the first matter survives, and so does the lack of ids on
  // the two that were not touched.
  assert.match(text, /^Everything true about it\.$/m)
  assert.match(text, /^## The gate sticks\nwhen: 2026-10-01$/m)
  assert.equal((await doc.matters()).filter(m => m.id !== null).length, 1)
})

test('ids are unique against the corpus, not merely against this file', async t => {
  const { doc } = await docket(t)
  const mine = await doc.add('One')
  // Whoever holds the index hands in what is taken elsewhere; a document knows
  // only itself (D56's rule, carried).
  const other = await doc.add('Two', undefined, async () => new Set([mine, 'zzzz9999']))
  assert.notEqual(other, mine)
  assert.notEqual(other, 'zzzz9999')
})

// ── the field verbs ────────────────────────────────────────

test('the verbs each rewrite one block', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('The ACM talk', { kind: 'on', date: '2026-11-12' as never })
  await doc.tagMatter(id, 'speaking')
  await doc.setOwner(id, 'me')
  await doc.setLink(id, '../notes/acm.md')
  await doc.rename(id, 'The ACM keynote')

  const matter = (await doc.matters())[0]
  assert.ok(matter !== undefined)
  assert.equal(matter.name, 'The ACM keynote')
  assert.deepEqual(matter.tags, ['speaking'])
  assert.equal(matter.owner, 'me')
  assert.equal(matter.link, '../notes/acm.md')
  assert.deepEqual(matter.when, { kind: 'on', date: '2026-11-12' })
  // And the id survived every one of them.
  assert.equal(matter.id, id)
  assert.match(await file(), new RegExp(`matter ${id} `))
})

test('untagging is not a rewrite of the whole docket', async t => {
  const { doc } = await docket(t)
  const a = await doc.add('One')
  const b = await doc.add('Two')
  await doc.tagMatter(a, 'house')
  await doc.tagMatter(b, 'house')
  await doc.untagMatter(a, 'house')
  const matters = await doc.matters()
  assert.deepEqual(matters.find(m => m.id === a)?.tags, [])
  assert.deepEqual(matters.find(m => m.id === b)?.tags, ['house'])
})

test('a name is required, and whitespace is not a name', async t => {
  const { doc } = await docket(t)
  await assert.rejects(() => doc.add('   '), /needs a name/)
  const id = await doc.add('Real')
  await assert.rejects(() => doc.rename(id, ''), /needs a name/)
})

test('a verb naming a matter that is not here says so', async t => {
  const { doc } = await docket(t)
  await assert.rejects(() => doc.rename('nope1234', 'x'), /no matter nope1234/)
})

// ── the move, and the count ────────────────────────────────

test('THE MOVE: removing and adopting keeps the id, which is the promise', async t => {
  // D71: a matter moves between dockets and its history stays continuous, so a
  // reference to it still resolves. The id is what makes that true.
  const { doc } = await docket(t)
  const id = await doc.add('Fix the gate')
  await doc.tagMatter(id, 'house')
  const taken = await doc.remove(id)
  assert.deepEqual(await doc.matters(), [])
  assert.equal(taken.id, id)

  const other = await docket(t)
  await other.doc.adopt(taken)
  const landed = (await other.doc.matters())[0]
  assert.equal(landed?.id, id, 'the same matter, somewhere else')
  assert.deepEqual(landed?.tags, ['house'])
})

test('and adopting re-dates arrival, because that is what it means', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('Fix the gate')
  const taken = await doc.remove(id)
  const aged = { ...taken, arrived: 1 }
  const other = await docket(t)
  await other.doc.adopt(aged)
  assert.ok(((await other.doc.matters())[0]?.arrived ?? 0) > 1, 'when it appeared HERE')
})

test('removing a matter takes its blank line with it', async t => {
  const { doc, file } = await docket(t)
  const a = await doc.add('One')
  await doc.add('Two')
  await doc.remove(a)
  const text = await file()
  assert.ok(!text.includes('## One'))
  assert.match(text, /^## Two$/m)
  assert.ok(!/\n\n\n/.test(text.split('---').pop() ?? ''), 'no hole left behind')
})

test('declines accrue, because the graveyard will have no criterion otherwise', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('Someday, the shed')
  await doc.decline(id)
  await doc.decline(id)
  assert.equal((await doc.matters())[0]?.declines, 2)
})

// ── making one ─────────────────────────────────────────────

test('THE COLD START: the first docket goes to `dockets/`, with no section named', async t => {
  // Without this the first docket was impossible from the UI: the sidebar's
  // `Dockets` listing only exists once a docket does, so there was no listing
  // to make one from. File ▸ New Docket is the door, and it names no section.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  assert.equal(id, 'dockets/the-house.docket.md')
  assert.equal(kindOf(id as string as RelPath), 'docket')
})

test('and a file made FROM the dockets listing is a docket, with no kind named', async t => {
  // The other half of one rule. The sidebar passes the listing's own base path
  // and nothing else; getting a markdown file out of the dockets listing would
  // be a surprise nobody asked for.
  const { service } = await serviced(t)
  const id = await service.newDocument('Birthdays', 'dockets/_index.fileset.md')
  assert.equal(id, 'dockets/birthdays.docket.md')
})

test('while a file made anywhere else is still ordinary markdown', async t => {
  const { service } = await serviced(t)
  assert.equal(await service.newDocument('A thought'), 'notes/a-thought.md')
  assert.equal(await service.newDocument('A list', undefined, 'todo'), 'notes/a-list.todo.md')
})

test('a new docket opens as an empty one, and can be worked at once', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  assert.deepEqual(await service.docketMatters(id), [])
  const matter = await service.docketAdd(id, 'The oven is broken')
  const matters = await service.docketMatters(id)
  assert.equal(matters.length, 1)
  assert.equal(matters[0]?.id, matter)
  assert.equal(matters[0]?.name, 'The oven is broken')
  assert.deepEqual(matters[0]?.when, { kind: 'standing' })
})

test('and `when` is parsed in main, so a bad one is refused rather than stored', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  await assert.rejects(
    () => service.docketAdd(id, 'Something', 'next Tuesdayish'),
    /not a date, a range, or a rule/,
  )
  // And the docket is untouched: a refused verb writes nothing.
  assert.deepEqual(await service.docketMatters(id), [])
})

test('every docket is listed, by what it is CALLED', async t => {
  const { service } = await serviced(t)
  await service.newDocument('The house', undefined, 'docket')
  await service.newDocument('Speaking engagements', undefined, 'docket')
  const rows = await service.dockets()
  assert.deepEqual(rows.map(r => r.title), ['Speaking engagements', 'The house'])
})

async function serviced(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-docket-svc-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  const { DocumentService } = await import('../../src/main/document-service.ts')
  const service = new DocumentService(nb, { history: false })
  t.after(async () => {
    await service.stop()
    await nb.close()
  })
  await service.info()
  return { root, service }
}

// ── renaming ───────────────────────────────────────────────

test('THE BUG: a rename must not change what the document IS', async t => {
  // `#freeName` read `.fileset.md` or else `.md`, so renaming a docket produced
  // `the-big-house.md` — silently, since the content is markdown either way and
  // nothing errors. Reported from use as *"rename does nothing"*, because what
  // it actually did was take the kind off: the docket editor vanished and the
  // same file opened as raw text.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const to = await service.renameDocument(id, 'The big house')
  assert.equal(to, 'dockets/the-big-house.docket.md')
  assert.equal(kindOf(to as string as RelPath), 'docket')
})

test('and an overall task list had the same bug, since MT7', async t => {
  const { service } = await serviced(t)
  const list = await service.newDocument('Blog posts', undefined, 'todo')
  const to = await service.renameDocument(list, 'Posts to write')
  assert.equal(to, 'notes/posts-to-write.todo.md')
  assert.equal(kindOf(to as string as RelPath), 'todo')
})

test('a fileset and a plain note keep theirs too', async t => {
  const { service } = await serviced(t)
  const note = await service.newDocument('A thought')
  assert.equal(await service.renameDocument(note, 'A better thought'), 'notes/a-better-thought.md')
})

test('THE ORDER MATTERS: `.todo.md` ends with `.md`', async t => {
  // Which is why the suffixes are tried longest-first. A shorter match wins
  // otherwise and takes the kind off — the exact bug, one line further down.
  const { service } = await serviced(t)
  const list = await service.newDocument('Ideas', undefined, 'todo')
  assert.match(await service.renameDocument(list, 'Later'), /\.todo\.md$/)
})

test('renaming a docket keeps its matters, ids and all', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const matter = await service.docketAdd(id, 'The oven is broken', '2026-10-14')
  const to = await service.renameDocument(id, 'The big house')
  const matters = await service.docketMatters(to)
  assert.equal(matters.length, 1)
  assert.equal(matters[0]?.id, matter, 'a rename moves the file; it does not remake the contents')
  assert.deepEqual(matters[0]?.when, { kind: 'on', date: '2026-10-14' })
})
