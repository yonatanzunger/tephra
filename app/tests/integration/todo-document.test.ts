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
import { parseBlock } from '../../src/shared/kinds/todo.ts'
import { ONLY_SEGMENT } from '../../src/shared/document-api.ts'
import type { DateKey, DocumentId, SegmentKey } from '../../src/shared/document-api.ts'

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

  // **And it is written as a FIELD** (D85): resolving a relative date makes a
  // date, and reading the sentence again is what lifts it out of the prose.
  assert.match(await fileOn(MON), /- \[ \] file the return\n {2}due: 2026-09-11\n {2}<!--tephra:item [0-9a-z]{8} \d+ \d+-->/)
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
  assert.equal(carried[2]?.reason, 'waiting on the solicitor', 'and a blocked item keeps its reason')
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
  assert.equal((await doc.itemsOn(MON))[0]?.reason, 'waiting on the solicitor')

  await doc.setStatus('aaaaaaaa', 'doing')
  assert.equal((await doc.itemsOn(MON))[0]?.reason, null)
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
  // Legible, hand-editable, and a markdown task list to anything that reads one
  // (T15, R26). **The fields are lines of their own** (D85) and the identity is
  // a comment, which no renderer shows.
  const lines = file.split('\n')
  const at = lines.findIndex(l => l.startsWith('- '))
  const block = lines.slice(at, at + 4)
  assert.equal(block[0], '- [ ] call the surveyor')
  assert.equal(block[1], '  tags: #house')
  assert.equal(block[2], '  due: 2026-09-14')
  assert.match(block[3] as string, /^ {2}<!--tephra:item /)
  assert.deepEqual(parseBlock(block)?.tags, ['house'])
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
  assert.ok(fresh?.id != null && !walk.carried.includes(fresh.id))
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

// ── minting against the whole corpus (MT5b, D56) ───────
//
// **Eight base-36 characters were always meant to be checked, not just wide.**
// `solution/todo.md`: ids "must be unique across the corpus for
// `tephra:todo/<id>` to resolve without a list name", and minting against one
// day's items is unique enough within a list while saying nothing about a
// second one. MT2 shipped the width and left the check for here.

test('an id is not reused when another list already has it', async t => {
  const { doc } = await list(t, { [MON]: [] })
  // Everything the corpus has, which this document cannot see for itself.
  const elsewhere = async (): Promise<ReadonlySet<string>> => new Set(['aaaa1111', 'bbbb2222'])
  const minted: string[] = []
  for (let i = 0; i < 25; i++) minted.push(await doc.add(`item ${i}`, MON, elsewhere))

  assert.equal(new Set(minted).size, minted.length, 'and not reused within this list either')
  assert.ok(!minted.includes('aaaa1111'))
  assert.ok(!minted.includes('bbbb2222'))
})

test('adopting a hand-written line respects ids taken elsewhere too', async t => {
  // Flow 9's line gets its identity on the next write, and that identity has to
  // be as unique as a minted one — it addresses the same namespace.
  const { doc } = await list(t, { [MON]: ['- [ ] typed in by hand'] })
  const taken = new Set<string>()
  // Every id the rest of the corpus holds, contrived so a careless mint would
  // collide: the document's own day is empty, so only `elsewhere` can stop it.
  for (let i = 0; i < 200; i++) taken.add(`z${i.toString(36).padStart(7, '0')}`)
  await doc.adopt(MON, async () => taken)

  const id = (await doc.itemsOn(MON))[0]?.id
  assert.ok(id !== null && id !== undefined)
  assert.ok(!taken.has(id), 'the new id belongs to nobody else')
})

test('and a document with nobody to ask is still right about itself', async t => {
  // Which is what keeps the kind drivable in a test with no corpus behind it,
  // and what `add` does on every call that does not care.
  const { doc } = await list(t, { [MON]: [] })
  const a = await doc.add('one', MON)
  const b = await doc.add('two', MON)
  assert.notEqual(a, b)
})

