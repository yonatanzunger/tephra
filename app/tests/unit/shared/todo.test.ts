// The item grammar (MT2, D55, D56, D85).
//
// One-way door: ids and the shape of a block are cheap on the first day and
// expensive to retrofit onto a year of carried-forward lines. So the grammar
// gets its tests before anything is built on it.
//
// **Two parsers, and only one of them has an inverse** (D85). `parseBlock` reads
// the file and `itemBlock` writes it, and the round trip between them is the law
// this file exists to hold. `parseEntry` reads a string somebody typed and has
// no inverse at all, so what it is tested for is what it *takes*, never what it
// gives back.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY, groupByTag, isLive, itemBlock, parseBlock, parseEntry, resolveDue, scanItems,
  spellOwner, unusedItemId,
  type TodoItem, type TodoStatus,
} from '../../../src/shared/kinds/todo.ts'
import type { DateKey } from '../../../src/shared/document-api.ts'

const MARK = '<!--tephra:item 7f3a1b2c 1756684800 1756771200-->'

test('a line carries everything an item is', () => {
  const item = parseBlock([`- [ ] Call the surveyor #house DUE 2026-09-14 ${MARK}`])
  assert.ok(item !== null)
  assert.equal(item.status, 'todo')
  assert.equal(item.id, '7f3a1b2c')
  assert.equal(item.ctime, 1756684800)
  assert.equal(item.mtime, 1756771200)
  assert.deepEqual(item.tags, ['house'])
  assert.equal(item.due, '2026-09-14')
  // **The text is the sentence** (D85). That line is the old inline form, and
  // reading it is how such a line becomes fields.
  assert.equal(item.text, 'Call the surveyor')
})

test('the glyphs are era 1\'s, and an unknown bracket is not an item', () => {
  const of = (glyph: string): TodoStatus | null => parseBlock([`- [${glyph}] x`])?.status ?? null
  assert.equal(of(' '), 'todo')
  assert.equal(of('/'), 'doing')
  assert.equal(of('?'), 'blocked')
  assert.equal(of('x'), 'done')
  assert.equal(of('-'), 'dropped')
  assert.equal(of('>'), 'backlog', 'era 1 drew migrated-forward as > and that is the backlog')
  assert.equal(of('@'), null)
  assert.equal(parseBlock(['- [ x] two characters is not a glyph']), null)
})

test('only live items go on to tomorrow', () => {
  assert.deepEqual(
    (['todo', 'doing', 'blocked', 'done', 'dropped', 'backlog'] as const).filter(isLive),
    ['todo', 'doing', 'blocked'],
  )
})

test('a line that is not an item is left alone rather than guessed at', () => {
  assert.equal(parseBlock(['## Thursday']), null)
  assert.equal(parseBlock(['']), null)
  assert.equal(parseBlock(['just a sentence']), null)
  assert.equal(parseBlock(['- an ordinary bullet']), null)
})

test('tags in both spellings, and things that only look like tags', () => {
  const tags = (text: string): readonly string[] => parseBlock([`- [ ] ${text}`])?.tags ?? []
  assert.deepEqual(tags('ring the bank #house'), ['house'])
  assert.deepEqual(tags("ring the bank #'house deal'"), ['house deal'])
  assert.deepEqual(tags('#house and #tax-return'), ['house', 'tax-return'])
  // A fragment is part of a URL and a preprocessor line is code; neither is a
  // tag, and both are things that end up in a task list.
  assert.deepEqual(tags('read https://example.com/a#results'), [])
  assert.deepEqual(tags('fix the ##double'), [])
})

test('A TAG COMES OUT OF THE SENTENCE, wherever it was written', () => {
  // **No spans any more** (D85). `tagSpans`, `dueSpan`, `ownerSpan` and
  // `movedSpan` existed so a verb could slice a marker out of the text; a marker
  // is a field now, so untagging is `tags.filter` and the sentence is never cut.
  // Four fields and a slice in every verb, gone.
  const item = parseBlock([`- [ ] ring the bank #house today ${MARK}`])
  assert.ok(item !== null)
  assert.deepEqual(item.tags, ['house'])
  assert.equal(item.text, 'ring the bank today')
})

test('and a scan says where the BLOCK sits in the body, which is what a verb replaces', () => {
  const body = `A note.\n- [ ] ring the bank\n  tags: #house\n  ${MARK}\n`
  const found = scanItems(body)[0]
  assert.ok(found !== undefined)
  assert.equal(found.item.text, 'ring the bank')
  assert.deepEqual(found.item.tags, ['house'])
  // **`blockTo`, not `to`**: the fields are part of the item, so the unit of
  // replacement is the first line and everything indented under it.
  assert.equal(body.slice(found.from, found.blockTo), `- [ ] ring the bank\n  tags: #house\n  ${MARK}`)
  // And `end` takes the newline with it, which is what removing one means.
  assert.equal(body.slice(found.from, found.end), `- [ ] ring the bank\n  tags: #house\n  ${MARK}\n`)
})

