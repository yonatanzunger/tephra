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
import { STANDING } from '../../src/shared/kinds/docket.ts'
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

// ── run-ups on a matter (MH1, H4) ──────────────────────────

test('THE RECONCILER: a matter carries its own run-up', async t => {
  // H4's per-matter window is what lets a complete record project onto a short
  // horizon — a birthday wants months, a filter wants days, and no global
  // setting can say both.
  const { doc, file } = await docket(t)
  const id = await doc.add('Service the boiler', { kind: 'on', date: '2026-10-14' as never })
  await doc.addTrigger(id, '2w', 'book the boiler service')
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.triggers, [
    { offset: '-2w', effect: 'task', text: 'book the boiler service' },
  ])
  assert.match(await file(), /^triggers:\n- -2w task: book the boiler service$/m)
})

test('and several are kept in the order they FIRE, not the order typed', async t => {
  // Two run-ups in the order they happened to be said is a list nobody can
  // scan; earliest-first is the order they are read and the order they will run.
  const { doc } = await docket(t)
  const id = await doc.add('The ACM talk', { kind: 'on', date: '2026-11-12' as never })
  await doc.addTrigger(id, '2w', 'draft the slides')
  await doc.addTrigger(id, '2m', 'start the outline')
  await doc.addTrigger(id, '3d', 'print the handout')
  assert.deepEqual((await doc.matters())[0]?.triggers.map(t => t.offset), ['-2m', '-2w', '-3d'])
})

test('an offset after the date sorts last, because it fires last', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A trip', { kind: 'on', date: '2026-11-12' as never })
  await doc.addTrigger(id, '+3d', 'file the expenses')
  await doc.addTrigger(id, '1w', 'pack')
  assert.deepEqual((await doc.matters())[0]?.triggers.map(t => t.offset), ['-1w', '+3d'])
})

test('a run-up that is not an offset is refused, and nothing is written', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('A thing')
  await assert.rejects(() => doc.addTrigger(id, 'soon', 'do it'), /not an offset/)
  await assert.rejects(() => doc.addTrigger(id, '2w', '   '), /needs to say what happens/)
  assert.deepEqual((await doc.matters())[0]?.triggers, [])
  assert.ok(!(await file()).includes('triggers:'))
})

test('dropping one leaves the others and the rest of the matter alone', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('The ACM talk', { kind: 'on', date: '2026-11-12' as never })
  await doc.tagMatter(id, 'speaking')
  await doc.addTrigger(id, '2w', 'draft the slides')
  await doc.addTrigger(id, '3d', 'print the handout')
  await doc.removeTrigger(id, 0)
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.triggers.map(t => t.text), ['print the handout'])
  assert.deepEqual(matter?.tags, ['speaking'])
  assert.deepEqual(matter?.when, { kind: 'on', date: '2026-11-12' })
  assert.equal(matter?.id, id)
})

test('THE MEETING CASE: recurrence and its run-up, authored together', async t => {
  // *The air filters need changing every ninety days, and remind me three days
  // before* — which is the whole of what a planning conversation has to be able
  // to say. Nothing fires until MH3; saying it is what MH1 owes.
  const { doc, file } = await docket(t)
  const id = await doc.add('Change the air filters', { kind: 'every', n: 90, unit: 'd' })
  await doc.addTrigger(id, '3d', 'change the air filters #house')
  const text = await file()
  assert.match(text, /^when: every 90d$/m)
  assert.match(text, /^- -3d task: change the air filters #house$/m)
  // And the whole thing survives a reread, which is what makes it a record.
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.when, { kind: 'every', n: 90, unit: 'd' })
  assert.equal(matter?.triggers.length, 1)
})

test('and completion-relative recurrence, which is the other household shape', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('Service the car', { kind: 'after', n: 6, unit: 'm' })
  await doc.addTrigger(id, '2w', 'book the service')
  assert.match(await file(), /^when: 6m after done$/m)
  assert.deepEqual((await doc.matters())[0]?.when, { kind: 'after', n: 6, unit: 'm' })
})

// ── notes on a matter (MH1) ────────────────────────────────

test('THE NOTE: prose under a matter, kept and nothing else touched', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('The oven is broken')
  await doc.tagMatter(id, 'house')
  await doc.setNotes(id, [
    'The element went on Tuesday.',
    'Quoted 480 for the part, plus labour.',
  ])
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.notes, ['The element went on Tuesday.', 'Quoted 480 for the part, plus labour.'])
  assert.deepEqual(matter?.tags, ['house'], 'and the rest of the matter is untouched')
  assert.match(await file(), /^Quoted 480 for the part, plus labour\.$/m)
})

