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
import { UNSCHEDULED } from '../../src/shared/kinds/docket.ts'
import { kindOf, type RelPath } from '../../src/main/w/layout.ts'
import { BACKLOG_DOCKET } from '../../src/shared/document-api.ts'
import type { DateKey, DocumentId } from '../../src/shared/document-api.ts'
// **The prose, without the chips.** A generated item carries its matter as a
// tag now, so raw `text` includes the mark — and what these claims are about is
// what the line says.
import { isLive, withoutMarks } from '../../src/shared/kinds/todo.ts'

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
  assert.match(text, /^start: —$/m)
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

  await doc.setWhen('bbbb2222', { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
  const text = await file()

  assert.match(text, /^## Repaint the house\nmode: \w+\nstart: —\nevery: 90d$/m)
  // Everything else, exactly as it was — including somebody's own `quoted:` line
  // and the two blank lines they left above the edited block.
  assert.match(text, /^quoted: 480 for the part$/m)
  assert.match(text, /\n\n\n## Repaint the house/)
  assert.match(text, /^## Change the air filters\nwhen: every 90d$/m,
    'untouched, so still in the old form — which is the point of this test')
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
  assert.match(text, /^## The gate sticks\nwhen: 2026-10-01$/m,
    'untouched, so not rewritten into the new form either')
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
  const id = await doc.add('The ACM talk', { start: '2026-11-12' as never, every: null, after: null, dates: null })
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
  assert.deepEqual(matter.when, { start: '2026-11-12', every: null, after: null, dates: null })
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
  assert.deepEqual(matters[0]?.when, UNSCHEDULED)
})

test('and `when` is parsed in main, so a bad one is refused rather than stored', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  await assert.rejects(
    () => service.docketAdd(id, 'Something', { mode: 'event', start: 'next Tuesdayish' }),
    /not a date/,
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

async function serviced(t: TestContext, at = '2026-03-10T09:00:00Z') {
  const root = await mkdtemp(join(tmpdir(), 'tephra-docket-svc-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  const { DocumentService } = await import('../../src/main/document-service.ts')
  let clock = new Date(at)
  const service = new DocumentService(nb, {
    now: () => clock,
    history: false,
    // Never on its own: these tests move the day by hand, so the moment it
    // changes is the moment under test.
    dayCheckMs: 24 * 60 * 60_000,
  })
  t.after(async () => {
    await service.stop()
    await nb.close()
  })
  await service.info()
  return {
    root,
    service,
    /**
     * Move the calendar, and let the app notice.
     *
     * **Which is how a long absence is forced rather than waited for.** A path
     * that fires once a quarter is broken when it fires, and the only way to
     * find that out today is to make today be then.
     */
    async on(day: string): Promise<void> {
      clock = new Date(`${day}T09:00:00Z`)
      await service.crossTheDay()
    },
  }
}

/**
 * The live items on today's list, by id.
 *
 * **Asked of the list rather than of what a pass returned.** Many of these tests
 * used `reconcile()`'s `made` as a handle on the item it generated, which worked
 * while a pass was the only thing that generated. Since MH4 a docket write asks
 * for its own pass, so by the time a test calls `reconcile()` the work is
 * already done and `made` is empty — correctly. What the tests were ever about
 * is what is on the list.
 */
async function onList(service: {
  todoList(): Promise<DocumentId>
  todoItems(id: DocumentId, day: DateKey): Promise<readonly { id: string | null }[]>
  readonly today: DateKey
}): Promise<readonly string[]> {
  const list = await service.todoList()
  return (await service.todoItems(list, service.today))
    .flatMap(one => (one.id === null ? [] : [one.id]))
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
  const matter = await service.docketAdd(id, 'The oven is broken',
    { mode: 'event', start: '2026-10-14' })
  const to = await service.renameDocument(id, 'The big house')
  const matters = await service.docketMatters(to)
  assert.equal(matters.length, 1)
  assert.equal(matters[0]?.id, matter, 'a rename moves the file; it does not remake the contents')
  assert.deepEqual(matters[0]?.when, { start: '2026-10-14', every: null, after: null, dates: null })
})

// ── run-ups on a matter (MH1, H4) ──────────────────────────

test('THE RECONCILER: a matter carries its own steps', async t => {
  // H4's per-matter window is what lets a complete record project onto a short
  // horizon — a birthday wants months, a filter wants days, and no global
  // setting can say both. D76 replaced the *window* with the step list, which
  // says the same thing in both directions rather than only backwards.
  const { doc, file } = await docket(t)
  const id = await doc.add('Service the boiler', { start: '2026-10-14' as never, every: null, after: null, dates: null })
  await doc.addStep(id, '2w', 'book the boiler service')
  const matter = (await doc.matters())[0]
  assert.equal(matter?.steps.length, 1)
  const step = matter?.steps[0]
  assert.deepEqual(step?.when, { kind: 'at', offset: '-2w' })
  assert.equal(step?.kind, 'task')
  assert.equal(step?.text, 'book the boiler service')
  assert.equal(step?.done, null)
  assert.match(step?.id ?? '', /^[0-9a-z]{8}$/, 'minted on write, so `after` can point at it')
  assert.match(await file(), /^steps:\n- -2w task: book the boiler service <!--tephra:step [0-9a-z]{8}-->$/m)
})

test('and several are kept in the order they FIRE, not the order typed', async t => {
  // Two run-ups in the order they happened to be said is a list nobody can
  // scan; earliest-first is the order they are read and the order they will run.
  const { doc } = await docket(t)
  const id = await doc.add('The ACM talk', { start: '2026-11-12' as never, every: null, after: null, dates: null })
  await doc.addStep(id, '2w', 'draft the slides')
  await doc.addStep(id, '2m', 'start the outline')
  await doc.addStep(id, '3d', 'print the handout')
  assert.deepEqual((await doc.matters())[0]?.steps.map(t => (t.when.kind === 'at' ? t.when.offset : 'after')), ['-2m', '-2w', '-3d'])
})

test('an offset after the date sorts last, because it fires last', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A trip', { start: '2026-11-12' as never, every: null, after: null, dates: null })
  await doc.addStep(id, '+3d', 'file the expenses')
  await doc.addStep(id, '1w', 'pack')
  assert.deepEqual((await doc.matters())[0]?.steps.map(t => (t.when.kind === 'at' ? t.when.offset : 'after')), ['-1w', '+3d'])
})

test('a run-up that is not an offset is refused, and nothing is written', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('A thing')
  await assert.rejects(() => doc.addStep(id, 'soon', 'do it'), /not a schedule/)
  await assert.rejects(() => doc.addStep(id, '2w', '   '), /needs to say what happens/)
  assert.deepEqual((await doc.matters())[0]?.steps, [])
  assert.ok(!(await file()).includes('steps:'))
})

test('dropping one leaves the others and the rest of the matter alone', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('The ACM talk', { start: '2026-11-12' as never, every: null, after: null, dates: null })
  await doc.tagMatter(id, 'speaking')
  await doc.addStep(id, '2w', 'draft the slides')
  await doc.addStep(id, '3d', 'print the handout')
  const first = (await doc.matters())[0]?.steps[0]?.id ?? ''
  await doc.removeStep(id, first)
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.steps.map(t => t.text), ['print the handout'])
  assert.deepEqual(matter?.tags, ['speaking'])
  assert.deepEqual(matter?.when, { start: '2026-11-12', every: null, after: null, dates: null })
  assert.equal(matter?.id, id)
})

test('THE MEETING CASE: recurrence and its run-up, authored together', async t => {
  // *The air filters need changing every ninety days, and remind me three days
  // before* — which is the whole of what a planning conversation has to be able
  // to say. Nothing fires until MH3; saying it is what MH1 owes.
  const { doc, file } = await docket(t)
  const id = await doc.add('Change the air filters', { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
  await doc.addStep(id, '3d', 'change the air filters #house')
  const text = await file()
  assert.match(text, /^every: 90d$/m)
  assert.match(text, /^- -3d task: change the air filters #house <!--tephra:step [0-9a-z]{8}-->$/m)
  // And the whole thing survives a reread, which is what makes it a record.
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.when, { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
  assert.equal(matter?.steps.length, 1)
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
  const id = await doc.add('Service the boiler', { start: '2026-10-14' as never, every: null, after: null, dates: null })
  await doc.addStep(id, '2w', 'book it')
  await doc.setNotes(id, ['The firm on the high street did the last one.'])
  const matter = (await doc.matters())[0]
  assert.equal(matter?.steps.length, 1)
  assert.deepEqual(matter?.notes, ['The firm on the high street did the last one.'])
})

// ── anchored recurrence (MH1, H7) ──────────────────────────

test('THE ANCHOR: a recurrence records what it recurs from', async t => {
  // *Every ninety days* is not a schedule until you know ninety days from what,
  // and MH3 cannot reconstruct it — so it is recorded now or never.
  const { doc, file } = await docket(t)
  const id = await doc.add('Change the air filters', { start: '2026-10-01' as never, every: { n: 90, unit: 'd' }, after: null, dates: null })
  assert.match(await file(), /^start: 2026-10-01$/m)
  assert.match(await file(), /^every: 90d$/m)
  assert.deepEqual((await doc.matters())[0]?.when,
    { start: '2026-10-01', every: { n: 90, unit: 'd' }, after: null, dates: null })
  void id
})

test('and setting one later is how a conversation actually goes', async t => {
  // *Every 90 days* is said first; *starting in October* is said second.
  const { doc } = await docket(t)
  const id = await doc.add('Change the air filters', { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
  assert.deepEqual((await doc.matters())[0]?.when, { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
  await doc.setWhen(id, { start: '2026-10-01' as never, every: { n: 90, unit: 'd' }, after: null, dates: null })
  assert.deepEqual((await doc.matters())[0]?.when,
    { start: '2026-10-01', every: { n: 90, unit: 'd' }, after: null, dates: null })
})

test('an impossible date never reaches the file', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  for (const said of ['2026-02-30', '2026-13-01', '2026-11-14..2026-11-12']) {
    await assert.rejects(
      () => service.docketAdd(id, 'A thing', { mode: 'event', start: said }),
      /not a date/,
    )
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
  await doc.setWhen(kitchen, { start: '2026-10-01' as never, every: { n: 90, unit: 'd' }, after: null, dates: null })
  await doc.tagMatter(kitchen, 'house')
  await doc.addStep(kitchen, '2w', 'get quotes')
  await doc.setNotes(kitchen, ['Three firms quoted.'])
  await doc.addSection('Major projects')
  await doc.moveMatter(kitchen, 'Major projects')
  const moved = (await doc.matters()).find(m => m.id === kitchen)
  assert.deepEqual(moved?.when, { start: '2026-10-01', every: { n: 90, unit: 'd' }, after: null, dates: null })
  assert.deepEqual(moved?.tags, ['house'])
  assert.equal(moved?.steps.length, 1)
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
  assert.deepEqual(filters?.when, { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
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
  await doc.add('Redo the bathroom', UNSCHEDULED, undefined, 'Major projects')
  assert.deepEqual(await named(doc), [
    ['', ['Service the boiler', 'The oven is broken', 'Redo the kitchen']],
    ['Major projects', ['Redo the bathroom']],
  ])
  assert.match(await file(), /^### Redo the bathroom$/m, 'a level down, inside the section')
})

test('a section named in an add that does not exist is refused, not invented', async t => {
  const { doc } = await three(t)
  await assert.rejects(() => doc.add('Fix the fence', UNSCHEDULED, undefined, 'Nowhere'), /no section/)
  assert.equal((await doc.matters()).length, 3)
})

test('and the file stays tidy when a matter is added into a section', async t => {
  const { doc, file } = await three(t)
  await doc.addSection('Major projects')
  await doc.add('Redo the bathroom', UNSCHEDULED, undefined, 'Major projects')
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

// ── steps, chained (MH3a, D76) ──────────────────────────────

test('THE CHAIN: a step waits on another by id, not by position', async t => {
  // *Find a suitable shop*, then *have the car fixed* once that is done. The
  // reference is by id because a positional one would silently repoint itself
  // the moment a step was inserted above it (D56's rule, a level down).
  const { doc, file } = await docket(t)
  const id = await doc.add('The car needs fixing')
  const shop = await doc.addStep(id, 'right away', 'find a suitable shop')
  const fix = await doc.addStep(id, `after ${shop}`, 'have the car fixed')
  const steps = (await doc.matters())[0]?.steps ?? []
  assert.deepEqual(steps.map(one => one.text), ['find a suitable shop', 'have the car fixed'])
  assert.deepEqual(steps[0]?.when, { kind: 'at', offset: '+0d' }, 'T+0 is due on activation')
  assert.deepEqual(steps[1]?.when, { kind: 'after', step: shop })
  assert.match(await file(), new RegExp(`^- after ${shop} task: have the car fixed`, 'm'))
  void fix
})

test('and inserting a step above the chain does not repoint it', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('The car needs fixing')
  const shop = await doc.addStep(id, 'right away', 'find a suitable shop')
  await doc.addStep(id, `after ${shop}`, 'have the car fixed')
  // A step that sorts to the front, added last.
  await doc.addStep(id, '-1w', 'clear the weekend')
  const steps = (await doc.matters())[0]?.steps ?? []
  assert.deepEqual(steps.map(one => one.text),
    ['clear the weekend', 'find a suitable shop', 'have the car fixed'])
  const dependent = steps.find(one => one.text === 'have the car fixed')
  assert.deepEqual(dependent?.when, { kind: 'after', step: shop }, 'still pointing at the shop')
})

test('a dependent step sorts behind what it waits on, having no offset of its own', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A trip')
  const book = await doc.addStep(id, '-60d', 'book the flights')
  await doc.addStep(id, '-2d', 'pack')
  await doc.addStep(id, `after ${book}`, 'claim the expenses')
  assert.deepEqual((await doc.matters())[0]?.steps.map(one => one.text),
    ['book the flights', 'claim the expenses', 'pack'])
})

test('COMPLETION IS STAMPED ON THE STEP, which is what a dependency reads', async t => {
  // Not read off whatever the step generated: that item can be edited away, and
  // suspend withdraws those items by definition while having to preserve this.
  const { doc, file } = await docket(t)
  const id = await doc.add('The car needs fixing')
  const shop = await doc.addStep(id, 'right away', 'find a suitable shop')
  await doc.completeStep(id, shop, 1789148616)
  const step = (await doc.matters())[0]?.steps[0]
  assert.equal(step?.done, 1789148616)
  assert.match(await file(), new RegExp(`<!--tephra:step ${shop} 1789148616-->`))
  // And it comes back off, because a tick is a thing people get wrong.
  await doc.completeStep(id, shop, null)
  assert.equal((await doc.matters())[0]?.steps[0]?.done, null)
  assert.match(await file(), new RegExp(`<!--tephra:step ${shop}-->`))
})

// ── activation (MH3a, D76) ──────────────────────────────────

test('THE POINT OF MH3a: activating a backlog matter dates it TODAY', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('The car needs fixing')
  await doc.addStep(id, 'right away', 'find a suitable shop')
  assert.deepEqual((await doc.matters())[0]?.when, UNSCHEDULED, 'inactive until somebody starts it')
  const started = await doc.activate(id, '2026-09-11' as never)
  assert.equal(started, '2026-09-11')
  assert.deepEqual((await doc.matters())[0]?.when, { start: '2026-09-11', every: null, after: null, dates: null })
  assert.match(await file(), /^start: 2026-09-11$/m)
})

test('and a matter with a run-up is dated FORWARD, so the run-up starts now', async t => {
  // *Activate* does not mean *start date is today*; it means *the first step is
  // due today*. Those are the same thing only when every step runs forward.
  const { doc } = await docket(t)
  const id = await doc.add('The ACM talk')
  await doc.addStep(id, '2w', 'draft the slides')
  await doc.addStep(id, '3d', 'print the handout')
  const started = await doc.activate(id, '2026-09-11' as never)
  assert.equal(started, '2026-09-25', 'a fortnight out, because the fortnight starts now')
})

test('and never backward, even when the earliest step is T+3d', async t => {
  // The literal *make the earliest step due now* would put the critical date
  // three days in the past, which is a strange thing to write into a file on
  // the strength of one button. Forward-only.
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  await doc.addStep(id, '+3d', 'the first bit')
  assert.equal(await doc.activate(id, '2026-09-11' as never), '2026-09-11')
})

test('a matter with no steps activates to today, having nothing to lead', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  assert.equal(await doc.activate(id, '2026-09-11' as never), '2026-09-11')
})

test('ACTIVATING A PERIODIC MATTER sets its anchor, not a one-off date', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('Change the air filters', { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
  await doc.addStep(id, 'right away', 'change the filters')
  await doc.activate(id, '2026-09-11' as never)
  assert.deepEqual((await doc.matters())[0]?.when,
    { start: '2026-09-11', every: { n: 90, unit: 'd' }, after: null, dates: null })
  assert.match(await file(), /^start: 2026-09-11$/m)
})

test('SUSPEND clears the date and keeps what is already done', async t => {
  const { doc, file } = await docket(t)
  const id = await doc.add('The car needs fixing')
  const shop = await doc.addStep(id, 'right away', 'find a suitable shop')
  await doc.addStep(id, `after ${shop}`, 'have the car fixed')
  await doc.activate(id, '2026-09-11' as never)
  await doc.completeStep(id, shop, 1789148616)
  await doc.suspend(id)
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.when, UNSCHEDULED, 'inactive again')
  assert.equal(matter?.steps[0]?.done, 1789148616, 'and the finished step stayed finished')
  assert.equal(matter?.steps.length, 2, 'and nothing was lost')
  assert.match(await file(), /^start: —$/m)
})

test('and re-activating resumes rather than restarting', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('The car needs fixing')
  const shop = await doc.addStep(id, 'right away', 'find a suitable shop')
  await doc.activate(id, '2026-09-11' as never)
  await doc.completeStep(id, shop, 1789148616)
  await doc.suspend(id)
  await doc.activate(id, '2026-10-01' as never)
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.when, { start: '2026-10-01', every: null, after: null, dates: null })
  assert.equal(matter?.steps[0]?.done, 1789148616, 'still done: a pause is not a reset')
})

test('SUSPENDING A PERIODIC MATTER keeps the interval and loses the anchor', async t => {
  // So restarting it later is one field again, which is the whole reason the
  // anchor is optional in the notation.
  const { doc, file } = await docket(t)
  const id = await doc.add('Change the air filters',
    { start: '2026-09-11' as never, every: { n: 90, unit: 'd' }, after: null, dates: null })
  await doc.suspend(id)
  assert.deepEqual((await doc.matters())[0]?.when, { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
  assert.match(await file(), /^every: 90d$/m)
})

test('THE STATE IS THE DATE: there is no suspended flag anywhere', async t => {
  // D76: inactive means no start date, because `T±N` is not computable without
  // one and so nothing can generate. A periodic matter with no anchor is the
  // same state wearing a rule.
  const { doc, file } = await docket(t)
  const a = await doc.add('Backlogged')
  const b = await doc.add('Periodic, unstarted', { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
  await doc.activate(a, '2026-09-11' as never)
  await doc.suspend(a)
  const text = await file()
  assert.ok(!/suspend|inactive|active:/i.test(text), `no state field was written:\n${text}`)
  assert.deepEqual((await doc.matters()).map(m => m.when.start), [null, null])
  assert.deepEqual((await doc.matters()).map(m => m.when.every !== null), [false, true])
  void b
})

test('A BLANK SCHEDULE MEANS T+0, rather than silently refusing', async t => {
  // Reported from use: pressing Enter with the *when* field empty did nothing
  // and said nothing, which reads as a broken key. Blank is the commonest step
  // there is — *the first thing to do when work starts* — so it is the default.
  const { doc } = await docket(t)
  const id = await doc.add('The car needs fixing')
  const step = await doc.addStep(id, '', 'find a suitable shop')
  const steps = (await doc.matters())[0]?.steps ?? []
  assert.deepEqual(steps[0]?.when, { kind: 'at', offset: '+0d' })
  assert.equal(steps[0]?.id, step)
})

test('and whitespace is blank, because that is what a person typed', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  await doc.addStep(id, '   ', 'the first bit')
  assert.deepEqual((await doc.matters())[0]?.steps[0]?.when, { kind: 'at', offset: '+0d' })
})

test('but a schedule it cannot READ is still refused, not defaulted', async t => {
  // The distinction that matters: saying nothing is a choice, and saying
  // something unreadable is a mistake worth hearing about.
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  await assert.rejects(() => doc.addStep(id, 'soon', 'do it'), /not a schedule/)
  await assert.rejects(() => doc.addStep(id, '2 fortnights', 'do it'), /not a schedule/)
  assert.deepEqual((await doc.matters())[0]?.steps, [])
})

test('A TYPO IS FIXABLE, and fixing it keeps the id and the stamp', async t => {
  // Reported from use the moment somebody made one. Dropping and retyping is
  // not the same act: the id is what a dependent step points at, and the stamp
  // is what that dependent reads, so a retype orphans one and forgets the other.
  const { doc } = await docket(t)
  const id = await doc.add('Fix the skylight')
  const find = await doc.addStep(id, '', 'Find electrition')
  await doc.addStep(id, `after ${find}`, 'Have them fix it')
  await doc.completeStep(id, find, 1789148616)
  await doc.editStep(id, find, 'Find an electrician')
  const steps = (await doc.matters())[0]?.steps ?? []
  assert.equal(steps[0]?.text, 'Find an electrician')
  assert.equal(steps[0]?.id, find, 'the same step, not a new one')
  assert.equal(steps[0]?.done, 1789148616, 'and still done')
  assert.deepEqual(steps[1]?.when, { kind: 'after', step: find }, 'and its dependent still points at it')
})

test('and a step can be rescheduled without losing either', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('The ACM talk')
  const draft = await doc.addStep(id, '2w', 'draft the slides')
  await doc.completeStep(id, draft, 1789148616)
  await doc.setStepWhen(id, draft, '3 weeks')
  const step = (await doc.matters())[0]?.steps[0]
  assert.deepEqual(step?.when, { kind: 'at', offset: '-3w' })
  assert.equal(step?.id, draft)
  assert.equal(step?.done, 1789148616)
})

test('a step cannot be made to wait for itself', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  const one = await doc.addStep(id, '', 'the first bit')
  await assert.rejects(() => doc.setStepWhen(id, one, `after ${one}`), /wait for itself/)
})

test('and an unreadable reschedule leaves the step exactly as it was', async t => {
  // Which is what lets the surface keep the field open with the words still in
  // it: the verb either works or changes nothing.
  const { doc, file } = await docket(t)
  const id = await doc.add('A thing')
  const one = await doc.addStep(id, '2w', 'the first bit')
  const before = await file()
  await assert.rejects(() => doc.setStepWhen(id, one, 'soon'), /not a schedule/)
  assert.equal(await file(), before, 'not one byte')
})

test('and editing to blank is refused rather than emptying the step', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  const one = await doc.addStep(id, '2w', 'the first bit')
  await assert.rejects(() => doc.editStep(id, one, '   '), /needs to say what happens/)
  assert.equal((await doc.matters())[0]?.steps[0]?.text, 'the first bit')
})

// ── references: then, and indices (MH3a) ────────────────────

test('THEN means after the one above it, and is stored as a real id', async t => {
  // The word people use when typing a chain top to bottom. An id cannot be
  // typed by hand — it is eight random characters — so *then* and an index are
  // the only references a person can give, and both normalise on the way in.
  const { doc, file } = await docket(t)
  const id = await doc.add('Fix the skylight')
  const find = await doc.addStep(id, '', 'find an electrician')
  await doc.addStep(id, 'then', 'have them fix it')
  const steps = (await doc.matters())[0]?.steps ?? []
  assert.deepEqual(steps[1]?.when, { kind: 'after', step: find })
  assert.match(await file(), new RegExp(`^- after ${find} task: have them fix it`, 'm'))
})

test('and `then +3d` is a gap after it, forward by construction', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A trip')
  const trip = await doc.addStep(id, '', 'the trip')
  await doc.addStep(id, 'then 3d', 'file the expenses')
  assert.deepEqual((await doc.matters())[0]?.steps[1]?.when,
    { kind: 'after', step: trip, offset: '+3d' })
})

test('THEN WITH NOTHING ABOVE IT says so, rather than becoming T+0', async t => {
  // *Then* is a claim about an order, and the first step of a list is not in
  // one. Defaulting it would have been a guess about somebody's intent.
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  await assert.rejects(() => doc.addStep(id, 'then', 'the first bit'),
    /no step above this one/)
  assert.deepEqual((await doc.matters())[0]?.steps, [])
})

test('AFTER 1 is the index the surface shows, resolved to the id it holds', async t => {
  // It used to parse and store `1` — the id pattern matches a digit — so the
  // step waiting on it pointed at nothing and would never have come due.
  const { doc, file } = await docket(t)
  const id = await doc.add('Fix the skylight')
  const find = await doc.addStep(id, '', 'find an electrician')
  await doc.addStep(id, 'after 1', 'have them fix it')
  assert.deepEqual((await doc.matters())[0]?.steps[1]?.when, { kind: 'after', step: find })
  assert.doesNotMatch(await file(), /after 1 /, 'the file holds an id, never an index')
})

test('and an index with no step there is refused, not stored', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  await doc.addStep(id, '', 'the only step')
  await assert.rejects(() => doc.addStep(id, 'after 7', 'the next bit'), /not a schedule/)
  await assert.rejects(() => doc.addStep(id, 'after 0', 'the next bit'), /not a schedule/)
  assert.equal((await doc.matters())[0]?.steps.length, 1)
})

test('and an id that is not on this matter is refused too', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  await doc.addStep(id, '', 'the only step')
  await assert.rejects(() => doc.addStep(id, 'after deadbeef', 'the next bit'),
    /not a schedule/)
})

test('a step cannot be made to wait for itself, by index either', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  const one = await doc.addStep(id, '', 'the first bit')
  await assert.rejects(() => doc.setStepWhen(id, one, 'after 1'), /wait for itself/)
})

test('and rescheduling to `then` follows the step ABOVE, not the last one', async t => {
  // Which is the difference between adding and editing: a new step is going to
  // the end, so *then* means the end; an existing one is already somewhere.
  const { doc } = await docket(t)
  const id = await doc.add('A trip')
  const first = await doc.addStep(id, '-60d', 'book the flights')
  const second = await doc.addStep(id, '-7d', 'pack')
  const third = await doc.addStep(id, '-1d', 'check in')
  await doc.setStepWhen(id, second, 'then')
  const steps = (await doc.matters())[0]?.steps ?? []
  const packed = steps.find(one => one.id === second)
  assert.deepEqual(packed?.when, { kind: 'after', step: first }, 'the one above it')
  void third
})

test('ACCEPT FLEXIBLY, PRODUCE STRICTLY: four ways in, one way out', async t => {
  // `step` and the `+` are optional noise on the way in; what comes back out of
  // `spellStepWhen` always has the word and always has the sign.
  const { doc } = await docket(t)
  const id = await doc.add('A chain')
  const first = await doc.addStep(id, '', 'the first bit')
  for (const said of ['after step 1', 'after 1', `after ${first}`, `after step ${1}`]) {
    const step = await doc.addStep(id, said, `via ${said}`)
    const made = (await doc.matters())[0]?.steps.find(one => one.id === step)
    assert.deepEqual(made?.when, { kind: 'after', step: first }, said)
  }
})

test('THEN follows the LAST step, which is what makes it a chain', async t => {
  // Kept out of the loop above for that reason: each iteration adds a step, so
  // `then` would follow the previous iteration — correctly, and not step one.
  const { doc } = await docket(t)
  const id = await doc.add('A chain')
  await doc.addStep(id, '', 'the first bit')
  const second = await doc.addStep(id, 'then', 'the second bit')
  const third = await doc.addStep(id, 'then', 'the third bit')
  const steps = (await doc.matters())[0]?.steps ?? []
  assert.deepEqual(steps.find(one => one.id === third)?.when,
    { kind: 'after', step: second }, 'the one before it, not the first')
})

test('and the gap is accepted with or without its sign', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A chain')
  const first = await doc.addStep(id, '', 'the first bit')
  for (const said of ['after step 1 +3d', 'after step 1 3d', 'after 1 + 3 days']) {
    const step = await doc.addStep(id, said, `via ${said}`)
    const made = (await doc.matters())[0]?.steps.find(one => one.id === step)
    assert.deepEqual(made?.when, { kind: 'after', step: first, offset: '+3d' }, said)
  }
})






test('and every other kind still reads a bare interval as BEFORE', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('The ACM talk')
  const draft = await doc.addStep(id, '2 weeks', 'draft the slides')
  assert.deepEqual((await doc.matters())[0]?.steps.find(one => one.id === draft)?.when,
    { kind: 'at', offset: '-2w' })
})

test('but a task with no words is still refused', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  await assert.rejects(() => doc.addStep(id, '', '   '), /needs to say what happens/)
})

// ── recurrence is the matter's, not a step's (D76, amended) ─

test('COMPLETION-DRIVEN RECURRENCE is two fields on the matter', async t => {
  // It was a schedule, then a step somebody wrote, and is now `every` plus
  // `after` — which is where it belonged: the reschedule is machinery, and the
  // step list is a person's own words.
  const { doc, file } = await docket(t)
  const id = await doc.add('Change the air filters')
  const change = await doc.addStep(id, '', 'change the filters')
  await doc.setEvery(id, { n: 90, unit: 'd' })
  await doc.setAfter(id, change)
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.when.every, { n: 90, unit: 'd' })
  assert.equal(matter?.when.after, change)
  assert.equal(matter?.steps.length, 1, 'and no machinery step among the real ones')
  const text = await file()
  assert.match(text, /^every: 90d$/m)
  assert.match(text, new RegExp(`^after: ${change}$`, 'm'))
})