test('a due date is a field, however it arrived', () => {
  // Written inline by hand, or as its own field line. Both read; only the second
  // is ever written (D85).
  assert.equal(parseBlock(['- [ ] file the return DUE 2026-04-15'])?.due, '2026-04-15')
  const field = parseBlock(['- [ ] file the return', '  due: 2026-04-15'])
  assert.equal(field?.due, '2026-04-15')
  assert.equal(field?.text, 'file the return')
  assert.equal(parseBlock(['- [ ] due tomorrow sometime'])?.due, null, 'lowercase is prose')
})

test('A FIELD LINE IS ONE WHOSE KEY IS KNOWN AND WHOSE VALUE PARSES', () => {
  // **Otherwise it is prose, in place.** A note reading *due: whenever we get
  // round to it* is a note; absorbing it would lose it, and the leniency that
  // reads old files is exactly the leniency that could eat a sentence.
  const said = parseBlock(['- [ ] ring the bank', '  due: whenever we get round to it'])
  assert.equal(said?.due, null)
  assert.deepEqual(said?.notes, ['due: whenever we get round to it'])

  const unknown = parseBlock(['- [ ] ring the bank', '  priority: high'])
  assert.deepEqual(unknown?.notes, ['priority: high'], 'a key from the future survives as prose')
})

test('THE NOTE RULE: a dash clause is a reason only on a blocked item', () => {
  // Otherwise "call the surveyor — the one from Tuesday" acquires a reason it
  // does not have, and the text loses its second half.
  const blocked = parseBlock(['- [?] get the survey — waiting on the surveyor'])
  assert.equal(blocked?.reason, 'waiting on the surveyor')
  assert.equal(blocked?.text, 'get the survey')

  const plain = parseBlock(['- [ ] call the surveyor — the one from Tuesday'])
  assert.equal(plain?.reason, null)
  assert.equal(plain?.text, 'call the surveyor — the one from Tuesday')
})

test('THE ROUND TRIP: structure → string → structure is the identity', () => {
  // **The one law this grammar promises** (D85), and the reason every verb is a
  // block replacement rather than a rewrite of the file. The other direction is
  // NOT promised: an inline `#house` comes back as a field, which is the whole
  // of how an old file migrates.
  const items: readonly TodoItem[] = [
    { ...EMPTY, id: '7f3a1b2c', ctime: 1756684800, mtime: 1756771200,
      text: 'Call the surveyor', tags: ['house'], due: '2026-09-14' as DateKey },
    { ...EMPTY, status: 'done', id: 'aaaaaaaa', text: 'Ring the bank' },
    { ...EMPTY, status: 'blocked', text: 'Get the survey', tags: ['house'],
      reason: 'waiting on the surveyor' },
    { ...EMPTY, status: 'backlog', text: 'Look at the loft again', moved: 'house' },
    { ...EMPTY, status: 'doing', text: 'Read the survey properly', tags: ['the survey'] },
    { ...EMPTY, text: 'A line nobody has adopted yet' },
    { ...EMPTY, text: 'Approve the proposal', tags: ['lima'], for: 'Initiate Remodel',
      owner: 'AV', due: '2026-09-13' as DateKey, notes: ['a $50k total cost is a lot'] },
    { ...EMPTY, text: 'Ring Mary', owner: 'Mary Jane' },
    { ...EMPTY, text: '' },
  ]
  for (const item of items) {
    const written = itemBlock(item)
    assert.deepEqual(parseBlock(written.split('\n')), item, written)
    // And writing it again is the same bytes, which is what keeps an unchanged
    // item out of the history.
    assert.equal(itemBlock(parseBlock(written.split('\n')) as TodoItem), written)
  }
})

test('THE OLD FORM READS, which is the whole of the migration (D85)', () => {
  // Every shape a day file already holds. Reading one and writing it back is
  // what converts it, so the migration script is `read → write`.
  const was = `- [ ] Call the surveyor #house DUE 2026-09-14 ${MARK}`
  const item = parseBlock([was])
  assert.ok(item !== null)
  assert.equal(item.text, 'Call the surveyor')
  assert.deepEqual(item.tags, ['house'])
  assert.equal(item.due, '2026-09-14')
  assert.equal(itemBlock(item), [
    '- [ ] Call the surveyor',
    '  tags: #house',
    '  due: 2026-09-14',
    `  ${MARK}`,
  ].join('\n'))
})

