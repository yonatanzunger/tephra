// The TODO document (MT2, D55, D56).
//
// **No surface, and that is deliberate.** The data model is where the decisions
// are and where a mistake is expensive — an id written wrong on the first day
// is expensive to retrofit onto a year of carried-forward lines — so the kind
// gets driven through its own verbs before anything draws it.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { Corpus } from '../../src/main/x/documents/corpus.ts'
import { TodoDocument } from '../../src/main/x/documents/kinds/todo.ts'
import { parseItem } from '../../src/shared/kinds/todo.ts'
import type { DateKey, DocumentId } from '../../src/shared/document-api.ts'

const LIST = 'main.todo' as DocumentId
const MON = '2026-09-07' as DateKey
const TUE = '2026-09-08' as DateKey
const THU = '2026-09-10' as DateKey

const dayText = (date: DateKey, lines: readonly string[]): string =>
  `---\ntephra: 1\ndate: ${date}\nkind: todo\n---\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`

async function list(t: TestContext, days: Partial<Record<string, readonly string[]>> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-todo-'))
  for (const [date, lines] of Object.entries(days)) {
    const [y, m] = (date as string).split('-') as [string, string]
    await mkdir(join(root, 'main.todo', y, m), { recursive: true })
    await writeFile(join(root, 'main.todo', y, m, `${date}.md`), dayText(date as DateKey, lines ?? []))
  }
  const notebook = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => notebook.close())
  const corpus = new Corpus(notebook)
  const doc = (await corpus.use(LIST, async d => d)) as unknown as TodoDocument
  return {
    root,
    corpus,
    doc,
    /** What one day's file says, once the write tiers have run. */
    async fileOn(date: DateKey): Promise<string> {
      await corpus.flushAll()
      const [y, m] = date.split('-') as [string, string]
      return readFile(join(root, 'main.todo', y, m, `${date}.md`), 'utf8').catch(() => '')
    },
  }
}

test('a todo list opens as a todo document, by the name of its directory', async t => {
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank'] })
  assert.equal(doc.meta.kind, 'todo')
  assert.equal(doc.id, LIST)
  assert.deepEqual(await doc.keys(), [MON])
})

test('adopting gives a hand-written line an identity, and resolves its date', async t => {
  // Flow 9: somebody typed a line into the file. It is an item; it becomes one
  // the app can act on when the day is next written, because every verb
  // addresses an item by id.
  const { doc, fileOn } = await list(t, { [MON]: ['- [ ] file the return DUE FRIDAY'] })
  assert.equal(await doc.adopt(MON), 1)

  const items = await doc.itemsOn(MON)
  assert.equal(items.length, 1)
  assert.ok(items[0]?.id !== null, 'it has an identity now')
  assert.equal(items[0]?.id?.length, 8)
  assert.ok((items[0]?.ctime ?? 0) > 1_700_000_000, 'and a real timestamp, in seconds')
  // **`DUE FRIDAY` in a file would mean something different every week** (T16).
  assert.equal(items[0]?.due, '2026-09-11', 'the Friday after Monday the 7th')

  assert.match(await fileOn(MON), /DUE 2026-09-11 <!--tephra:item [0-9a-z]{8} \d+ \d+-->/)
  assert.equal(await doc.adopt(MON), 0, 'and adopting again changes nothing')
})

test('THE CARRY: a new day is materialised from the last one that has a file', async t => {
  const { doc } = await list(t, {
    [MON]: [
      '- [ ] ring the bank <!--tephra:item aaaaaaaa 1000 1000-->',
      '- [/] read the survey <!--tephra:item bbbbbbbb 1000 1000-->',
      '- [?] get the deeds — waiting on the solicitor <!--tephra:item cccccccc 1000 1000-->',
      '- [x] call the surveyor <!--tephra:item dddddddd 1000 1000-->',
      '- [-] look at the loft <!--tephra:item eeeeeeee 1000 1000-->',
      '- [>] think about the garden <!--tephra:item ffffffff 1000 1000-->',
    ],
  })

  assert.equal(await doc.carry(TUE), 3)
  const carried = await doc.itemsOn(TUE)
  // What carries is what is still yours. Done, nevermind and backlogged stay in
  // the day they were finished — nothing evicts them, they simply do not come.
  assert.deepEqual(carried.map(i => i.id), ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'])
  assert.deepEqual(carried.map(i => i.status), ['todo', 'doing', 'blocked'])
  assert.equal(carried[2]?.note, 'waiting on the solicitor', 'and a blocked item keeps its reason')
  // Copying is not modifying: identity, ctime and mtime all survive.
  assert.equal(carried[0]?.ctime, 1000)
  assert.equal(carried[0]?.mtime, 1000)

  // And Monday is untouched: it is the record of what Monday looked like.
  assert.equal((await doc.itemsOn(MON)).length, 6)
})

test('the carry is idempotent, and stands across days nobody opened', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] ring the bank <!--tephra:item aaaaaaaa 1000 1000-->'],
  })
  // Opening on Thursday having last opened on Monday produces Thursday's set
  // from Monday's, once — the case a walk-driven carry could not survive,
  // because the walk is offered and never compelled (T11, D55 as revised).
  assert.equal(await doc.carry(THU), 1)
  assert.equal(await doc.carry(THU), -1, 'a second carry on the same day does nothing')
  assert.deepEqual((await doc.itemsOn(THU)).map(i => i.id), ['aaaaaaaa'])
  assert.deepEqual(await doc.keys(), [MON, THU], 'and no day was invented in between')
})