test('and a calendar-driven one simply has no `after`', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('My sister\'s birthday')
  await doc.setStart(id, '2026-11-15' as never)
  await doc.setEvery(id, { n: 1, unit: 'y' })
  const matter = (await doc.matters())[0]
  assert.equal(matter?.when.after, null, 'the calendar decides, not anybody doing anything')
  assert.deepEqual(matter?.when.every, { n: 1, unit: 'y' })
})

test('THE MIGRATION: an old reschedule STEP folds into the matter on read', async t => {
  // A reader that understands the old form costs less than a pass over
  // everybody's files, and cannot half-finish.
  const { doc, file } = await docket(t, [
    '---', 'tephra: 1', 'kind: docket', '---', '',
    '## Change the air filters',
    'when: —',
    'steps:',
    '- +0d task: change the filters <!--tephra:step aaaa1111-->',
    '- after aaaa1111 +90d reschedule: the next one <!--tephra:step bbbb2222-->',
    '<!--tephra:matter cccc3333 1757462400 0-->',
  ].join('\n'))
  const matter = (await doc.matters())[0]
  assert.deepEqual(matter?.when.every, { n: 90, unit: 'd' }, 'the offset became the interval')
  assert.equal(matter?.when.after, 'aaaa1111', 'and what it waited on became the clock')
  assert.deepEqual(matter?.steps.map(one => one.text), ['change the filters'],
    'and the machinery is no longer among the words')
  // And on the next write of that block, the file says so in the new form.
  await doc.rename('cccc3333', 'Change the air filters')
  const text = await file()
  assert.match(text, /^every: 90d$/m)
  assert.match(text, /^after: aaaa1111$/m)
  assert.doesNotMatch(text, /reschedule/)
})