test('the corpus is asked ONLY when an id is actually minted', async t => {
  // `adopt` runs on every carry and mints on almost none of them, and answering
  // costs a sweep of the corpus. That is why it is a thunk and not a set.
  const { doc } = await list(t, { [MON]: ['- [ ] already mine <!--tephra:item aaaa1111 100 100-->'] })
  let asked = 0
  const elsewhere = async (): Promise<ReadonlySet<string>> => {
    asked += 1
    return new Set<string>()
  }
  await doc.carry(TUE, elsewhere)
  assert.equal(asked, 0, 'nothing was minted, so nothing was asked')

  await doc.add('something new', TUE, elsewhere)
  assert.equal(asked, 1)
})

// ── notes under an item (2026-09-08) ───────────────────
//
// **Indented continuation lines, which is markdown's own way** of attaching a
// paragraph to a list item — so the file is what it appears to be (R26, D20),
// any renderer shows them as part of the item, and hand-editing is adding a
// line and indenting it. Nothing in them is parsed: a note is prose about the
// task and not more task.

test('notes are the indented lines under an item', async t => {
  const { doc } = await list(t, {
    [MON]: [
      '- [ ] call the surveyor #house <!--tephra:item aaaa1111 100 100-->',
      '  Left a message Tuesday.',
      '  The boundary map is with the council.',
      '- [ ] renew the permit <!--tephra:item aaaa2222 100 100-->',
    ],
  })
  const items = await doc.itemsOn(MON)
  assert.equal(items.length, 2, 'an indented line is not an item')
  assert.deepEqual(items[0]?.notes, ['Left a message Tuesday.', 'The boundary map is with the council.'])
  assert.deepEqual(items[1]?.notes, [])
})

test('NOTHING in a note is parsed — not a tag, not a date, not a status', async t => {
  const { doc } = await list(t, {
    [MON]: [
      '- [ ] call the surveyor <!--tephra:item aaaa1111 100 100-->',
      '  Chase #house about DUE 2026-09-30 and the [x] form.',
    ],
  })
  const item = (await doc.itemsOn(MON))[0]
  assert.deepEqual(item?.tags, [], 'a hash in a note is a hash')
  assert.equal(item?.due, null)
  assert.equal(item?.status, 'todo')
  assert.equal((await doc.itemsOn(MON)).length, 1)
})

test('a blank line ends them, so a paragraph is not adopted by the item above', async t => {
  const { doc } = await list(t, {
    [MON]: [
      '- [ ] call the surveyor <!--tephra:item aaaa1111 100 100-->',
      '  Left a message.',
      '',
      '  Something else entirely.',
    ],
  })
  assert.deepEqual((await doc.itemsOn(MON))[0]?.notes, ['Left a message.'])
})

test('THE POINT: notes travel with the item on the carry', async t => {
  const { doc, fileOn } = await list(t, {
    [MON]: [
      '- [ ] call the surveyor <!--tephra:item aaaa1111 100 100-->',
      '  Left a message Tuesday.',
    ],
  })
  await doc.carry(TUE)
  assert.deepEqual((await doc.itemsOn(TUE))[0]?.notes, ['Left a message Tuesday.'])
  assert.match(await fileOn(TUE), /^ {2}Left a message Tuesday\.$/m, 'indented, as markdown wants')
})

test('and each past day keeps the notes as they stood THAT day', async t => {
  // Which is what makes scrubbing back show what you knew then (T7's flow 7).
  const { doc } = await list(t, {
    [MON]: ['- [ ] call the surveyor <!--tephra:item aaaa1111 100 100-->', '  Left a message.'],
  })
  await doc.carry(TUE)
  await doc.setNotes('aaaa1111', ['Left a message.', 'Called back — Thursday.'])

  assert.deepEqual((await doc.itemsOn(TUE))[0]?.notes, ['Left a message.', 'Called back — Thursday.'])
  assert.deepEqual((await doc.itemsOn(MON))[0]?.notes, ['Left a message.'], 'Monday is untouched')
})

test('rewriting notes replaces them rather than doubling them', async t => {
  const { doc, fileOn } = await list(t, {
    [MON]: ['- [ ] call the surveyor <!--tephra:item aaaa1111 100 100-->', '  The first one.'],
  })
  await doc.setNotes('aaaa1111', ['A second one.'])
  assert.deepEqual((await doc.itemsOn(MON))[0]?.notes, ['A second one.'])
  assert.ok(!(await fileOn(MON)).includes('The first one.'))
})