test('a note is replaced wholesale, which is how the task list does it too', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('The oven is broken')
  await doc.setNotes(id, ['first'])
  await doc.setNotes(id, ['second', 'third'])
  assert.deepEqual((await doc.matters())[0]?.notes, ['second', 'third'])
})

test('and empty lines are dropped, because a note of nothing is no note', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('A thing')
  await doc.setNotes(id, ['  ', '', 'something'])
  assert.deepEqual((await doc.matters())[0]?.notes, ['something'])
  await doc.setNotes(id, [''])
  assert.deepEqual((await doc.matters())[0]?.notes, [])
  assert.ok(!(await file()).includes('something'))
})

test('a note coexists with a run-up and neither eats the other', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('Service the boiler', { kind: 'on', date: '2026-10-14' as never })
  await doc.addTrigger(id, '2w', 'book it')
  await doc.setNotes(id, ['The firm on the high street did the last one.'])
  const matter = (await doc.matters())[0]
  assert.equal(matter?.triggers.length, 1)
  assert.deepEqual(matter?.notes, ['The firm on the high street did the last one.'])
})

// ── anchored recurrence (MH1, H7) ──────────────────────────

test('THE ANCHOR: a recurrence records what it recurs from', async t => {
  // *Every ninety days* is not a schedule until you know ninety days from what,
  // and MH3 cannot reconstruct it — so it is recorded now or never.
  const { doc, file } = await docket(t)
  const id = await doc.add('Change the air filters', {
    kind: 'every', n: 90, unit: 'd', from: '2026-10-01' as never,
  })
  assert.match(await file(), /^when: every 90d from 2026-10-01$/m)
  assert.deepEqual((await doc.matters())[0]?.when,
    { kind: 'every', n: 90, unit: 'd', from: '2026-10-01' })
  void id
})

test('and setting one later is how a conversation actually goes', async t => {
  // *Every 90 days* is said first; *starting in October* is said second.
  const { doc } = await docket(t)
  const id = await doc.add('Change the air filters', { kind: 'every', n: 90, unit: 'd' })
  assert.deepEqual((await doc.matters())[0]?.when, { kind: 'every', n: 90, unit: 'd' })
  await doc.setWhen(id, { kind: 'every', n: 90, unit: 'd', from: '2026-10-01' as never })
  assert.deepEqual((await doc.matters())[0]?.when,
    { kind: 'every', n: 90, unit: 'd', from: '2026-10-01' })
})

test('an impossible date never reaches the file', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  for (const said of ['2026-02-30', '2026-13-01', '2026-11-14..2026-11-12']) {
    await assert.rejects(() => service.docketAdd(id, 'A thing', said), /not a date/)
  }
  assert.deepEqual(await service.docketMatters(id), [])
})

// ── sections (MH1) ─────────────────────────────────────────

/** A docket with three matters in it, to divide up. */
async function three(t: TestContext) {
  const made = await docket(t)
  const boiler = await made.doc.add('Service the boiler')
  const oven = await made.doc.add('The oven is broken')
  const kitchen = await made.doc.add('Redo the kitchen')
  return { ...made, boiler, oven, kitchen }
}

const named = async (doc: DocketDocument): Promise<unknown> =>
  (await doc.sections()).map(s => [s.name, s.matters.map(m => m.name)])

test('THE SECTION: a docket with none reads as one undivided run', async t => {
  const { doc } = await three(t)
  assert.deepEqual(await named(doc), [['', ['Service the boiler', 'The oven is broken', 'Redo the kitchen']]])
})

test('and adding one divides it without moving anything', async t => {
  const { doc, file } = await three(t)
  await doc.addSection('Major projects')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken', 'Redo the kitchen']],
    ['Major projects', []],
  ])
  // An empty section is a real state: it is said before it is filled.
  assert.match(await file(), /^## Major projects$/m)
})

test('a matter moves into a section, and goes a heading deeper with it', async t => {
  const { doc, file, kitchen } = await three(t)
  await doc.addSection('Major projects')
  await doc.moveMatter(kitchen, 'Major projects')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken']],
    ['Major projects', ['Redo the kitchen']],
  ])
  const text = await file()
  assert.match(text, /^### Redo the kitchen$/m, 'inside a section, so one level down')
  assert.match(text, /^## Service the boiler$/m, 'and the undivided ones are untouched')
})