test('REMOVING THE CLOCK STEP IS REFUSED, not repaired afterwards', async t => {
  // Taking it away would leave a matter that quietly stopped recurring, which
  // is the shape of failure this project is named against. The alternative was
  // editing a matter as a batch and validating on save — the first place in
  // this app that would ask anybody to save.
  const { doc } = await docket(t)
  const id = await doc.add('Change the air filters')
  const change = await doc.addStep(id, '', 'change the filters')
  await doc.setEvery(id, { n: 90, unit: 'd' })
  await doc.setAfter(id, change)
  await assert.rejects(() => doc.removeStep(id, change), /what makes the matter recur/)
  assert.equal((await doc.matters())[0]?.steps.length, 1)
  // Pointing the clock elsewhere first is what makes it removable.
  const other = await doc.addStep(id, 'then', 'and then this')
  await doc.setAfter(id, other)
  await doc.removeStep(id, change)
  assert.equal((await doc.matters())[0]?.steps.length, 1)
})

test('and the clock can only point at a step that is there', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  await doc.setEvery(id, { n: 90, unit: 'd' })
  await assert.rejects(() => doc.setAfter(id, 'deadbeef'), /not a step on this matter/)
})

test('and a matter with no interval has nothing to reschedule', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('A thing')
  const one = await doc.addStep(id, '', 'the first bit')
  await assert.rejects(() => doc.setAfter(id, one), /nothing to reschedule/)
})

test('LOSING THE INTERVAL loses what measured from it', async t => {
  const { doc } = await docket(t)
  const id = await doc.add('Change the air filters')
  const change = await doc.addStep(id, '', 'change the filters')
  await doc.setEvery(id, { n: 90, unit: 'd' })
  await doc.setAfter(id, change)
  await doc.setEvery(id, null)
  assert.equal((await doc.matters())[0]?.when.after, null, 'a pointer that would mean nothing')
})

test('THE CHOICE HAS TO BE OFFERED BEFORE IT IS MADE', async t => {
  // Reported from use: setting an interval showed *on the calendar* as the only
  // option, because the per-step radios were gated on a step having already
  // been chosen. So the two recurring shapes were one click apart in one
  // direction and unreachable in the other.
  const { doc } = await docket(t)
  const id = await doc.add('Clean air filters')
  const step = await doc.addStep(id, '', 'replace filters')
  await doc.setEvery(id, { n: 90, unit: 'd' })
  assert.equal((await doc.matters())[0]?.when.after, null, 'the calendar, until told otherwise')
  // And the step can be chosen, which is what turns it into the fourth shape.
  await doc.setAfter(id, step)
  assert.equal((await doc.matters())[0]?.when.after, step)
  // And back again, which is the other direction.
  await doc.setAfter(id, null)
  assert.equal((await doc.matters())[0]?.when.after, null)
})