test('and emptying them removes them', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] call the surveyor <!--tephra:item aaaa1111 100 100-->', '  Something.'],
  })
  await doc.setNotes('aaaa1111', [])
  assert.deepEqual((await doc.itemsOn(MON))[0]?.notes, [])
})

test('EVERY OTHER VERB leaves them exactly where they are', async t => {
  // Every verb rewrites the LINE and nothing else, which is the whole reason
  // notes survive a status change, a re-tag or a re-dating.
  const { doc } = await list(t, {
    [MON]: ['- [ ] call the surveyor <!--tephra:item aaaa1111 100 100-->', '  Left a message.'],
  })
  await doc.setStatus('aaaa1111', 'doing')
  await doc.edit('aaaa1111', 'call the surveyor again #house')
  const item = (await doc.itemsOn(MON))[0]
  assert.equal(item?.status, 'doing')
  assert.deepEqual(item?.tags, ['house'])
  assert.deepEqual(item?.notes, ['Left a message.'])
})

test('and deleting the item takes its notes with it', async t => {
  const { doc, fileOn } = await list(t, {
    [MON]: [
      '- [ ] call the surveyor <!--tephra:item aaaa1111 100 100-->',
      '  Left a message.',
      '- [ ] renew the permit <!--tephra:item aaaa2222 100 100-->',
    ],
  })
  await doc.remove('aaaa1111')
  const file = await fileOn(MON)
  assert.ok(!file.includes('Left a message.'), 'no orphan')
  assert.match(file, /renew the permit/, 'and the next item is intact')
})

// ── two shapes of one kind (MT7, D55 as amended) ───────
//
// **A `.todo` DIRECTORY is a daily list and a single `.todo.md` is an overall
// one** — the blog posts you mean to write, which does not turn over daily. So
// the carry has nothing to carry, and *today's working set* is a meaningful
// idea for the first and a meaningless one for the second.
//
// Everything else is shared: the item grammar, every verb, the surface. What
// differs is `keys()`, which is what `SegmentedDocument` was built to allow.

const OVERALL = 'notes/blog.todo.md' as DocumentId

async function overall(t: TestContext, lines: readonly string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-todo-'))
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'blog.todo.md'),
    `---\ntephra: 1\nkind: todo\ntitle: Blog posts\n---\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`,
  )
  const notebook = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => notebook.close())
  const corpus = new Corpus(notebook)
  const doc = (await corpus.use(OVERALL, async d => d)) as unknown as TodoDocument
  return {
    root,
    doc,
    async file(): Promise<string> {
      await corpus.flushAll()
      return readFile(join(root, 'notes', 'blog.todo.md'), 'utf8')
    },
  }
}

test('a .todo.md opens as a todo document, with ONE segment', async t => {
  const { doc } = await overall(t, ['- [ ] the one about tephra <!--tephra:item aaaa1111 100 100-->'])
  assert.equal(doc.meta.kind, 'todo')
  assert.deepEqual(await doc.keys(), [ONLY_SEGMENT])
})

test('THE POINT: it does not turn over, so nothing is carried', async t => {
  // A daily list materialises today from the last day that has one (D55). An
  // overall list has no days to carry between — its items are simply there
  // until they are not, which is the whole difference between the two shapes.
  const { doc, file } = await overall(t, ['- [ ] the one about tephra <!--tephra:item aaaa1111 100 100-->'])
  assert.equal(await doc.carry(MON), -1, 'nothing to do, and it says so')
  assert.deepEqual(await doc.keys(), [ONLY_SEGMENT], 'and no day was made')
  assert.ok(!(await file()).includes('date:'), 'nor a date claimed in its frontmatter')
})

test('and no walk is offered, because there is nothing that arrived', async t => {
  // The walk reviews what the carry brought (T11), so a list with no carry has
  // no walk — and the surface asks this rather than asking the shape.
  const { doc } = await overall(t, ['- [ ] the one about tephra <!--tephra:item aaaa1111 100 100-->'])
  const walk = await doc.walkOf(MON)
  assert.deepEqual(walk, { walked: false, carried: [], carriedFrom: null })
})