test('THE ID SURVIVES A MOVE, which is what makes it a move', async t => {
  const { doc, kitchen } = await three(t)
  await doc.addSection('Major projects')
  await doc.moveMatter(kitchen, 'Major projects')
  const moved = (await doc.matters()).find(m => m.name === 'Redo the kitchen')
  assert.equal(moved?.id, kitchen)
})

test('and everything on it survives the move too', async t => {
  const { doc, kitchen } = await three(t)
  await doc.setWhen(kitchen, { kind: 'every', n: 90, unit: 'd', from: '2026-10-01' as never })
  await doc.tagMatter(kitchen, 'house')
  await doc.addTrigger(kitchen, '2w', 'get quotes')
  await doc.setNotes(kitchen, ['Three firms quoted.'])
  await doc.addSection('Major projects')
  await doc.moveMatter(kitchen, 'Major projects')
  const moved = (await doc.matters()).find(m => m.id === kitchen)
  assert.deepEqual(moved?.when, { kind: 'every', n: 90, unit: 'd', from: '2026-10-01' })
  assert.deepEqual(moved?.tags, ['house'])
  assert.equal(moved?.triggers.length, 1)
  assert.deepEqual(moved?.notes, ['Three firms quoted.'])
})

test('a matter moves back out to the undivided run', async t => {
  const { doc, file, kitchen } = await three(t)
  await doc.addSection('Major projects')
  await doc.moveMatter(kitchen, 'Major projects')
  await doc.moveMatter(kitchen, '')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken', 'Redo the kitchen']],
    ['Major projects', []],
  ])
  assert.match(await file(), /^## Redo the kitchen$/m, 'and comes back up a level')
})

test('and before another matter, which is how *above that one* is said', async t => {
  const { doc, boiler, kitchen } = await three(t)
  await doc.moveMatter(kitchen, '', boiler)
  assert.deepEqual(await named(doc), [
    ['', ['Redo the kitchen', 'Service the boiler', 'The oven is broken']],
  ])
})

test('NUDGE: one place up, one place down', async t => {
  const { doc, oven } = await three(t)
  assert.equal(await doc.nudgeMatter(oven, -1), true)
  assert.deepEqual(await named(doc), [
    ['', ['The oven is broken', 'Service the boiler', 'Redo the kitchen']],
  ])
  assert.equal(await doc.nudgeMatter(oven, 1), true)
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken', 'Redo the kitchen']],
  ])
  assert.equal(await doc.nudgeMatter(oven, 1), true)
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'Redo the kitchen', 'The oven is broken']],
  ])
})

test('and it says NO at the ends rather than doing nothing quietly', async t => {
  const { doc, boiler, kitchen } = await three(t)
  assert.equal(await doc.nudgeMatter(boiler, -1), false, 'already first')
  assert.equal(await doc.nudgeMatter(kitchen, 1), false, 'already last')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken', 'Redo the kitchen']],
  ])
})

test('THE SECTION EDGE: a nudge stops at it rather than reclassifying', async t => {
  // Pressing *down* one more time must not move a matter out of *periodic
  // maintenance* and into *major projects*. Crossing is `moveMatter`, which
  // says where.
  const { doc, boiler, oven, kitchen } = await three(t)
  await doc.addSection('Major projects')
  await doc.moveMatter(kitchen, 'Major projects')
  await doc.moveMatter(oven, 'Major projects')
  assert.equal(await doc.nudgeMatter(boiler, 1), false, 'last in the undivided run')
  assert.equal(await doc.nudgeMatter(kitchen, -1), false, 'first in its section')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler']],
    ['Major projects', ['Redo the kitchen', 'The oven is broken']],
  ])
})

test('a section is renamed, and keeps what is in it', async t => {
  const { doc, file, kitchen } = await three(t)
  await doc.addSection('Big jobs')
  await doc.moveMatter(kitchen, 'Big jobs')
  await doc.renameSection('Big jobs', 'Major projects')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken']],
    ['Major projects', ['Redo the kitchen']],
  ])
  assert.doesNotMatch(await file(), /Big jobs/)
})

test('DELETING A HEADING MUST NOT DELETE A HOUSE', async t => {
  const { doc, file, kitchen } = await three(t)
  await doc.addSection('Major projects')
  await doc.moveMatter(kitchen, 'Major projects')
  await doc.removeSection('Major projects')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken', 'Redo the kitchen']],
  ])
  const text = await file()
  assert.doesNotMatch(text, /Major projects/)
  assert.match(text, /^## Redo the kitchen$/m, 'promoted back to the top level')
})