test('carrying into an empty list is a day with nothing in it, not an error', async t => {
  const { doc } = await list(t)
  assert.equal(await doc.carry(MON), 0)
  assert.deepEqual(await doc.itemsOn(MON), [])
})

test('adding an item carries the day first, so the working set is never partial', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] ring the bank <!--tephra:item aaaaaaaa 1000 1000-->'],
  })
  const id = await doc.add('call the surveyor #house DUE 9/14', TUE)
  const items = await doc.itemsOn(TUE)
  // Monday's live item came with it. Without the carry, Tuesday would hold one
  // item and claim to be the working set.
  assert.deepEqual(items.map(i => i.id), ['aaaaaaaa', id])
  assert.deepEqual(items[1]?.tags, ['house'])
  assert.equal(items[1]?.due, '2026-09-14')
})

test('a quick-add of several lines is one item, not two and a half', async t => {
  const { doc } = await list(t)
  await doc.add('read the survey\nand the covenants', MON)
  const items = await doc.itemsOn(MON)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.text, 'read the survey and the covenants')
})

test('the verbs are each one line, and each stamps mtime', async t => {
  const { doc, fileOn } = await list(t, {
    [MON]: [
      '- [ ] ring the bank <!--tephra:item aaaaaaaa 1000 1000-->',
      '- [ ] read the survey <!--tephra:item bbbbbbbb 1000 1000-->',
    ],
  })

  assert.equal(await doc.setStatus('aaaaaaaa', 'doing'), true)
  assert.equal(await doc.tagItem('aaaaaaaa', 'house'), true)
  assert.equal(await doc.tagItem('aaaaaaaa', 'house deal'), true)
  assert.equal(await doc.setDue('aaaaaaaa', '2026-09-30' as DateKey), true)

  const item = (await doc.itemsOn(MON))[0]
  assert.equal(item?.status, 'doing')
  assert.deepEqual(item?.tags, ['house', 'house deal'])
  assert.equal(item?.due, '2026-09-30')
  assert.equal(item?.ctime, 1000, 'ctime is written once and never changes')
  assert.ok((item?.mtime ?? 0) > 1000, 'mtime is stamped by the operation that wrote the line')

  // The other line was not touched, which is what "one line, one edit" means.
  const file = await fileOn(MON)
  assert.match(file, /- \[ \] read the survey <!--tephra:item bbbbbbbb 1000 1000-->/)
  assert.match(file, /#'house deal'/, "a tag with a space is written in the form that survives one")
})

test('untagging takes the tag and closes the gap it leaves', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] ring the bank #house today <!--tephra:item aaaaaaaa 1000 1000-->'],
  })
  assert.equal(await doc.untagItem('aaaaaaaa', 'house'), true)
  assert.equal((await doc.itemsOn(MON))[0]?.text, 'ring the bank today')
  assert.deepEqual((await doc.itemsOn(MON))[0]?.tags, [])
})

test('a due date can be taken away as well as given', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] file it DUE 2026-04-15 <!--tephra:item aaaaaaaa 1000 1000-->'],
  })
  assert.equal(await doc.setDue('aaaaaaaa', null), true)
  assert.equal((await doc.itemsOn(MON))[0]?.due, null)
  assert.equal((await doc.itemsOn(MON))[0]?.text, 'file it')
})

