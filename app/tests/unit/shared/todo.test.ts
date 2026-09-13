// The item grammar (MT2, D55, D56).
//
// One-way door: ids and the shape of a line are cheap on the first day and
// expensive to retrofit onto a year of carried-forward lines. So the grammar
// gets its tests before anything is built on it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupByTag, isLive, itemLine, parseItem, resolveDue, scanItems, spellOwner, unusedItemId,
  withoutMarks,
  type TodoItem, type TodoStatus,
} from '../../../src/shared/kinds/todo.ts'
import type { DateKey } from '../../../src/shared/document-api.ts'

const MARK = '<!--tephra:item 7f3a1b2c 1756684800 1756771200-->'

test('a line carries everything an item is', () => {
  const item = parseItem(`- [ ] Call the surveyor #house DUE 2026-09-14 ${MARK}`)
  assert.ok(item !== null)
  assert.equal(item.status, 'todo')
  assert.equal(item.id, '7f3a1b2c')
  assert.equal(item.ctime, 1756684800)
  assert.equal(item.mtime, 1756771200)
  assert.deepEqual(item.tags, ['house'])
  assert.equal(item.due, '2026-09-14')
  // **The markers stay in the text** (T16): they are what the line says, and
  // the renderer draws chips over them rather than over a gap where they were.
  assert.equal(item.text, 'Call the surveyor #house DUE 2026-09-14')
})

test('the glyphs are era 1\'s, and an unknown bracket is not an item', () => {
  const of = (glyph: string): TodoStatus | null => parseItem(`- [${glyph}] x`)?.status ?? null
  assert.equal(of(' '), 'todo')
  assert.equal(of('/'), 'doing')
  assert.equal(of('?'), 'blocked')
  assert.equal(of('x'), 'done')
  assert.equal(of('-'), 'dropped')
  assert.equal(of('>'), 'backlog', 'era 1 drew migrated-forward as > and that is the backlog')
  assert.equal(of('@'), null)
  assert.equal(parseItem('- [ x] two characters is not a glyph'), null)
})

test('only live items go on to tomorrow', () => {
  assert.deepEqual(
    (['todo', 'doing', 'blocked', 'done', 'dropped', 'backlog'] as const).filter(isLive),
    ['todo', 'doing', 'blocked'],
  )
})

test('a line that is not an item is left alone rather than guessed at', () => {
  assert.equal(parseItem('## Thursday'), null)
  assert.equal(parseItem(''), null)
  assert.equal(parseItem('just a sentence'), null)
  assert.equal(parseItem('- an ordinary bullet'), null)
})

test('tags in both spellings, and things that only look like tags', () => {
  const tags = (text: string): readonly string[] => parseItem(`- [ ] ${text}`)?.tags ?? []
  assert.deepEqual(tags('ring the bank #house'), ['house'])
  assert.deepEqual(tags("ring the bank #'house deal'"), ['house deal'])
  assert.deepEqual(tags('#house and #tax-return'), ['house', 'tax-return'])
  // A fragment is part of a URL and a preprocessor line is code; neither is a
  // tag, and both are things that end up in a task list.
  assert.deepEqual(tags('read https://example.com/a#results'), [])
  assert.deepEqual(tags('fix the ##double'), [])
})

test('a tag span covers exactly the tag, so untagging takes the tag and no prose', () => {
  // **Relative to the TEXT**, which is what makes untagging a slice rather than
  // an arithmetic problem — the verb has the text and wants a piece out of it.
  const item = parseItem(`- [ ] ring the bank #house today ${MARK}`)
  assert.ok(item !== null)
  const span = item.tagSpans[0]
  assert.ok(span !== undefined)
  assert.equal(item.text.slice(span.from, span.to), '#house')
})

test('and a scan says where the text sits in the body, which is the other half', () => {
  const body = `A note.\n- [ ] ring the bank #house ${MARK}\n`
  const found = scanItems(body)[0]
  assert.ok(found !== undefined)
  const span = found.item.tagSpans[0]
  assert.ok(span !== undefined)
  // Text offset plus `textFrom` is a body offset — the one place that
  // conversion is written down, for a row that draws chips over the prose.
  assert.equal(body.slice(found.textFrom + span.from, found.textFrom + span.to), '#house')
  assert.equal(body.slice(found.textFrom, found.textFrom + found.item.text.length), 'ring the bank #house')
})

test('a due date is found where it is written', () => {
  const line = '- [ ] file the return DUE 2026-04-15'
  const item = parseItem(line)
  assert.ok(item !== null)
  assert.equal(item.due, '2026-04-15')
  assert.ok(item.dueSpan !== null)
  assert.equal(item.text.slice(item.dueSpan.from, item.dueSpan.to), 'DUE 2026-04-15')
  assert.equal(parseItem('- [ ] due tomorrow sometime')?.due, null, 'lowercase is prose')
})