test('EVERY VERB works on it, because the grammar is the same one', async t => {
  // **Called with a DAY, which is how the service calls it.** `NotebookService`
  // asks every list to work in the writing day and does not know the shape —
  // which is right, and is exactly what the first cut of this test failed to
  // exercise: passing `ONLY_SEGMENT` here tested a call the app never makes,
  // and the app's call wrote to the right file under the wrong segment name.
  const { doc, file } = await overall(t, [])
  const id = await doc.add('the one about tephra #writing', MON)
  await doc.setStatus(id, 'doing')
  await doc.setNotes(id, ['Drafted the opening.'])

  // Read back by the one segment it actually has, which is the other half of
  // the same mistake: written under a day, read under `content`, and empty.
  const items = await doc.itemsOn(ONLY_SEGMENT as unknown as DateKey)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.status, 'doing')
  assert.deepEqual(items[0]?.tags, ['writing'])
  assert.deepEqual(items[0]?.notes, ['Drafted the opening.'])
  assert.match(await file(), /^ {2}Drafted the opening\.$/m)
})

test('a hand-written line gets its identity here too (flow 9)', async t => {
  const { doc } = await overall(t, ['- [ ] typed in by hand'])
  await doc.carry(MON)
  assert.ok((await doc.itemsOn(ONLY_SEGMENT as unknown as DateKey))[0]?.id !== null)
})

test('and its ids are minted against the whole corpus, as everything else is', async t => {
  const { doc } = await overall(t, [])
  const taken = new Set<string>()
  for (let i = 0; i < 200; i++) taken.add(`z${i.toString(36).padStart(7, '0')}`)
  const id = await doc.add('one', MON, async () => taken)
  assert.ok(!taken.has(id))
})

test('THE TRAP: a day and the one segment name the SAME segment here', async t => {
  // Written by a caller that thinks in days, read by one that thinks in
  // segments — and an overall list's `load` ignores the key, so both reach the
  // right file. Without normalising, the two were different segments over one
  // file: the item was on disk and not on screen.
  const { doc } = await overall(t, [])
  await doc.add('the one about tephra', TUE)
  assert.equal((await doc.itemsOn(ONLY_SEGMENT as unknown as DateKey)).length, 1)
  assert.equal((await doc.itemsOn(MON)).length, 1, 'and any day answers the same')
  assert.equal((await doc.itemsOn(THU)).length, 1)
})

// ── the day's selection (H9, MH4) ───────────────────────────
//
// **A mark on the day, and the claims are all about what it is NOT.** A status
// carries forward; a tag travels with the item. The thing you decided you were
// doing on Tuesday must do neither, or it silently becomes a permanent label —
// which is what an earlier era did, and why the alternative there was a second
// list that had to be kept in sync by hand.

test('THE POINT: choosing marks the DAY, and the item does not move', async t => {
  const { doc, fileOn } = await list(t, { [MON]: ['- [ ] ring the bank', '- [ ] post the form'] })
  await doc.adopt(MON as unknown as SegmentKey)
  const [bank, form] = (await doc.itemsOn(MON)).map(one => one.id as string)
  await doc.choose(MON, form as string, true)
  await doc.choose(MON, bank as string, true)

  assert.deepEqual(await doc.chosenOn(MON), [form, bank], 'in the order chosen, not the list order')
  const text = await fileOn(MON)
  assert.match(text, new RegExp(`^today: ${form} ${bank}$`, 'm'))
  // **And the lines are untouched**: a selection, never a relocation (H9).
  assert.deepEqual((await doc.itemsOn(MON)).map(one => one.id), [bank, form])
  assert.match(text, /^- \[ \] ring the bank/m)
})

test('AND IT DOES NOT CARRY, which is the whole reason it is not a status', async t => {
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank'] })
  await doc.adopt(MON as unknown as SegmentKey)
  const bank = (await doc.itemsOn(MON))[0]?.id as string
  await doc.choose(MON, bank, true)
  await doc.carry(TUE)
  assert.deepEqual(await doc.chosenOn(TUE), [], 'Tuesday has its own answer, and it is none')
  assert.deepEqual(await doc.chosenOn(MON), [bank], 'and Monday still remembers Monday')
})