test('blocking keeps a reason; unblocking does not keep it lying around', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] get the deeds <!--tephra:item aaaaaaaa 1000 1000-->'],
  })
  await doc.setStatus('aaaaaaaa', 'blocked', 'waiting on the solicitor')
  assert.equal((await doc.itemsOn(MON))[0]?.note, 'waiting on the solicitor')

  await doc.setStatus('aaaaaaaa', 'doing')
  assert.equal((await doc.itemsOn(MON))[0]?.note, null)
  assert.equal((await doc.itemsOn(MON))[0]?.text, 'get the deeds')
})

test('a verb acts on the NEWEST instance, which is what the item is now', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] ring the bank <!--tephra:item aaaaaaaa 1000 1000-->'],
  })
  await doc.carry(TUE)
  await doc.setStatus('aaaaaaaa', 'done')

  assert.equal((await doc.itemsOn(TUE))[0]?.status, 'done')
  // Monday still says what Monday said. The instances sharing an id ARE the
  // item's history, and history is not edited in place (D56).
  assert.equal((await doc.itemsOn(MON))[0]?.status, 'todo')
})

test('and an item that is nowhere is not silently invented', async t => {
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank <!--tephra:item aaaaaaaa 1000 1000-->'] })
  assert.equal(await doc.setStatus('zzzzzzzz', 'done'), false)
  assert.equal(await doc.find('zzzzzzzz'), null)
  assert.equal((await doc.find('aaaaaaaa'))?.date, MON)
})

test('the file on disk is the file it appears to be', async t => {
  const { doc, fileOn } = await list(t)
  await doc.add('call the surveyor #house DUE 2026-09-14', MON)
  const file = await fileOn(MON)

  assert.match(file, /^---\n/, 'frontmatter, as every document in this corpus has')
  assert.match(file, /kind: todo/)
  const line = file.split('\n').find(l => l.startsWith('- ')) ?? ''
  // Legible, hand-editable, and a markdown task list to anything that reads one
  // (T15, R26). The identity is a comment, which no renderer shows.
  assert.match(line, /^- \[ \] call the surveyor #house DUE 2026-09-14 <!--tephra:item /)
  assert.deepEqual(parseItem(line)?.tags, ['house'])
})

test('every write is an ordinary edit, so undo puts it back', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] ring the bank <!--tephra:item aaaaaaaa 1000 1000-->'],
  })
  await doc.setStatus('aaaaaaaa', 'done')
  assert.equal((await doc.itemsOn(MON))[0]?.status, 'done')

  // Inherited whole from `SegmentedDocument`, which is the point of the kind
  // being text: undo, the journal, the WAL and versioning all arrive free.
  await doc.undo()
  assert.equal((await doc.itemsOn(MON))[0]?.status, 'todo')
})

// ── the walk (MT5a, T11) ───────────────────────────────────
//
// **The mode in which deleting is cheap.** Era 2's morning ritual was copying
// yesterday's list by hand and crossing swathes of it out — and deleting there
// never felt like abandonment the way it did mid-afternoon, because the frame
// around the act was different. So the walk's whole job is to supply that
// frame: it is offered by the list looking different, and what it adds is
// one-click deletion, a record that you looked, and nothing else.
//
// Driven through the document, with no surface, for the reason the rest of this
// file is: what the pass writes is where a mistake would be expensive.

test('a carried day knows where it came from, and which of its items are yesterday\'s', async t => {
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank', '- [ ] read the survey'] })
  await doc.carry(TUE)
  await doc.add('something new today', TUE)

  const walk = await doc.walkOf(TUE)
  assert.equal(walk.carriedFrom, MON)
  assert.equal(walk.walked, false, 'nobody has looked at it yet')
  assert.equal(walk.carried.length, 2, 'the two that came from Monday, and not the one added today')

  const today = await doc.itemsOn(TUE)
  const fresh = today.find(item => item.text.includes('something new'))
  assert.ok(fresh?.id !== undefined && !walk.carried.includes(fresh.id))
})

test('and a day nothing was carried into has nothing to review', async t => {
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank'] })
  const walk = await doc.walkOf(MON)
  assert.equal(walk.carriedFrom, null)
  assert.deepEqual(walk.carried, [])
})

test('an item carried in and deleted since is not offered for review', async t => {
  // Intersected rather than trusted. The walk must never offer to review a line
  // that is not in the day any more.
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank', '- [ ] read the survey'] })
  await doc.carry(TUE)
  const gone = (await doc.itemsOn(TUE))[0]?.id as string
  await doc.remove(gone)
  assert.deepEqual((await doc.walkOf(TUE)).carried.length, 1)
})