test('THE ENTRY GRAMMAR takes a typed string and gives back a record', () => {
  // **No inverse** (D85): this is how a task typed anywhere — a quick add box, a
  // share sheet, somewhere with no access to the list at all — becomes an item.
  const said = parseEntry("call the surveyor #house OWNER Sam DUE 2026-09-14 about #'the drains'")
  assert.equal(said.text, 'call the surveyor about')
  assert.deepEqual(said.tags, ['house', 'the drains'])
  assert.equal(said.owner, 'Sam')
  assert.equal(said.due, '2026-09-14')
  // An unresolved relative date is not a date, so it stays in the sentence for
  // the next write to resolve (`resolveDue` is a write).
  assert.equal(parseEntry('file it DUE FRIDAY').due, null)
  assert.equal(parseEntry('file it DUE FRIDAY').text, 'file it DUE FRIDAY')
})

test('a marker with no timestamps still names its item', () => {
  // Hand-written, or from a future that drops a field. Lenient parse, precise
  // serialise: what comes back out is what came in.
  const item = parseBlock(['- [ ] ring the bank <!--tephra:item abcd1234-->'])
  assert.equal(item?.id, 'abcd1234')
  assert.equal(item?.ctime, null)
  assert.ok(item !== null)
  assert.equal(itemBlock(item), '- [ ] ring the bank\n  <!--tephra:item abcd1234-->')
})

test('scanning a body finds the items and leaves everything else alone', () => {
  const body = [
    'A note to myself.',
    '',
    `- [ ] one ${MARK}`,
    '## a heading',
    '- [x] two',
    '',
  ].join('\n')
  const found = scanItems(body)
  assert.equal(found.length, 2)
  assert.equal(found[0]?.item.text, 'one')
  assert.equal(body.slice(found[0]?.from ?? 0, found[0]?.to ?? 0), `- [ ] one ${MARK}`)
  // `end` includes the newline, because removing a line means removing its break.
  assert.equal(body.slice(found[1]?.from ?? 0, found[1]?.end ?? 0), '- [x] two\n')
})

test('a relative due date resolves the moment it is recognised', () => {
  // 2026-09-01 is a Tuesday.
  const on = (text: string): string => resolveDue(text, '2026-09-01' as DateKey)
  assert.equal(on('file it DUE TODAY'), 'file it DUE 2026-09-01')
  assert.equal(on('file it DUE TOMORROW'), 'file it DUE 2026-09-02')
  assert.equal(on('file it DUE FRIDAY'), 'file it DUE 2026-09-04')
  assert.equal(on('file it DUE fri'), 'file it DUE 2026-09-04', 'and it is not case-fussy')
  // **The next one, not this morning.** A task you are writing down is not one
  // you have already missed.
  assert.equal(on('file it DUE TUESDAY'), 'file it DUE 2026-09-08')
  assert.equal(on('file it DUE 9/14'), 'file it DUE 2026-09-14')
  assert.equal(on('file it DUE 1/3'), 'file it DUE 2027-01-03', 'a date gone by means next year')
  assert.equal(on('file it DUE 4/15/27'), 'file it DUE 2027-04-15')
  // Already absolute, and things that are not dates at all, are left alone.
  assert.equal(on('file it DUE 2026-12-25'), 'file it DUE 2026-12-25')
  assert.equal(on('it is due soon'), 'it is due soon')
  assert.equal(on('DUE 13/40'), 'DUE 13/40', 'not a date, so not rewritten')
})

test('an unresolved due date reads as none until it is written back', () => {
  // The file is the truth: a hand-written `DUE FRIDAY` names no date yet, and
  // says so, rather than being guessed at on every read.
  assert.equal(parseBlock(['- [ ] file it DUE FRIDAY'])?.due, null)
  const resolved = resolveDue('- [ ] file it DUE FRIDAY', '2026-09-01' as DateKey)
  assert.equal(parseBlock([resolved])?.due, '2026-09-04')
})

test('ids are eight characters and avoid what is taken', () => {
  assert.equal(unusedItemId(new Set()).length, 8)
  // A rigged source of randomness: the first candidate collides, the second
  // does not, and the mint must not hand back the collision.
  const values = [0, 0, 0.5, 0.5]
  let n = 0
  const made = unusedItemId(new Set(['00000000']), () => values[n++ % values.length] as number)
  assert.notEqual(made, '00000000')
  assert.equal(made.length, 8)
})

test('an item with no text is still a line', () => {
  assert.equal(itemBlock(EMPTY), '- [ ]')
  assert.equal(parseBlock(['- [ ]'])?.text, '')
})