test('EVERY MATTER IS BORN WITH A STEP, explicitly rather than by inference', async t => {
  // The alternative was a matter with no steps being *treated as* having one
  // according to its mode — a rule that would have leaked into generation, the
  // horizon and anything else that reads a docket, and which nobody could
  // reason about from the file alone. The step is written down; the surface
  // folds it away so it does not read as an echo of the matter's own name.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const made = await service.docketAdd(id, 'Fix the skylight', { mode: 'task' })
  const matter = (await service.docketMatters(id)).find(one => one.id === made)
  assert.equal(matter?.steps.length, 1)
  assert.equal(matter?.steps[0]?.text, 'Fix the skylight')
  assert.equal(matter?.steps[0]?.kind, 'task')
})

test('and an event is born with a reminder, which is the other axis', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const made = await service.docketAdd(id, 'The ACM talk', { mode: 'event', start: '2026-11-12' })
  const matter = (await service.docketMatters(id)).find(one => one.id === made)
  assert.equal(matter?.steps[0]?.kind, 'status')
})

test('and renaming a matter leaves its steps alone, which is the simple rule', async t => {
  // A step is something somebody wrote. Keeping it in step with the matter's
  // name would mean a rule about when they are still the same thing, which is
  // the kind of inference this design keeps refusing.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const made = await service.docketAdd(id, 'Fix the skylight', { mode: 'task' })
  await service.docketRename(id, made, 'Fix the roof light')
  const matter = (await service.docketMatters(id)).find(one => one.id === made)
  assert.equal(matter?.name, 'Fix the roof light')
  assert.equal(matter?.steps[0]?.text, 'Fix the skylight')
})

// ── generation (MH3a, D76) ──────────────────────────────────

test('THE POINT OF THE PHASE: a docket puts work on the list', async t => {
  // Until now a docket described work and produced none.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  // **Activating is enough**: the pass it asks for is part of the act, and a
  // second one afterwards finds nothing left to do (MH4's fix).
  await service.docketActivate(id, car)
  const list = await service.todoList()
  const items = await service.todoItems(list, service.today)
  assert.deepEqual(items.map(withoutMarks), ['The car needs fixing'])
  assert.deepEqual(items.flatMap(one => one.tags), ['The house'], 'tagged with its docket')
  assert.deepEqual(await service.reconcile(), { made: [], withdrawn: [] })
})

test('IDEMPOTENCE: running it again makes nothing', async t => {
  // Bought with provenance rather than with a diary of what ran — nothing
  // consults a *last run* date, which is what goes wrong when the app was not
  // running at midnight.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  assert.equal((await service.reconcile()).made.length, 0)
  assert.equal((await service.reconcile()).made.length, 0)
  const list = await service.todoList()
  assert.equal((await service.todoItems(list, service.today)).length, 1)
})

test('THE LONG ABSENCE: a month away yields one task, not thirty', async t => {
  // *A path that fires once every few years is broken when it fires*, so this
  // forces the absence rather than waiting for a holiday to produce one.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  for (let day = 0; day < 30; day += 1) await service.reconcile()
  const list = await service.todoList()
  assert.equal((await service.todoItems(list, service.today)).length, 1)
})

test('a matter nobody started generates nothing, which is what inactive MEANS', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  assert.deepEqual((await service.reconcile()).made, [])
})

test('and a step still waiting on another does not come due', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  const first = (await service.docketMatters(id))[0]?.steps[0]?.id ?? ''
  await service.docketAddStep(id, car, 'then', 'have the car fixed')
  await service.docketActivate(id, car)
  const list = await service.todoList()
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks),
    ['The car needs fixing'])
  void first
})

test('THE CHAIN FIRES: finishing one brings the next', async t => {
  // Which is the phase's end condition, in one test: press activate, the first
  // step is on today's list; finish it, and the next appears.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  const shop = (await service.docketMatters(id))[0]?.steps[0]?.id ?? ''
  await service.docketAddStep(id, car, 'then', 'have the car fixed')
  await service.docketActivate(id, car)
  await service.reconcile()
  await service.docketCompleteStep(id, car, shop, true)
  const list = await service.todoList()
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks),
    ['The car needs fixing', 'have the car fixed'])
})

test('a step records what it made, which is how it knows not to again', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  const made = await onList(service)
  const step = (await service.docketMatters(id))[0]?.steps[0]
  assert.equal(step?.made, made[0])
})

test('and a reminder is authored but inert, there being no horizon yet', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const talk = await service.docketAdd(id, 'The ACM talk',
    { mode: 'event', start: service.today })
  await service.docketActivate(id, talk)
  assert.deepEqual((await service.reconcile()).made, [], 'MH2 is what gives it somewhere to go')
})

test('COMPLETION FLOWS BACK: finishing the TASK advances the chain', async t => {
  // Which is the end condition as a person actually meets it. Ticking the task
  // is the act; the step it came from has to hear, or the chain only moves if
  // somebody goes to the docket and says so as well — asking them to do it
  // twice, and the half they would forget is the invisible one.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketAddStep(id, car, 'then', 'have the car fixed')
  await service.docketActivate(id, car)
  const [first] = await onList(service)
  const list = await service.todoList()

  await service.todoSetStatus(list, first as string, 'done')
  assert.notEqual((await service.docketMatters(id))[0]?.steps[0]?.done, null,
    'the step knows, without anybody telling it')

  // **And the next one is already there**, rather than waiting for a boundary.
  // Resolving an item now asks the reconciler to look, so *tick it and the next
  // step appears* is one gesture — which is what the chain firing is supposed to
  // feel like, and what the explicit pass here used to be standing in for.
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks),
    ['The car needs fixing', 'have the car fixed'])
  assert.deepEqual(await service.reconcile(), { made: [], withdrawn: [] })
})

test('and a task nothing generated flows back to nothing, quietly', async t => {
  const { service } = await serviced(t)
  await service.newDocument('The house', undefined, 'docket')
  const list = await service.todoList()
  const mine = await service.todoAdd(list, 'something I typed myself')
  await service.todoSetStatus(list, mine, 'done')
  const items = await service.todoItems(list, service.today)
  assert.equal(items.find(one => one.id === mine)?.status, 'done')
})

test('SUSPEND WITHDRAWS what it put on the list, and only that', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  await service.reconcile()
  const list = await service.todoList()
  const mine = await service.todoAdd(list, 'something I typed myself')
  assert.equal((await service.todoItems(list, service.today)).length, 2)

  await service.docketSuspend(id, car)
  const left = await service.todoItems(list, service.today)
  assert.deepEqual(left.map(one => one.id), [mine], 'what a person typed is nobody else\'s business')
  assert.equal((await service.docketMatters(id))[0]?.steps[0]?.made, null)
})

test('and it leaves a finished one alone, because finishing it was true', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  const [made] = await onList(service)
  const list = await service.todoList()
  await service.todoSetStatus(list, made as string, 'done')

  await service.docketSuspend(id, car)
  const items = await service.todoItems(list, service.today)
  assert.equal(items.find(one => one.id === made)?.status, 'done', 'still there, still done')
  assert.notEqual((await service.docketMatters(id))[0]?.steps[0]?.done, null)
})

test('and re-activating generates afresh, having withdrawn the last lot', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  await service.reconcile()
  await service.docketSuspend(id, car)
  await service.docketActivate(id, car)
  const list = await service.todoList()
  assert.equal((await service.todoItems(list, service.today)).length, 1,
    'one again, not none and not two')
})

// ── reconciliation: the clock tick (MH3b, D76) ──────────────
//
// **The pass is a reconciliation, not a sequence of events**, and every claim
// below is really the same claim: *what should be true is true afterwards*,
// however many times it runs and however long it was since the last one. That
// is worth stating separately from generation because the failures it prevents
// are the ones nothing reports — an instance that advanced and reissued
// silently, or one that never advanced and went quiet.

test('A RECURRING TASK ADVANCES when the step its clock reads is finished', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const filter = await service.docketAdd(id, 'Change the air filter',
    { mode: 'recurring-task', every: '3m', start: service.today })
  const step = (await service.docketMatters(id))[0]?.steps[0]?.id ?? ''
  const made = await onList(service)
  assert.equal(made.length, 1)

  const list = await service.todoList()
  await service.todoSetStatus(list, made[0] as string, 'done')
  await service.reconcile()

  const matter = (await service.docketMatters(id))[0]
  assert.equal(matter?.when.start, '2026-06-10', 'three months on from the day it was done')
  assert.equal(matter?.steps[0]?.done, null, 'and the step is fresh for the next one')
  assert.equal(matter?.steps[0]?.made, null)
  void filter
  void step
})

test('and does NOT generate the next one until its day comes round', async t => {
  // The advance and the generation are separate questions, and running them in
  // the same pass is what makes it tempting to conflate them.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Change the air filter',
    { mode: 'recurring-task', every: '3m', start: service.today })
  const list = await service.todoList()
  const made = await onList(service)
  await service.todoSetStatus(list, made[0] as string, 'done')
  const second = await service.reconcile()
  assert.deepEqual(second.made, [], 'June is not today')
  const items = await service.todoItems(list, service.today)
  assert.equal(items.length, 1, 'and the finished one is still there, still finished')
})

test('THE LONG ABSENCE, calendar-driven: a year away yields ONE birthday', async t => {
  // **The hazard that ACCUMULATES.** A pass that advanced the instance and
  // generated for each one it stepped over would produce a task per year — and
  // it would do it at the moment somebody came back from a sabbatical, which is
  // exactly when nobody is reading the list carefully.
  const { service, on } = await serviced(t, '2020-01-01T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const day = await service.docketAdd(id, 'Ada’s birthday',
    { mode: 'recurring-event', every: '1y', start: '2020-03-14' })
  const first = (await service.docketMatters(id))[0]?.steps[0]?.id ?? ''
  // A thing to do for it, so the instance is capable of being owed.
  await service.docketAddStep(id, day, '7d', 'buy a present')

  await on('2026-03-10')
  await service.reconcile()

  const matter = (await service.docketMatters(id))[0]
  assert.equal(matter?.when.start, '2026-03-14', 'the next one, not the thirtieth one')
  const list = await service.todoList()
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks),
    ['buy a present'])
  void first
})

test('THE LONG ABSENCE, completion-driven: a year away yields ONE, not none', async t => {
  // **The hazard that GOES QUIET**, which is the same absence failing the other
  // way: a completion-driven matter has no calendar to fall behind, so a pass
  // that treated *behind* as the trigger would find nothing to do and say
  // nothing about it. Being owed since 2020 must read as owed now.
  const { service, on } = await serviced(t, '2020-01-01T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Sharpen the mower blade',
    { mode: 'recurring-task', every: '6m', start: '2020-04-01' })

  await on('2026-03-10')
  await service.reconcile()
  const list = await service.todoList()
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks),
    ['Sharpen the mower blade'], 'still owed, and said so')
  const matter = (await service.docketMatters(id))[0]
  assert.equal(matter?.when.start, '2020-04-01',
    'and it has NOT moved, because nothing was done — six years overdue is the truth')
})