test('THE POINT: finishing a pass drops what was marked and records the review', async t => {
  const { doc, fileOn } = await list(t, {
    [MON]: ['- [ ] ring the bank', '- [ ] read the survey', '- [ ] chase the deeds'],
  })
  await doc.carry(TUE)
  const ids = (await doc.itemsOn(TUE)).flatMap(item => (item.id === null ? [] : [item.id]))

  const dropped = await doc.finishWalk(TUE, [ids[0] as string, ids[2] as string])
  assert.equal(dropped, 2)

  const left = await doc.itemsOn(TUE)
  assert.deepEqual(left.map(item => item.text), ['read the survey'])
  assert.equal((await doc.walkOf(TUE)).walked, true)

  // In the day's own frontmatter, because it is metadata about that day — and
  // it therefore travels with the corpus rather than with this machine.
  const file = await fileOn(TUE)
  assert.match(file, /^walked: true$/m)
  assert.match(file, new RegExp(`^carriedFrom: ${MON}$`, 'm'))
})

test('and MONDAY still says what Monday looked like', async t => {
  // This is why deleting during a walk is cheap in a way crossing out on paper
  // never was: what is cut is today's copy, and every earlier day keeps its own.
  const { doc, fileOn } = await list(t, { [MON]: ['- [ ] ring the bank', '- [ ] read the survey'] })
  await doc.carry(TUE)
  const ids = (await doc.itemsOn(TUE)).flatMap(item => (item.id === null ? [] : [item.id]))
  await doc.finishWalk(TUE, ids)

  assert.deepEqual((await doc.itemsOn(TUE)).length, 0, 'today is empty')
  assert.equal((await doc.itemsOn(MON)).length, 2, 'and Monday is untouched')
  assert.match(await fileOn(MON), /ring the bank/)
})

test('a walk that drops nothing still counts as a walk', async t => {
  // The common case, and the one an "apply" button would have made nonsense of:
  // you read the list, everything stands, and the day has still been reviewed.
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank'] })
  await doc.carry(TUE)
  assert.equal(await doc.finishWalk(TUE, []), 0)
  assert.equal((await doc.walkOf(TUE)).walked, true)
  assert.equal((await doc.itemsOn(TUE)).length, 1)
})

test('walking twice in a day is idempotent, and the second pass can still drop', async t => {
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank', '- [ ] read the survey'] })
  await doc.carry(TUE)
  await doc.finishWalk(TUE, [])
  const ids = (await doc.itemsOn(TUE)).flatMap(item => (item.id === null ? [] : [item.id]))
  assert.equal(await doc.finishWalk(TUE, [ids[0] as string]), 1)
  assert.equal((await doc.itemsOn(TUE)).length, 1)
})

test('the drops are ONE write, so they are one undo step', async t => {
  // A bulk delete that came back as eleven edits would let an undo leave the
  // list half-groomed, and would cost eleven gestures to change your mind about
  // one act. The carry is one write for the same reason.
  const { doc } = await list(t, {
    [MON]: ['- [ ] ring the bank', '- [ ] read the survey', '- [ ] chase the deeds'],
  })
  await doc.carry(TUE)
  const before = doc.generation
  const ids = (await doc.itemsOn(TUE)).flatMap(item => (item.id === null ? [] : [item.id]))
  await doc.finishWalk(TUE, ids)
  assert.equal(doc.generation, before + 1, 'three lines, one edit')
})

test('the walk does not follow the day: Thursday is reviewed, Tuesday is not', async t => {
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank'] })
  await doc.carry(TUE)
  await doc.carry(THU)
  await doc.finishWalk(THU, [])
  assert.equal((await doc.walkOf(THU)).walked, true)
  assert.equal((await doc.walkOf(TUE)).walked, false)
})

test('a hand-written line keeps the identity of the day it was WRITTEN on', async t => {
  // Found by the walk and older than it. Flow 9's line has no marker; carried
  // as-is it was adopted into today and claimed today's ctime, so an item that
  // first appeared on Monday said it was born on Tuesday — D56's "first day
  // this line appears", quietly wrong for every list ever hand-edited.
  const { doc, fileOn } = await list(t, { [MON]: ['- [ ] a line somebody typed'] })
  await doc.carry(TUE)

  const monday = (await doc.itemsOn(MON))[0]
  const tuesday = (await doc.itemsOn(TUE))[0]
  assert.ok(monday?.id !== null && monday?.id !== undefined, 'Monday has its identity now')
  assert.equal(tuesday?.id, monday.id, 'and Tuesday holds the SAME item, not a new one')
  assert.equal(tuesday?.ctime, monday.ctime, 'born when it was written, not when it was copied')
  assert.match(await fileOn(MON), /tephra:item/)
})