test('a due date is a DateKey the rest of the app already understands', () => {
  const due: DateKey | null = parseBlock(['- [ ] x DUE 2026-09-14'])?.due ?? null
  assert.equal(due, '2026-09-14')
})

// ── the tag pivot (T8's cheap half) ────────────────────
//
// A grouping and not a query: every live item is in the day already open, so
// the view is a function of what is on screen. Tested here, with no DOM, for
// the reason the rest of the grammar is — the interesting cases are all about
// items and none of them are about drawing.

/** A line, through the real parser, so a test cannot invent an item shape. */
const item = (line: string): TodoItem => parseBlock([line]) as TodoItem

test('groups run alphabetically, and items keep the order they came in', () => {
  const groups = groupByTag([
    item('- [ ] fix the gate #house'),
    item('- [ ] call the surveyor #admin'),
    item('- [ ] paint the shed #house'),
  ])
  assert.deepEqual(groups.map(g => g.tag), ['admin', 'house'])
  assert.deepEqual(groups[1]?.items.map(i => i.text), ['fix the gate', 'paint the shed'])
})

test('THE CHOICE: an item appears under every tag it carries', () => {
  // "What is outstanding on the house" has to include an item that is also
  // urgent. Filing it under whichever tag was typed first would answer a
  // question nobody asked.
  const groups = groupByTag([item('- [ ] fix the gate #house #urgent')])
  assert.deepEqual(groups.map(g => g.tag), ['house', 'urgent'])
  assert.equal(groups[0]?.items.length, 1)
  assert.equal(groups[1]?.items[0], groups[0]?.items[0], 'and it is the same item, not a copy')
})

test('but a tag written twice on one line is one appearance', () => {
  const groups = groupByTag([item('- [ ] #house fix the gate #house')])
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.items.length, 1)
})

test('untagged items are a group of their own, and it is LAST', () => {
  // Never omitted. A view that silently dropped them would lose tasks, which
  // is the one thing this list cannot do.
  const groups = groupByTag([item('- [ ] think about it'), item('- [ ] fix the gate #house')])
  assert.deepEqual(groups.map(g => g.tag), ['house', null])
  assert.deepEqual(groups[1]?.items.map(i => i.text), ['think about it'])
})

test('and there is no empty group when everything is tagged', () => {
  const groups = groupByTag([item('- [ ] fix the gate #house')])
  assert.deepEqual(groups.map(g => g.tag), ['house'])
})

test('an empty list pivots to nothing at all', () => {
  assert.deepEqual(groupByTag([]), [])
})

test('every item reaches the view, whatever its status', () => {
  // The pivot is a REGROUPING, not a filter: an item finished today stays
  // visible and greyed until tomorrow's carry (T7), in this view as in the
  // other one. A pivot that quietly dropped it would be a second rule about
  // what the list contains.
  const items = [
    item('- [x] fix the gate #house'),
    item('- [-] paint the shed #house'),
    item('- [>] reroof #house'),
  ]
  assert.equal(groupByTag(items)[0]?.items.length, items.length)
})

// ── who has it (OWNER) ──────────────────────────────────────

test('OWNER is a field, read from either form', () => {
  const inline = parseBlock(['- [ ] ring the plumber OWNER Sam']) as TodoItem
  assert.equal(inline.owner, 'Sam')
  assert.equal(inline.text, 'ring the plumber')
  const field = parseBlock(['- [ ] ring the plumber', '  owner: Sam']) as TodoItem
  assert.equal(field.owner, 'Sam')
  assert.equal(field.text, 'ring the plumber')
})

test('and a name that needs quoting gets it, sharing the tag grammar', () => {
  assert.equal(spellOwner('Mary Jane'), "OWNER 'Mary Jane'")
  assert.equal((parseBlock(["- [ ] ring the plumber OWNER 'Mary Jane'"]) as TodoItem).owner, 'Mary Jane')
  // The escape the tag grammar grew, working here for free.
  assert.equal((parseBlock(["- [ ] x OWNER 'Bill O\\'Brien'"]) as TodoItem).owner, "Bill O'Brien")
})

test('and it is not in the sentence, being a fact ABOUT the task', () => {
  // Which is the whole argument for a field over `(owner: Sam)` in the title:
  // text in the sentence cannot be taken off for a summary (D81, D85).
  const item = parseBlock(["- [ ] ring the plumber #house OWNER Sam DUE 2026-09-20"]) as TodoItem
  assert.equal(item.text, 'ring the plumber')
  assert.equal(item.owner, 'Sam')
  assert.deepEqual(item.tags, ['house'])
  assert.equal(item.due, '2026-09-20')
})

test('and a line with no owner says so, rather than guessing one', () => {
  assert.equal((parseBlock(['- [ ] ring the plumber']) as TodoItem).owner, null)
})