test('AN OUTSTANDING INSTANCE IS OVERDUE, not reissued (H7a)', async t => {
  // The rule that makes the long absence yield one rather than thirty, stated
  // on its own: a matter with something still owed does not move on.
  const { service, on } = await serviced(t, '2026-03-02T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const day = await service.docketAdd(id, 'The quarterly report',
    { mode: 'recurring-event', every: '3m', start: '2026-03-05' })
  await service.docketAddStep(id, day, '3d', 'write it')
  await service.reconcile()
  const list = await service.todoList()
  assert.equal((await service.todoItems(list, service.today)).length, 1, 'three days of run-up')

  await on('2026-07-01')
  await service.reconcile()
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2026-03-05',
    'sitting on the instance that is not finished')
  // **And still exactly ONE**, four months later: the task list carries an
  // undone item forward of its own accord, so *shown as overdue* is already
  // what happens — the rule above is only about not putting a second one
  // beside it. That is the whole of H7a, and the count is where it would fail.
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks),
    ['write it'])
})

test('and once it is settled it catches up in one step, to the CURRENT instance', async t => {
  const { service, on } = await serviced(t, '2026-03-02T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const day = await service.docketAdd(id, 'The quarterly report',
    { mode: 'recurring-event', every: '3m', start: '2026-03-05' })
  await service.docketAddStep(id, day, '3d', 'write it')
  const made = await onList(service)
  assert.equal(made.length, 1)
  const list = await service.todoList()

  await on('2026-07-01')
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2026-03-05', 'held, being owed')
  await service.todoSetStatus(list, made[0] as string, 'done')
  await service.reconcile()
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2026-09-05',
    'past June, which is also behind us, and stopped at the one ahead')
})

test('a recurring EVENT with nothing owed rolls forward on its own', async t => {
  // Which is the birthday that only wants to be known about: no task step, so
  // nothing can be outstanding, so the calendar is the only thing deciding.
  const { service, on } = await serviced(t, '2026-03-01T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Ada’s birthday',
    { mode: 'recurring-event', every: '1y', start: '2026-03-14' })

  await on('2026-03-20')
  await service.reconcile()
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2027-03-14')
})

test('THE CLAMP, exercised by the tick: the 31st keeps meaning the 31st', async t => {
  // Anchor-and-clamp is unit-tested on `addInterval`; this is the claim that the
  // pass that actually advances instances carries the anchor through, which is
  // where a month-end matter would quietly drift to the 28th and stay there.
  const { service, on } = await serviced(t, '2026-01-31T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Read the meter',
    { mode: 'recurring-task', every: '1m', start: '2026-01-31' })
  const list = await service.todoList()

  const seen: string[] = []
  for (let month = 0; month < 4; month += 1) {
    const due = (await service.docketMatters(id))[0]?.when.start ?? ''
    seen.push(due)
    await on(due)
    await service.reconcile()
    const step = (await service.docketMatters(id))[0]?.steps[0]
    assert.notEqual(step?.made, null, `something to do on ${due}`)
    await service.todoSetStatus(list, step?.made as string, 'done')
    await service.reconcile()
  }
  // February clamps to the 28th; March does NOT inherit the clamp.
  assert.deepEqual(seen, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
})

test('IDEMPOTENCE OVER THE WHOLE PASS: thirty runs leave one answer', async t => {
  // Which is the property the design is for, stated where it can fail: advance,
  // generate and withdraw all in one pass, run until the machine is bored.
  const { service, on } = await serviced(t, '2026-03-01T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const report = await service.docketAdd(id, 'The quarterly report',
    { mode: 'recurring-event', every: '3m', start: '2026-03-05' })
  await service.docketAddStep(id, report, '3d', 'write it')
  await service.docketAdd(id, 'Fix the skylight', { mode: 'task', start: '2026-03-01' })

  await on('2026-03-03')
  for (let run = 0; run < 30; run += 1) await service.reconcile()
  const list = await service.todoList()
  const texts = (await service.todoItems(list, service.today)).map(withoutMarks).sort()
  assert.deepEqual(texts, ['Fix the skylight', 'write it'])
  const after = await service.reconcile()
  assert.deepEqual(after, { made: [], withdrawn: [] }, 'and the thirty-first says nothing')
})

test('AND IT WITHDRAWS, because a reconciler that only adds is an event handler', async t => {
  // Suspending is *clear the start date* and nothing more; the pass is what
  // notices that the task it made is no longer wanted. Which is the whole
  // argument for the shape: one rule about what should be true, rather than a
  // bespoke undo beside every verb that can make it false.
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  await service.reconcile()
  const list = await service.todoList()
  assert.equal((await service.todoItems(list, service.today)).length, 1)

  // **Clearing the date is the whole act**, and the pass that follows it is
  // part of the verb now (MH4) — so the withdrawal has already happened by the
  // time this returns, and a second pass finds nothing left to take back.
  await service.docketSetStart(id, car, null)
  assert.deepEqual(await service.reconcile(), { made: [], withdrawn: [] })
  assert.equal((await service.todoItems(list, service.today)).length, 0)
  assert.equal((await service.docketMatters(id))[0]?.steps[0]?.made, null)
})

test('and withdrawing does not touch what a person typed, or what is done', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  const made = await onList(service)
  const list = await service.todoList()
  const mine = await service.todoAdd(list, 'something I typed myself')
  await service.todoSetStatus(list, made[0] as string, 'done')

  await service.docketSetStart(id, car, null)
  const { withdrawn } = await service.reconcile()
  assert.deepEqual(withdrawn, [], 'a finished task is a true statement about the past')
  assert.deepEqual((await service.todoItems(list, service.today)).map(one => one.id).sort(),
    [made[0] as string, mine].sort())
})

test('AND A MATTER WITH NO INTERVAL NEVER ADVANCES, however long it sits', async t => {
  // The one-off is the case a loop gets wrong: finishing it must not schedule
  // another one, and the pass must not spin looking for the next.
  const { service, on } = await serviced(t, '2026-03-01T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'Fix the skylight',
    { mode: 'task', start: '2026-03-01' })
  const made = await onList(service)
  const list = await service.todoList()
  await service.todoSetStatus(list, made[0] as string, 'done')

  await on('2027-03-01')
  assert.deepEqual(await service.reconcile(), { made: [], withdrawn: [] })
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2026-03-01')
  void car
})

// ── putting a generated task down (MH3b, amended) ───────────

test('THE WEDGE: nevermind on a generated task must not silence the matter', async t => {
  // **Found by reasoning about the UX, not by a test**, and it was live. A
  // dropped item leaves the step pointing at something nobody can see, never
  // done — so the clock never turned, the matter never advanced, and the docket
  // went on showing live work that could never be produced. The same *goes
  // quiet* failure MH3b has two tests for, through a door neither watched:
  // both assumed an item is either finished or left alone.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Change the air filter',
    { mode: 'recurring-task', every: '3m', start: '2026-03-10' })
  const list = await service.todoList()
  const made = await onList(service)
  assert.equal(made.length, 1)

  await service.todoSetStatus(list, made[0] as string, 'dropped')
  const matter = (await service.docketMatters(id))[0]
  assert.equal(matter?.when.start, '2026-06-10', 'it moved on, rather than stopping for ever')
})

test('and SKIPPING counts from the day it was SCHEDULED, not from today', async t => {
  // Which is the distinction that makes three verbs rather than two. *This one
  // did not happen* says nothing about when the next one is owed: an air filter
  // skipped in March is due in June, not three months after you gave up on it.
  const { service, on } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Change the air filter',
    { mode: 'recurring-task', every: '3m', start: '2026-03-10' })
  const list = await service.todoList()
  const made = await onList(service)

  // A fortnight of ignoring it, and then *nevermind*.
  await on('2026-03-24')
  await service.todoSetStatus(list, made[0] as string, 'dropped')
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2026-06-10',
    'three months from the tenth, not from the twenty-fourth')
})

test('whereas DOING it counts from the day it was done, which is the other verb', async t => {
  const { service, on } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Change the air filter',
    { mode: 'recurring-task', every: '3m', start: '2026-03-10' })
  const list = await service.todoList()
  const made = await onList(service)

  await on('2026-03-24')
  await service.todoSetStatus(list, made[0] as string, 'done')
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2026-06-24',
    'three months from when it actually happened')
})

test('and BACKLOG resolves it too, an item nobody can see being owed by nobody', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Change the air filter',
    { mode: 'recurring-task', every: '3m', start: '2026-03-10' })
  const list = await service.todoList()
  const made = await onList(service)
  await service.todoSetStatus(list, made[0] as string, 'backlog')
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2026-06-10')
})

test('A RECURRING EVENT IS NOT WEDGED BY IT EITHER, owed meaning STILL asked', async t => {
  // The calendar half of the same bug: *nothing left owing* was reading the
  // step rather than the list, so a dropped run-up task held the event on an
  // instance for ever — H7a's overdue rule turned into a trap.
  const { service, on } = await serviced(t, '2026-03-02T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const day = await service.docketAdd(id, 'The quarterly report',
    { mode: 'recurring-event', every: '3m', start: '2026-03-05' })
  await service.docketAddStep(id, day, '3d', 'write it')
  const list = await service.todoList()
  const made = await onList(service)

  await service.todoSetStatus(list, made[0] as string, 'dropped')
  await on('2026-07-01')
  await service.reconcile()
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2026-09-05',
    'past the one that was dropped and the one after it')
})

test('AND A DROPPED ITEM IS LEFT ALONE, dropping it being their decision too', async t => {
  // The withdrawal rule said *not while it is unfinished*, which would delete an
  // item somebody had deliberately put down — overruling them. What it was
  // always really about is not taking back what is no longer being asked.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  const list = await service.todoList()
  const made = await onList(service)

  await service.todoSetStatus(list, made[0] as string, 'dropped')
  await service.docketSuspend(id, car)
  const items = await service.todoItems(list, service.today)
  assert.equal(items.find(one => one.id === made[0])?.status, 'dropped',
    'still there, still their decision')
})

// ── activation generates, without waiting for a boundary (MH4 fix) ──

test('THE BUG: activating a matter puts its first step on the list NOW', async t => {
  // **Reported from use**, in the form the asymmetry actually takes: *I see the
  // task in the horizon but not in the TODO list.* The horizon is computed live
  // so it showed the step as still coming; the list is generated, and nothing
  // had asked for a pass since the start date was written. Until the next
  // startup or midnight, activating a matter did nothing at all.
  //
  // **Suspend reconciled and activate did not**, and the reason is instructive:
  // suspend got its pass because it had a bespoke withdrawal loop to delete, and
  // nothing prompted the same thought for the twenty-six verbs that never had
  // one. A list of *the writes that count* is the wrong shape (D77).
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const kia = await service.docketAdd(id, 'Kia repairs', { mode: 'task' })
  await service.docketAddStep(id, kia, 'then', 'repair group 1 items')

  await service.docketActivate(id, kia)
  const list = await service.todoList()
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks),
    ['Kia repairs'], 'without anybody asking for a pass')
  assert.notEqual((await service.docketMatters(id))[0]?.steps[0]?.made, null)
})

test('and every other schedule verb does the same, which is the general rule', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const talk = await service.docketAdd(id, 'The ACM talk', { mode: 'task' })
  const list = await service.todoList()

  // Setting a start date is the same act as activating, said differently.
  await service.docketSetStart(id, talk, '2026-03-10')
  assert.equal((await service.todoItems(list, service.today)).length, 1)

  // And taking it away withdraws again, which already worked and must keep to.
  await service.docketSetStart(id, talk, null)
  assert.equal((await service.todoItems(list, service.today)).length, 0)
})