test('THE NOTE RULE: a dash clause is a reason only on a blocked item', () => {
  // Otherwise "call the surveyor — the one from Tuesday" acquires a reason it
  // does not have, and the text loses its second half.
  const blocked = parseItem('- [?] get the survey — waiting on the surveyor')
  assert.equal(blocked?.reason, 'waiting on the surveyor')
  assert.equal(blocked?.text, 'get the survey')

  const plain = parseItem('- [ ] call the surveyor — the one from Tuesday')
  assert.equal(plain?.reason, null)
  assert.equal(plain?.text, 'call the surveyor — the one from Tuesday')
})

test('THE ROUND TRIP: writing an item back produces the line it came from', () => {
  const lines = [
    `- [ ] Call the surveyor #house DUE 2026-09-14 ${MARK}`,
    `- [x] Ring the bank ${MARK}`,
    `- [?] Get the survey #house — waiting on the surveyor ${MARK}`,
    `- [>] Look at the loft again ${MARK}`,
    "- [/] Read #'the survey' properly",
    '- [ ] A line nobody has adopted yet',
  ]
  for (const line of lines) {
    const item = parseItem(line)
    assert.ok(item !== null, line)
    assert.equal(itemLine(item), line, line)
    // And it is stable: parsing what we wrote gives the same item back, which
    // is what makes every verb a line replacement rather than a file rewrite.
    assert.deepEqual(parseItem(itemLine(item)), item, line)
  }
})

test('a marker with no timestamps still names its item', () => {
  // Hand-written, or from a future that drops a field. Lenient parse, precise
  // serialise: what comes back out is what came in.
  const item = parseItem('- [ ] ring the bank <!--tephra:item abcd1234-->')
  assert.equal(item?.id, 'abcd1234')
  assert.equal(item?.ctime, null)
  assert.ok(item !== null)
  assert.equal(itemLine(item), '- [ ] ring the bank <!--tephra:item abcd1234-->')
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
  assert.equal(parseItem('- [ ] file it DUE FRIDAY')?.due, null)
  const resolved = resolveDue('- [ ] file it DUE FRIDAY', '2026-09-01' as DateKey)
  assert.equal(parseItem(resolved)?.due, '2026-09-04')
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
  const empty: TodoItem = {
    id: null, status: 'todo', ctime: null, mtime: null, owner: null, ownerSpan: null,
    text: '', tags: [], due: null, reason: null, notes: [], tagSpans: [], dueSpan: null,
  }
  assert.equal(itemLine(empty), '- [ ]')
  assert.equal(parseItem('- [ ]')?.text, '')
})

test('a due date is a DateKey the rest of the app already understands', () => {
  const due: DateKey | null = parseItem('- [ ] x DUE 2026-09-14')?.due ?? null
  assert.equal(due, '2026-09-14')
})

// ── the tag pivot (T8's cheap half) ────────────────────
//
// A grouping and not a query: every live item is in the day already open, so
// the view is a function of what is on screen. Tested here, with no DOM, for
// the reason the rest of the grammar is — the interesting cases are all about
// items and none of them are about drawing.

/** A line, through the real parser, so a test cannot invent an item shape. */
const item = (line: string): TodoItem => parseItem(line) as TodoItem

test('groups run alphabetically, and items keep the order they came in', () => {
  const groups = groupByTag([
    item('- [ ] fix the gate #house'),
    item('- [ ] call the surveyor #admin'),
    item('- [ ] paint the shed #house'),
  ])
  assert.deepEqual(groups.map(g => g.tag), ['admin', 'house'])
  assert.deepEqual(groups[1]?.items.map(i => i.text), [
    'fix the gate #house',
    'paint the shed #house',
  ])
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

test('OWNER is read off the line, like DUE and for the same reasons', () => {
  const item = parseItem('- [ ] ring the plumber OWNER Sam') as TodoItem
  assert.equal(item.owner, 'Sam')
  assert.equal(withoutMarks(item), 'ring the plumber')
})

test('and a name that needs quoting gets it, sharing the tag grammar', () => {
  assert.equal(spellOwner('Mary Jane'), "OWNER 'Mary Jane'")
  assert.equal((parseItem("- [ ] ring the plumber OWNER 'Mary Jane'") as TodoItem).owner, 'Mary Jane')
  // The escape the tag grammar grew, working here for free.
  assert.equal((parseItem("- [ ] x OWNER 'Bill O\\'Brien'") as TodoItem).owner, "Bill O'Brien")
})

test('and it comes off with the other marks, being a fact ABOUT the task', () => {
  // Which is the whole argument for a marker over `(owner: Sam)` in the title:
  // text in the sentence cannot be taken off for a summary.
  const item = parseItem("- [ ] ring the plumber #house OWNER Sam DUE 2026-09-20") as TodoItem
  assert.equal(withoutMarks(item), 'ring the plumber')
  assert.equal(item.owner, 'Sam')
  assert.deepEqual(item.tags, ['house'])
  assert.equal(item.due, '2026-09-20')
})

test('and a line with no owner says so, rather than guessing one', () => {
  assert.equal((parseItem('- [ ] ring the plumber') as TodoItem).owner, null)
})