test('unchoosing takes it back off, and choosing twice is once', async t => {
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank'] })
  await doc.adopt(MON as unknown as SegmentKey)
  const bank = (await doc.itemsOn(MON))[0]?.id as string
  await doc.choose(MON, bank, true)
  await doc.choose(MON, bank, true)
  assert.deepEqual(await doc.chosenOn(MON), [bank])
  await doc.choose(MON, bank, false)
  assert.deepEqual(await doc.chosenOn(MON), [])
})

test('and a chosen item that is deleted stops being chosen, rather than dangling', async t => {
  // The same intersection `walkOf` does with the carry: a selection cannot point
  // at a line that is not there.
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank', '- [ ] post the form'] })
  await doc.adopt(MON as unknown as SegmentKey)
  const [bank, form] = (await doc.itemsOn(MON)).map(one => one.id as string)
  await doc.choose(MON, bank as string, true)
  await doc.choose(MON, form as string, true)
  await doc.remove(bank as string)
  assert.deepEqual(await doc.chosenOn(MON), [form])
})

// ── bulk acts (MH4) ─────────────────────────────────────────
//
// **One write, and therefore one undo step**, which is the rule `finishWalk`
// already followed. That argument was made about deleting and is not about
// deleting: it is about *bulk*. Eleven edits would let an undo leave the list
// half-changed and cost eleven gestures to change your mind about one act.

test('THE POINT: one act changes many items, and is ONE edit', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] ring the bank', '- [ ] post the form', '- [ ] read the survey'],
  })
  await doc.adopt(MON as unknown as SegmentKey)
  const ids = (await doc.itemsOn(MON)).map(one => one.id as string)

  assert.equal(await doc.bulk([ids[0] as string, ids[2] as string], 'backlog'), 2)
  const after = await doc.itemsOn(MON)
  assert.deepEqual(after.map(one => one.status), ['backlog', 'todo', 'backlog'])

  // One undo brings the whole act back, not a third of it.
  await doc.undo()
  assert.deepEqual((await doc.itemsOn(MON)).map(one => one.status), ['todo', 'todo', 'todo'])
})

test('and removing many is the same act, which is why it is one verb', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] ring the bank', '- [ ] post the form', '- [ ] read the survey'],
  })
  await doc.adopt(MON as unknown as SegmentKey)
  const ids = (await doc.itemsOn(MON)).map(one => one.id as string)
  assert.equal(await doc.bulk([ids[0] as string, ids[1] as string], 'remove'), 2)
  assert.deepEqual((await doc.itemsOn(MON)).map(one => one.text), ['read the survey'])
})

test('it says how many it CHANGED, not how many it was asked about', async t => {
  // Asked of five and changed three is a true thing worth saying, and the
  // surface reports it back rather than the count it sent.
  const { doc } = await list(t, { [MON]: ['- [ ] ring the bank'] })
  await doc.adopt(MON as unknown as SegmentKey)
  const bank = (await doc.itemsOn(MON))[0]?.id as string
  assert.equal(await doc.bulk([bank, 'notanitem', 'alsonot'], 'done'), 1)
})

test('and it reaches across days, because the list is carried and one item is not one day', async t => {
  const { doc } = await list(t, {
    [MON]: ['- [ ] ring the bank'],
    [TUE]: ['- [ ] post the form'],
  })
  await doc.adopt(MON as unknown as SegmentKey)
  await doc.adopt(TUE as unknown as SegmentKey)
  const mon = (await doc.itemsOn(MON))[0]?.id as string
  const tue = (await doc.itemsOn(TUE))[0]?.id as string
  assert.equal(await doc.bulk([mon, tue], 'dropped'), 2)
  assert.equal((await doc.itemsOn(MON))[0]?.status, 'dropped')
  assert.equal((await doc.itemsOn(TUE))[0]?.status, 'dropped')
})

test('an empty selection does nothing at all, and writes nothing', async t => {
  const { doc, fileOn } = await list(t, { [MON]: ['- [ ] ring the bank'] })
  await doc.adopt(MON as unknown as SegmentKey)
  const was = await fileOn(MON)
  assert.equal(await doc.bulk([], 'done'), 0)
  assert.equal(await fileOn(MON), was)
})