test('and the pass does not summon itself for every step it generates', async t => {
  // The reconciler writes to the docket it is reconciling, so *a docket write
  // reconciles* has to exempt its own. It converges either way — the second
  // pass finds nothing — but a rule that relies on that is relying on luck.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  for (const name of ['One', 'Two', 'Three']) {
    const made = await service.docketAdd(id, name, { mode: 'task' })
    await service.docketActivate(id, made)
  }
  const list = await service.todoList()
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks).sort(),
    ['One', 'Three', 'Two'], 'one each, and none twice')
  assert.deepEqual(await service.reconcile(), { made: [], withdrawn: [] })
})

test('THE EVENING BUG: a step done after 4pm unblocks the next one TODAY', async t => {
  // **Reported from use, and the third of its family.** A completion stamp is an
  // instant; the day it fell on is a question about *where*. `dueOn` answered it
  // with `toISOString`, which answers for Greenwich — so finishing at 17:42 in a
  // GMT+8 notebook put the dependent step's date on TOMORROW, and the chain
  // silently stopped for the evening.
  //
  // The same one-clock-too-many that MH3b found putting wall-clock stamps on
  // completions, and that D62 exists to keep coherent. Tested at an hour where
  // the two zones disagree, because at ten in the morning they never do.
  const { service } = await serviced(t, '2026-03-11T01:42:00Z') // 2026-03-10 17:42 in zone
  assert.equal(service.today, '2026-03-10', 'the notebook is still on the tenth')

  const id = await service.newDocument('The house', undefined, 'docket')
  const kia = await service.docketAdd(id, 'Kia repairs', { mode: 'task' })
  await service.docketAddStep(id, kia, 'then', 'repair group 1 items')
  await service.docketActivate(id, kia)

  const list = await service.todoList()
  const first = (await service.docketMatters(id))[0]?.steps[0]
  await service.todoSetStatus(list, first?.made as string, 'done')

  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks).sort(),
    ['Kia repairs', 'repair group 1 items'],
    'the next step is here now, not at midnight')
})

test('and the horizon reads the same clock, or it would disagree with the list', async t => {
  const { service } = await serviced(t, '2026-03-11T01:42:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const kia = await service.docketAdd(id, 'Kia repairs', { mode: 'task' })
  await service.docketAddStep(id, kia, '+2d', 'collect it')
  await service.docketActivate(id, kia)
  // The seeded step generated on activation and carries a due date now, so it is
  // the task list's row; the step two days out is still the docket's. Both read
  // the same clock, which is the claim — one from a completion stamp and one
  // from a start date, and an hour where the zones disagree.
  const rows = await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey)
  assert.deepEqual(rows.map(one => [one.on, one.kind, one.text]), [
    ['2026-03-10', 'due', 'Kia repairs'],
    ['2026-03-12', 'task', 'collect it'],
  ])
})

test('A GENERATED ITEM IS TAGGED WITH ITS MATTER, rather than renamed by it', async t => {
  // On the list a step's text stands alone, and *find a general mechanic* says
  // nothing about which car. The first cut wrote the matter's name into the
  // title; a tag is what that fact actually is — drawn as a chip, groupable in
  // the by-tag view, and removable without editing the sentence.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const kia = await service.docketAdd(id, 'Kia repairs', { mode: 'task' })
  await service.docketAddStep(id, kia, '+0d', 'find a general mechanic')
  await service.docketActivate(id, kia)

  const list = await service.todoList()
  const items = await service.todoItems(list, service.today)
  assert.deepEqual(items.map(one => one.text).sort(), [
    // **The docket always; the matter only where it adds something.** The seeded
    // step's text IS the matter's name (D76), so tagging it with that says one
    // thing twice — a chip repeating the sentence beside it reads as a fault.
    "Kia repairs #'The house' DUE 2026-03-10",
    "find a general mechanic #'Kia repairs' #'The house' DUE 2026-03-10",
  ])
  // And they are real tags, not text that looks like one.
  assert.deepEqual([...new Set(items.flatMap(one => one.tags))].sort(),
    ['Kia repairs', 'The house'])
})

test("and a name with an apostrophe is tagged too — Ada's birthday", async t => {
  // The quoted form had no escape, so this was briefly refused rather than
  // mangled; refusing is an absurd thing to do to a name that ordinary, and the
  // grammar grew the escape the query field already used for quoted phrases.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const day = await service.docketAdd(id, "Ada's birthday", { mode: 'task' })
  await service.docketActivate(id, day)
  const list = await service.todoList()
  const items = await service.todoItems(list, service.today)
  assert.deepEqual(items.map(withoutMarks), ["Ada's birthday"])
  assert.deepEqual(items.flatMap(one => one.tags), ['The house'],
    'the docket, the matter being what the step already says')
})

test('and the way back exists: an item says which matter made it', async t => {
  // **One direction stored, both traversable** (D79). The step records what it
  // made; the reverse is a question rather than a second copy that could drift.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const kia = await service.docketAdd(id, 'Kia repairs', { mode: 'task' })
  await service.docketActivate(id, kia)
  const made = (await service.docketMatters(id))[0]?.steps[0]?.made as string

  assert.deepEqual(await service.matterFor(made), { docket: id, matter: kia })

  // And a task somebody typed came from nowhere, which is not an error.
  const list = await service.todoList()
  const mine = await service.todoAdd(list, 'something I typed myself')
  assert.equal(await service.matterFor(mine), null)
})

// ── an explicit list of instances (H7, restored) ────────────
//
// **Not a new idea: H7 asked for it and D76 withdrew it** for want of evidence.
// The evidence is a game whose next few sessions are agreed in a chat thread —
// neither one date nor a rule, so an interval would be a lie about it and a
// matter per session would lose the identity recurrence exists to keep (H7a).

test('THE POINT: a matter can have its instances listed rather than computed', async t => {
  const { service } = await serviced(t, '2026-09-13T09:00:00Z')
  const id = await service.newDocument('Games', undefined, 'docket')
  const game = await service.docketAdd(id, 'The campaign', { mode: 'recurring-event' })
  await service.docketSetDates(id, game, ['2026-09-20', '2026-10-04', '2026-10-18'] as DateKey[])

  const matter = (await service.docketMatters(id))[0]
  assert.equal(matter?.when.start, '2026-09-20', 'the first one still ahead')
  assert.deepEqual(matter?.when.dates, ['2026-09-20', '2026-10-04', '2026-10-18'])
  assert.equal(matter?.when.every, null, 'a list is an ALTERNATIVE to an interval')
})

test('and they arrive out of order, because nobody agrees sessions in order', async t => {
  const { service } = await serviced(t, '2026-09-13T09:00:00Z')
  const id = await service.newDocument('Games', undefined, 'docket')
  const game = await service.docketAdd(id, 'The campaign', { mode: 'recurring-event' })
  await service.docketSetDates(id, game,
    ['2026-10-18', '2026-09-20', '2026-10-04', '2026-09-20'] as DateKey[])
  assert.deepEqual((await service.docketMatters(id))[0]?.when.dates,
    ['2026-09-20', '2026-10-04', '2026-10-18'], 'sorted, and said once each')
})

test('THE HORIZON READS THE LIST, rather than computing a sequence', async t => {
  const { service } = await serviced(t, '2026-09-13T09:00:00Z')
  const id = await service.newDocument('Games', undefined, 'docket')
  const game = await service.docketAdd(id, 'The campaign', { mode: 'recurring-event' })
  await service.docketSetDates(id, game, ['2026-09-20', '2026-10-04', '2026-11-29'] as DateKey[])

  const rows = await service.horizon('2026-09-01' as DateKey, '2026-10-31' as DateKey)
  assert.deepEqual(rows.map(one => one.on), ['2026-09-20', '2026-10-04'],
    'the two in the window, and not the one past its end')
})

test('AND IT ADVANCES TO THE NEXT ONE WRITTEN DOWN, not to a computed date', async t => {
  const { service, on } = await serviced(t, '2026-09-13T09:00:00Z')
  const id = await service.newDocument('Games', undefined, 'docket')
  const game = await service.docketAdd(id, 'The campaign', { mode: 'recurring-event' })
  await service.docketSetDates(id, game, ['2026-09-20', '2026-10-04'] as DateKey[])

  await on('2026-09-21')
  await service.reconcile()
  assert.equal((await service.docketMatters(id))[0]?.when.start, '2026-10-04',
    'the next session, whatever the gap was')
})

test('and running out of dates leaves it with NO DATE, which is the honest state', async t => {
  // A campaign whose next few sessions have not been agreed yet is exactly what
  // *no date yet* already means — and it puts the matter back in front of
  // somebody at the moment they would know the answer.
  const { service, on } = await serviced(t, '2026-09-13T09:00:00Z')
  const id = await service.newDocument('Games', undefined, 'docket')
  const game = await service.docketAdd(id, 'The campaign', { mode: 'recurring-event' })
  await service.docketSetDates(id, game, ['2026-09-20'] as DateKey[])

  await on('2026-09-21')
  await service.reconcile()
  const matter = (await service.docketMatters(id))[0]
  assert.equal(matter?.when.start, null, 'no more sessions scheduled')
  assert.deepEqual(matter?.when.dates, ['2026-09-20'], 'and the list is kept, being what happened')
  assert.deepEqual(await service.horizon('2026-01-01' as DateKey, '2027-01-01' as DateKey), [])
})

test('and setting an interval afterwards clears the list, both being one answer', async t => {
  const { service } = await serviced(t, '2026-09-13T09:00:00Z')
  const id = await service.newDocument('Games', undefined, 'docket')
  const game = await service.docketAdd(id, 'The campaign', { mode: 'recurring-event' })
  await service.docketSetDates(id, game, ['2026-09-20', '2026-10-04'] as DateKey[])
  await service.docketSetEvery(id, game, '2w')
  const matter = (await service.docketMatters(id))[0]
  assert.notEqual(matter?.when.every, null)
  assert.equal(matter?.when.dates, null, 'a matter must not hold two answers')
})

test('A GENERATED TASK CARRIES ITS DUE DATE, which the schedule already knew', async t => {
  // It arrived with no deadline, so it sorted with the undated and said nothing
  // about the rhythm it belongs to — *change the water filter every 120 days* is
  // not the same kind of thing as a note to self.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Change the water filter',
    { mode: 'recurring-task', every: '120d', start: '2026-03-10' })

  const list = await service.todoList()
  const items = await service.todoItems(list, service.today)
  assert.equal(items[0]?.due, '2026-03-10', 'the day the schedule says it should happen')
  assert.deepEqual(items.map(withoutMarks), ['Change the water filter'])
})

test('and a RUN-UP step is due on its own day, not on the occasion it leads to', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const day = await service.docketAdd(id, 'The ACM talk',
    { mode: 'event', start: '2026-03-17' })
  await service.docketAddStep(id, day, '7d', 'write the slides')

  const list = await service.todoList()
  const items = await service.todoItems(list, service.today)
  assert.deepEqual(items.map(one => [withoutMarks(one), one.due]),
    [['write the slides', '2026-03-10']], 'the day it is meant to be done, not the 17th')
})

test('and the horizon does not show it twice, the two sources staying disjoint', async t => {
  // A due date is the task list's source; the step that made it is no longer the
  // docket's. Without this the same commitment would be counted twice.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Change the water filter',
    { mode: 'recurring-task', every: '120d', start: '2026-03-10' })

  const rows = await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey)
  assert.deepEqual(rows.map(one => [one.on, one.kind, one.text]),
    [['2026-03-10', 'due', 'Change the water filter']], 'once, as a dated task')
})