test('and an orphan joins the section that now contains it, at its depth', async t => {
  const { doc, file, oven, kitchen } = await three(t)
  await doc.addSection('Periodic maintenance')
  await doc.addSection('Major projects')
  await doc.moveMatter(oven, 'Periodic maintenance')
  await doc.moveMatter(kitchen, 'Major projects')
  await doc.removeSection('Major projects')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler']],
    ['Periodic maintenance', ['The oven is broken', 'Redo the kitchen']],
  ])
  // Still one level down, because it is still inside a section.
  assert.match(await file(), /^### Redo the kitchen$/m)
})

test('two sections cannot share a name, because a move names one', async t => {
  const { doc } = await three(t)
  await doc.addSection('Major projects')
  await assert.rejects(() => doc.addSection('Major projects'), /already has a section/)
  await assert.rejects(() => doc.addSection('  '), /needs a name/)
  const first = (await doc.matters())[0]?.id ?? ''
  await assert.rejects(() => doc.moveMatter(first, 'Nowhere'), /no section/)
})

test('A HAND-WRITTEN DOCKET with sections is read as written', async t => {
  const { doc } = await docket(t, [
    '---', 'tephra: 1', 'kind: docket', '---', '',
    '## Periodic maintenance', '',
    '### Service the boiler', 'when: 2026-10-14', '',
    '### Change the air filters', 'when: every 90 days', '',
    '## Major projects', '',
    '### Redo the kitchen', 'when: —', '',
  ].join('\n'))
  assert.deepEqual(await named(doc), [
    ['Periodic maintenance', ['Service the boiler', 'Change the air filters']],
    ['Major projects', ['Redo the kitchen']],
  ])
  // Written in words, and read: the file is a person's to type in.
  const filters = (await doc.matters()).find(m => m.name === 'Change the air filters')
  assert.deepEqual(filters?.when, { kind: 'every', n: 90, unit: 'd' })
})

test('A DOCKET FROM BEFORE SECTIONS EXISTED still reads as its matters', async t => {
  // Every matter at `##`, which is what the format wrote for a whole phase. A
  // rule based on heading DEPTH would read these as empty sections and lose a
  // house; the rule is based on content, and cannot.
  const { doc } = await docket(t, [
    '---', 'tephra: 1', 'kind: docket', '---', '',
    '## Service the boiler', 'when: 2026-10-14', '<!--tephra:matter aaaa1111 1757462400 0-->', '',
    '## The oven is broken', 'when: —', '<!--tephra:matter bbbb2222 1757462400 0-->', '',
  ].join('\n'))
  assert.deepEqual(await named(doc), [['', ['Service the boiler', 'The oven is broken']]])
  assert.equal((await doc.matters()).length, 2)
})