test("and a matter's own tag is dropped only when the STEP already says it", async t => {
  // The rule is about redundancy, not about single-step matters: a matter with
  // three steps whose first repeats its name drops it on that one and keeps it
  // on the others, because that is where the fact is and is not.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('Burrow', undefined, 'docket')
  const kia = await service.docketAdd(id, 'Kia repairs', { mode: 'task' })
  await service.docketAddStep(id, kia, '+0d', 'book the garage')
  await service.docketActivate(id, kia)

  const list = await service.todoList()
  const items = await service.todoItems(list, service.today)
  assert.deepEqual(
    items.map(one => [withoutMarks(one), [...one.tags].sort()]).sort(),
    [
      ['Kia repairs', ['Burrow']],
      ['book the garage', ['Burrow', 'Kia repairs']],
    ],
  )
})

test('and every generated task carries its DOCKET, which is the link back', async t => {
  // The docket is the durable grouping — the house, work, games — so it is the
  // tag somebody would actually pivot the list on.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const house = await service.newDocument('The house', undefined, 'docket')
  const work = await service.newDocument('Work', undefined, 'docket')
  const boiler = await service.docketAdd(house, 'Service the boiler', { mode: 'task' })
  const talk = await service.docketAdd(work, 'The ACM talk', { mode: 'task' })
  await service.docketActivate(house, boiler)
  await service.docketActivate(work, talk)

  const list = await service.todoList()
  assert.deepEqual(
    (await service.todoItems(list, service.today))
      .map(one => [withoutMarks(one), one.tags.join('')]).sort(),
    [['Service the boiler', 'The house'], ['The ACM talk', 'Work']],
  )
})

test("AN OWNER TRAVELS to the work the matter makes, as a marker", async t => {
  // Whoever has the matter has the task it generates — and it travels as
  // `OWNER Sam` rather than as words in the title, so the list can be asked
  // *what does Sam have* and a summary can take it off again.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const tap = await service.docketAdd(id, 'Fix the dripping tap', { mode: 'task' })
  await service.docketSetOwner(id, tap, 'Sam')
  await service.docketActivate(id, tap)

  const list = await service.todoList()
  const item = (await service.todoItems(list, service.today))[0]
  assert.equal(item?.owner, 'Sam')
  assert.equal(withoutMarks(item as never), 'Fix the dripping tap')
})

test('and a matter with no owner generates a task with none, not an empty one', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const tap = await service.docketAdd(id, 'Fix the dripping tap', { mode: 'task' })
  await service.docketActivate(id, tap)
  const list = await service.todoList()
  assert.equal((await service.todoItems(list, service.today))[0]?.owner, null)
})

// ── the backlog becomes a docket (MH5, T14) ─────────────────
//
// **Regathered FROM, never routed INTO.** Deciding at three in the afternoon
// that a task is not-now must cost one keystroke and zero decisions — *which
// container does this go in?* is the friction that sank the system before this
// one. So it goes to the miscellaneous docket, and the review is where filing
// happens, because that is the moment routing is cheap.

test('THE POINT: putting a task down gives it a home and leaves its line alone', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed #house OWNER Sam')

  const made = await service.todoPutDown(list, item)
  assert.notEqual(made, null)

  // The line stays, saying what happened to it: `[>]` is *transferred*, which
  // counts as resolved — so its history is continuous and its id still resolves.
  const line = (await service.todoItems(list, service.today)).find(one => one.id === item)
  assert.equal(line?.status, 'backlog')
  assert.equal(withoutMarks(line as never), 'repaint the shed')

  // And it is a matter on the miscellaneous docket, undated and not started.
  const matters = await service.docketMatters(BACKLOG_DOCKET)
  assert.deepEqual(matters.map(one => one.name), ['repaint the shed'])
  assert.equal(matters[0]?.when.start, null, 'not started: dating it is the review\'s job')
})

test('and its subjects and its owner come with it, being facts about the THING', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed #house OWNER Sam DUE 2026-03-20')
  await service.todoPutDown(list, item)

  const matter = (await service.docketMatters(BACKLOG_DOCKET))[0]
  assert.deepEqual(matter?.tags, ['house'])
  assert.equal(matter?.owner, 'Sam')
  // The due date does NOT: a deadline you have just declined is not one.
  assert.equal(matter?.when.start, null)
})

test('and a task a DOCKET made is not given a second home', async t => {
  // It has a matter already; putting it down is that matter's business (D79),
  // and a misc entry beside it would be one commitment in two places.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const tap = await service.docketAdd(id, 'Fix the tap', { mode: 'task' })
  await service.docketActivate(id, tap)
  const list = await service.todoList()
  const made = (await service.docketMatters(id))[0]?.steps[0]?.made as string

  assert.equal(await service.todoPutDown(list, made), null, 'nowhere new to go')
  assert.deepEqual(await service.docketMatters(BACKLOG_DOCKET), [])
})

test('and putting down twice does not make two of it', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed')
  await service.todoPutDown(list, item)
  await service.todoPutDown(list, item)
  assert.equal((await service.docketMatters(BACKLOG_DOCKET)).length, 1)
})

test('and somewhere else, when the answer is already known', async t => {
  // Naming a docket at the moment of backlogging stays available for when you
  // do know; it is never required.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const house = await service.newDocument('The house', undefined, 'docket')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed')
  await service.todoPutDown(list, item, house)
  assert.deepEqual((await service.docketMatters(house)).map(one => one.name), ['repaint the shed'])
  assert.deepEqual(await service.docketMatters(BACKLOG_DOCKET), [])
})

test('THE BUG: putting down a CARRIED item marks the line it is on now', async t => {
  // Reported from use: the matter appeared on the miscellaneous docket and the
  // task stayed `[ ]`, so the list looked untouched and the gesture looked
  // broken — and pressing it again made a second matter. The item had been
  // carried for days, which every item on a real list has been and none in the
  // first tests had.
  const { service, on } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'Build the checklist #peru')
  await on('2026-03-11')
  await on('2026-03-12')
  await service.todoList()

  await service.todoPutDown(list, item)
  const now = (await service.todoItems(list, service.today)).find(one => one.id === item)
  assert.equal(now?.status, 'backlog', 'the line says it was transferred')
  assert.equal((await service.docketMatters(BACKLOG_DOCKET)).length, 1)

  // And pressing again is a no-op, which is what a repeated keystroke needs.
  await service.todoPutDown(list, item)
  assert.equal((await service.docketMatters(BACKLOG_DOCKET)).length, 1)
})

test('and the backlog docket lives with the others, and is NAMED', async t => {
  // The first cut put it at the notebook root, reasoning that a distinguished
  // document belongs beside `tasks.todo`. It was invisible: that is not where
  // anything looks for a docket, so putting a task down appeared to do nothing.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  await service.todoPutDown(list, await service.todoAdd(list, 'repaint the shed'))

  const rows = await service.dockets()
  assert.deepEqual(rows.map(one => [one.id, one.title]),
    [['dockets/backlog.docket.md', 'Backlog']])
})

test('UNDO CANNOT REACH A MOVE, because a transfer is not text you typed', async t => {
  // **Reported from use, and the second design won.** Moving writes two
  // documents and undo is per-document, so an undoable move left the line live
  // while the matter stood — one commitment in two places. Every repair for that
  // is a revertible cross-store transaction, and those are as messy here as
  // anywhere else: the first attempt needed provenance on the matter, a rule
  // about it surviving only until touched, and a reconciler clause.
  //
  // Naming the write dissolved all of it. A move changes who owns the thing;
  // ownership is not text somebody typed; undo is for text somebody typed.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed')
  await service.todoPutDown(list, item)

  // **Undo reaches past it**, to the edit before — here, the line's creation.
  // That is the point: the transfer is not on the stack at all, so there is no
  // half-undone state to repair and nothing for a reconciler to notice.
  await service.undo(list)
  const live = (await service.todoItems(list, service.today))
    .filter(one => one.id === item && isLive(one.status))
  assert.deepEqual(live, [], 'nothing came back to the list')
  assert.equal((await service.docketMatters(BACKLOG_DOCKET)).length, 1,
    'and the matter stands, being the docket\'s from the moment it arrived')
})

test('and the line says where it went, in the file and not only on screen', async t => {
  // R26: a day file reading `[>] fix the tap` without saying where it went is a
  // worse record than one that says.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const house = await service.newDocument('The house', undefined, 'docket')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed')
  await service.todoPutDown(list, item, house)

  const line = (await service.todoItems(list, service.today)).find(one => one.id === item)
  assert.equal(line?.moved, 'The house')
  assert.match(line?.text ?? '', /MOVED 'The house'/)
  // And it comes off for a summary, being a fact about the task and not its words.
  assert.equal(withoutMarks(line as never), 'repaint the shed')
})

test("AN OWNER TRAVELS to the work the matter makes, as a marker", async t => {
  // Whoever has the matter has the task it generates — and it travels as
  // `OWNER Sam` rather than as words in the title, so the list can be asked
  // *what does Sam have* and a summary can take it off again.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const tap = await service.docketAdd(id, 'Fix the dripping tap', { mode: 'task' })
  await service.docketSetOwner(id, tap, 'Sam')
  await service.docketActivate(id, tap)

  const list = await service.todoList()
  const item = (await service.todoItems(list, service.today))[0]
  assert.equal(item?.owner, 'Sam')
  assert.equal(withoutMarks(item as never), 'Fix the dripping tap')
})

test('and a matter with no owner generates a task with none, not an empty one', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const tap = await service.docketAdd(id, 'Fix the dripping tap', { mode: 'task' })
  await service.docketActivate(id, tap)
  const list = await service.todoList()
  assert.equal((await service.todoItems(list, service.today))[0]?.owner, null)
})

// ── the backlog becomes a docket (MH5, T14) ─────────────────
//
// **Regathered FROM, never routed INTO.** Deciding at three in the afternoon
// that a task is not-now must cost one keystroke and zero decisions — *which
// container does this go in?* is the friction that sank the system before this
// one. So it goes to the miscellaneous docket, and the review is where filing
// happens, because that is the moment routing is cheap.

test('THE POINT: putting a task down gives it a home and leaves its line alone', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed #house OWNER Sam')

  const made = await service.todoPutDown(list, item)
  assert.notEqual(made, null)

  // The line stays, saying what happened to it: `[>]` is *transferred*, which
  // counts as resolved — so its history is continuous and its id still resolves.
  const line = (await service.todoItems(list, service.today)).find(one => one.id === item)
  assert.equal(line?.status, 'backlog')
  assert.equal(withoutMarks(line as never), 'repaint the shed')

  // And it is a matter on the miscellaneous docket, undated and not started.
  const matters = await service.docketMatters(BACKLOG_DOCKET)
  assert.deepEqual(matters.map(one => one.name), ['repaint the shed'])
  assert.equal(matters[0]?.when.start, null, 'not started: dating it is the review\'s job')
})

test('and its subjects and its owner come with it, being facts about the THING', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed #house OWNER Sam DUE 2026-03-20')
  await service.todoPutDown(list, item)

  const matter = (await service.docketMatters(BACKLOG_DOCKET))[0]
  assert.deepEqual(matter?.tags, ['house'])
  assert.equal(matter?.owner, 'Sam')
  // The due date does NOT: a deadline you have just declined is not one.
  assert.equal(matter?.when.start, null)
})

test('and a task a DOCKET made is not given a second home', async t => {
  // It has a matter already; putting it down is that matter's business (D79),
  // and a misc entry beside it would be one commitment in two places.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const tap = await service.docketAdd(id, 'Fix the tap', { mode: 'task' })
  await service.docketActivate(id, tap)
  const list = await service.todoList()
  const made = (await service.docketMatters(id))[0]?.steps[0]?.made as string

  assert.equal(await service.todoPutDown(list, made), null, 'nowhere new to go')
  assert.deepEqual(await service.docketMatters(BACKLOG_DOCKET), [])
})

test('and putting down twice does not make two of it', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed')
  await service.todoPutDown(list, item)
  await service.todoPutDown(list, item)
  assert.equal((await service.docketMatters(BACKLOG_DOCKET)).length, 1)
})

test('and somewhere else, when the answer is already known', async t => {
  // Naming a docket at the moment of backlogging stays available for when you
  // do know; it is never required.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const house = await service.newDocument('The house', undefined, 'docket')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed')
  await service.todoPutDown(list, item, house)
  assert.deepEqual((await service.docketMatters(house)).map(one => one.name), ['repaint the shed'])
  assert.deepEqual(await service.docketMatters(BACKLOG_DOCKET), [])
})

test('THE BUG: putting down a CARRIED item marks the line it is on now', async t => {
  // Reported from use: the matter appeared on the miscellaneous docket and the
  // task stayed `[ ]`, so the list looked untouched and the gesture looked
  // broken — and pressing it again made a second matter. The item had been
  // carried for days, which every item on a real list has been and none in the
  // first tests had.
  const { service, on } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'Build the checklist #peru')
  await on('2026-03-11')
  await on('2026-03-12')
  await service.todoList()

  await service.todoPutDown(list, item)
  const now = (await service.todoItems(list, service.today)).find(one => one.id === item)
  assert.equal(now?.status, 'backlog', 'the line says it was transferred')
  assert.equal((await service.docketMatters(BACKLOG_DOCKET)).length, 1)

  // And pressing again is a no-op, which is what a repeated keystroke needs.
  await service.todoPutDown(list, item)
  assert.equal((await service.docketMatters(BACKLOG_DOCKET)).length, 1)
})

test('and the backlog docket lives with the others, and is NAMED', async t => {
  // The first cut put it at the notebook root, reasoning that a distinguished
  // document belongs beside `tasks.todo`. It was invisible: that is not where
  // anything looks for a docket, so putting a task down appeared to do nothing.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  await service.todoPutDown(list, await service.todoAdd(list, 'repaint the shed'))

  const rows = await service.dockets()
  assert.deepEqual(rows.map(one => [one.id, one.title]),
    [['dockets/backlog.docket.md', 'Backlog']])
})


test('A MATTER MOVES BETWEEN DOCKETS, carrying what it is', async t => {
  // Which is what reverses a move from the task list, and what the review does
  // when it files something out of the backlog into the domain it belongs to.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const house = await service.newDocument('The house', undefined, 'docket')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed #outside OWNER Sam')
  const made = await service.todoPutDown(list, item) as string
  await service.docketAddStep(BACKLOG_DOCKET, made, 'then', 'buy the paint')
  await service.docketSetNotes(BACKLOG_DOCKET, made, ['the south wall is worst'])

  const moved = await service.docketMoveTo(BACKLOG_DOCKET, made, house) as string
  assert.deepEqual(await service.docketMatters(BACKLOG_DOCKET), [], 'gone from the old one')

  const there = (await service.docketMatters(house)).find(one => one.id === moved)
  assert.equal(there?.name, 'repaint the shed')
  assert.deepEqual(there?.tags, ['outside'])
  assert.equal(there?.owner, 'Sam')
  assert.deepEqual(there?.notes, ['the south wall is worst'])
  assert.deepEqual(there?.steps.map(one => one.text), ['repaint the shed', 'buy the paint'])
  // **And the chain survives**, which is what naming steps by index buys: an
  // `after` pointing at the old docket's id would have pointed at nothing.
  assert.equal(there?.steps[1]?.when.kind, 'after')
  assert.equal(there?.steps[1]?.when.kind === 'after' ? there.steps[1].when.step : null,
    there?.steps[0]?.id)
})

test('and ACTIVATING is how it comes back to the list, freshly', async t => {
  // H7a: the matter is the durable thing and each occurrence mints a new task.
  // So *move it back* is not a verb — it is what starting it already does.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'repaint the shed')
  const made = await service.todoPutDown(list, item) as string

  await service.docketActivate(BACKLOG_DOCKET, made)
  const items = await service.todoItems(list, service.today)
  assert.deepEqual(items.filter(one => isLive(one.status)).map(withoutMarks), ['repaint the shed'])
  // And the old line is still the record of what happened to it.
  assert.equal(items.find(one => one.id === item)?.moved, 'Backlog')
})

test('REORDERING SECTIONS: a whole section moves, contents and all', async t => {
  // Reported from use: *there's no way to reorder sections in a docket*. The
  // only way before this was to move every matter out of one heading and into
  // another, which rebuilds the sections rather than reordering them.
  const { doc, file, boiler, oven, kitchen } = await three(t)
  await doc.addSection('Periodic')
  await doc.addSection('Major projects')
  await doc.moveMatter(boiler, 'Periodic')
  await doc.moveMatter(oven, 'Major projects')
  await doc.moveMatter(kitchen, 'Major projects')
  assert.deepEqual(await named(doc), [
    ['Periodic', ['Service the boiler']],
    ['Major projects', ['The oven is broken', 'Redo the kitchen']],
  ])

  assert.equal(await doc.nudgeSection('Major projects', -1), true)
  assert.deepEqual(await named(doc), [
    ['Major projects', ['The oven is broken', 'Redo the kitchen']],
    ['Periodic', ['Service the boiler']],
  ], 'the matters travel with the heading, in their own order')
  const text = await file()
  assert.match(text, /^### The oven is broken$/m, 'and stay nested exactly as deep')
  assert.match(text, /^### Service the boiler$/m)
  // The file must still be a file: one blank line between runs, no run of them.
  assert.doesNotMatch(text, /\n\n\n/, 'no gap opened or doubled by the exchange')
  assert.match(text, /\n$/, 'and it still ends in a newline')
})

test('and down is the same move, seen from the other section', async t => {
  const { doc, boiler, oven } = await three(t)
  await doc.addSection('Periodic')
  await doc.addSection('Major projects')
  await doc.moveMatter(boiler, 'Periodic')
  await doc.moveMatter(oven, 'Major projects')
  assert.equal(await doc.nudgeSection('Periodic', 1), true)
  assert.deepEqual((await doc.sections()).map(s => s.name), ['', 'Major projects', 'Periodic'])
})

test('AT THE ENDS IT IS FALSE, not an error — the ends are ordinary', async t => {
  const { doc } = await three(t)
  await doc.addSection('Periodic')
  await doc.addSection('Major projects')
  assert.equal(await doc.nudgeSection('Periodic', -1), false, 'already first')
  assert.equal(await doc.nudgeSection('Major projects', 1), false, 'already last')
  assert.equal(await doc.nudgeSection('Periodic', 0), false, 'and nowhere is nowhere')
  assert.deepEqual((await doc.sections()).map(s => s.name), ['', 'Periodic', 'Major projects'])
  await assert.rejects(() => doc.nudgeSection('Nonesuch', 1), /no section called Nonesuch/)
})

test('THE UNDIVIDED RUN DOES NOT TAKE PART: nothing goes above it', async t => {
  // It is not a section but a definition — everything above the first heading —
  // so a section nudged to the front still sits below it.
  const { doc, boiler } = await three(t)
  await doc.addSection('Periodic')
  await doc.moveMatter(boiler, 'Periodic')
  assert.equal(await doc.nudgeSection('Periodic', -1), false)
  assert.deepEqual(await named(doc), [
    ['', ['The oven is broken', 'Redo the kitchen']],
    ['Periodic', ['Service the boiler']],
  ])
})

test('and an exchange is reversible, which is what makes it an exchange', async t => {
  const { doc, file } = await three(t)
  await doc.addSection('Periodic')
  await doc.addSection('Major projects')
  const before = await file()
  await doc.nudgeSection('Periodic', 1)
  await doc.nudgeSection('Periodic', -1)
  assert.equal(await file(), before, 'there and back is where it started')
})

// ── the boundary between primary and derived (D77) ──────────────────────────
//
// **`reconcile()` exists to rebuild derived items from primary ones**, which is
// only safe while it can tell the two apart. It can: every generated item is
// recorded on the step that made it (`step.made`), so the reconciler never
// matches on text or on tags and never guesses. These pin that boundary from
// the outside, because until now it was stated in a comment and enforced by a
// condition, and nothing would have noticed either of them changing.

test('PRIMARY IS UNTOUCHABLE: a typed task is nobody else\'s business', async t => {
  const { service } = await serviced(t)
  const list = await service.todoList()
  const mine = await service.todoAdd(list, 'Ring the dentist')
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  // Suspending withdraws what the docket made — and only that.
  await service.docketSuspend(id, car)
  const left = await service.todoItems(list, service.today)
  assert.deepEqual(left.map(withoutMarks), ['Ring the dentist'])
  assert.equal(left[0]?.id, mine, 'the same item, not a rebuilt lookalike')
})

test('and text identical to a generated one is still typed, not adopted', async t => {
  // The reconciler could have matched on the sentence. It does not, and this is
  // what says so: two items reading the same, one owned and one not.
  const { service } = await serviced(t)
  const list = await service.todoList()
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  const mine = await service.todoAdd(list, 'The car needs fixing')
  await service.docketSuspend(id, car)
  const left = await service.todoItems(list, service.today)
  assert.deepEqual(left.map(one => one.id), [mine], 'the docket took back only its own')
})

test('DERIVED IS RECOVERABLE FROM PRIMARY: the step names what it made', async t => {
  const { service } = await serviced(t)
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketActivate(id, car)
  const list = await service.todoList()
  const made = (await service.todoItems(list, service.today))[0]?.id ?? ''
  assert.notEqual(made, '')
  const step = (await service.docketMatters(id))[0]?.steps[0]
  assert.equal(step?.made, made, 'the link is stored on the PRIMARY side')
  // And it reads back the other way, which is what the surfaces ask.
  assert.deepEqual(await service.matterFor(made), { docket: id, matter: car })
  // A typed one belongs to nothing, and says so rather than guessing.
  const mine = await service.todoAdd(list, 'Ring the dentist')
  assert.equal(await service.matterFor(mine), null)
})

test('A RESOLVED ITEM IS A FACT ABOUT THE PAST: reconcile leaves it alone', async t => {
  // Three exemptions that are one exemption. Once somebody has answered an item
  // — ticked, dropped, or moved on — taking it back would be overruling them,
  // and the reconciler's business is only what is still being asked.
  for (const answer of ['done', 'dropped'] as const) {
    const { service } = await serviced(t)
    const id = await service.newDocument('The house', undefined, 'docket')
    const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
    await service.docketActivate(id, car)
    const list = await service.todoList()
    const made = (await service.todoItems(list, service.today))[0]?.id ?? ''
    await service.todoSetStatus(list, made, answer)
    await service.docketSuspend(id, car)
    const left = await service.todoItems(list, service.today)
    assert.deepEqual(left.map(one => one.id), [made], `a ${answer} item stayed`)
    assert.equal(left[0]?.status, answer, 'and kept the answer it was given')
  }
})