test('and a verb on one of those leaves it at the depth it was written', async t => {
  const { doc, file } = await docket(t, [
    '---', 'tephra: 1', 'kind: docket', '---', '',
    '## Service the boiler', 'when: 2026-10-14', '<!--tephra:matter aaaa1111 1757462400 0-->', '',
  ].join('\n'))
  await doc.setOwner('aaaa1111', 'me')
  assert.match(await file(), /^## Service the boiler$/m, 'editing an owner must not reshape the outline')
})

test('THE BLOCK RULE HOLDS ACROSS A MOVE: the others stay byte-identical', async t => {
  const { doc, file, kitchen } = await three(t)
  await doc.addSection('Major projects')
  const before = await file()
  const untouched = before.split('## Redo the kitchen')[0] as string
  await doc.moveMatter(kitchen, 'Major projects')
  const after = await file()
  assert.ok(after.startsWith(untouched), `\n--- was ---\n${untouched}\n--- now ---\n${after}`)
})

test('and the file stays tidy: one blank line between blocks, no holes', async t => {
  const { doc, file, oven, kitchen } = await three(t)
  await doc.addSection('Major projects')
  await doc.moveMatter(kitchen, 'Major projects')
  await doc.moveMatter(oven, 'Major projects')
  await doc.nudgeMatter(oven, -1)
  const text = await file()
  assert.doesNotMatch(text, /\n\n\n/, 'no gaps opened by a splice')
  assert.doesNotMatch(text, /-->\n##/, 'and none closed up either')
  assert.equal(text.match(/^#{2,3} /gm)?.length, 4, `3 matters + 1 section\n${text}`)
})

test('A NEW MATTER IS NOT FILED BY GUESSWORK', async t => {
  // The end of the file is *inside the last section*, so appending — right
  // while a docket was one flat list — would make `fix the fence` a major
  // project without anybody saying so. The default is the undivided run.
  const { doc, file } = await three(t)
  await doc.addSection('Major projects')
  const fence = await doc.add('Fix the fence')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken', 'Redo the kitchen', 'Fix the fence']],
    ['Major projects', []],
  ])
  assert.match(await file(), /^## Fix the fence$/m, 'and at the top level, where it is')
  void fence
})

test('and it goes where it is told when it is told', async t => {
  const { doc, file } = await three(t)
  await doc.addSection('Major projects')
  await doc.add('Redo the bathroom', STANDING, undefined, 'Major projects')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken', 'Redo the kitchen']],
    ['Major projects', ['Redo the bathroom']],
  ])
  assert.match(await file(), /^### Redo the bathroom$/m, 'a level down, inside the section')
})

test('a section named in an add that does not exist is refused, not invented', async t => {
  const { doc } = await three(t)
  await assert.rejects(() => doc.add('Fix the fence', STANDING, undefined, 'Nowhere'), /no section/)
  assert.equal((await doc.matters()).length, 3)
})

test('and the file stays tidy when a matter is added into a section', async t => {
  const { doc, file } = await three(t)
  await doc.addSection('Major projects')
  await doc.add('Redo the bathroom', STANDING, undefined, 'Major projects')
  await doc.add('Fix the fence')
  const text = await file()
  assert.doesNotMatch(text, /\n\n\n/)
  assert.doesNotMatch(text, /-->\n#/)
  assert.equal(text.match(/^#{2,3} /gm)?.length, 6, `5 matters + 1 section\n${text}`)
})

// ── adjacency: where the boundaries coincide ───────────────

test('THE OVERLAP BUG: dropping one onto its immediate neighbour', async t => {
  // This is the case that reached use and failed — *edit at 313 overlaps one
  // ending at 416* — and every test above passed while it did. The old verb
  // deleted the block and inserted it at the destination as two edits, so when
  // the destination was the block's own boundary the two overlapped. Adjacency
  // is exactly where that happens, and nothing tested it.
  const { doc, boiler, oven } = await three(t)
  await doc.moveMatter(oven, '', boiler)
  assert.deepEqual(await named(doc), [
    ['', ['The oven is broken', 'Service the boiler', 'Redo the kitchen']],
  ])
})

test('and the other way round, which is the mirror boundary', async t => {
  const { doc, boiler, kitchen } = await three(t)
  // The boiler is first; put it just above the last one, which means the block
  // after it is where it lands.
  await doc.moveMatter(boiler, '', kitchen)
  assert.deepEqual(await named(doc), [
    ['', ['The oven is broken', 'Service the boiler', 'Redo the kitchen']],
  ])
})

test('a matter dropped exactly where it already is changes nothing', async t => {
  const { doc, file, oven } = await three(t)
  const before = await file()
  await doc.moveMatter(oven, '', oven)
  assert.equal(await file(), before, 'not one byte')
})

test('and dropped at the end of the run it is already at the end of', async t => {
  const { doc, file, kitchen } = await three(t)
  const before = await file()
  await doc.moveMatter(kitchen, '')
  assert.equal(await file(), before)
})

test('every pair of positions is reachable, and none of them throws', async t => {
  // Exhaustive over three matters, because the failure was arithmetic and
  // arithmetic is worth brute-forcing at this size.
  for (const from of [0, 1, 2]) {
    for (const onto of [0, 1, 2]) {
      const { doc } = await three(t)
      const ids = (await doc.matters()).map(m => m.id ?? '')
      await doc.moveMatter(ids[from] as string, '', ids[onto] as string)
      const after = (await doc.matters()).map(m => m.id)
      assert.equal(after.length, 3, `moving ${from} onto ${onto} lost one`)
      assert.equal(new Set(after).size, 3, `moving ${from} onto ${onto} duplicated one`)
    }
  }
})

test('and so is every nudge, in both directions, from every position', async t => {
  for (const which of [0, 1, 2]) {
    for (const delta of [-1, 1]) {
      const { doc } = await three(t)
      const ids = (await doc.matters()).map(m => m.id ?? '')
      const moved = await doc.nudgeMatter(ids[which] as string, delta)
      const after = (await doc.matters()).map(m => m.id)
      assert.equal(after.length, 3, `nudging ${which} by ${delta} lost one`)
      assert.equal(new Set(after).size, 3, `nudging ${which} by ${delta} duplicated one`)
      // One place, never two — a downward nudge moved two for one run.
      if (moved) {
        assert.equal(after.indexOf(ids[which] as string), which + delta,
          `nudging ${which} by ${delta} went too far`)
      } else {
        assert.deepEqual(after, ids, 'and a refused nudge moves nothing')
      }
    }
  }
})
