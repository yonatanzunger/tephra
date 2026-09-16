// The matter grammar (MH1, D68, D72).
//
// **A one-way door, so it gets its tests before anything stands on it** — the
// same reason the item grammar did. A docket accumulates for years and a format
// change later is a migration over every file.
//
// The property that governs the shape: **blocks are independent and nothing
// depends on indentation.** Merges are line-based and hand-editing must degrade
// gracefully, so a bad indent has to be survivable rather than structural.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addInterval, backInterval, matterBlock, parseInterval, parseInterval as _pi, parseLegacyWhen, parseMatter, parseOffset,
  parseStepWhen, readInterval, readSchedule, readStepWhen, scanMatters, spellInterval,
  spellOffset, spellStepWhen,
  unusedMatterId, STANDING, type Matter,
} from '../../../src/shared/kinds/docket.ts'
import type { DateKey } from '../../../src/shared/document-api.ts'

const MARK = '<!--tephra:matter 7f3a1b2c 1757462400 0-->'

const bare = (over: Partial<Matter> = {}): Matter => ({
  id: '7f3a1b2c', name: 'The oven is broken', when: STANDING, tags: [], owner: null,
  mode: 'task', done: null, link: null, steps: [], notes: [], arrived: 1757462400, declines: 0, from: null,
  occurrence: null, extra: [],
  ...over,
})

// ── when ───────────────────────────────────────────────────

test('THE FOUR SHAPES, in three variables and nothing else', () => {
  // The mode is derived rather than stored (D76, amended), so these four are
  // the whole vocabulary: a thing to get done, a thing happening, a thing that
  // comes round, and a thing to keep up with.
  const shapes = [
    { start: null, every: null, after: null, dates: null },
    { start: '2026-11-12', every: null, after: null, dates: null },
    { start: '2026-11-12', every: { n: 1, unit: 'y' }, after: null, dates: null },
    { start: '2026-11-12', every: { n: 90, unit: 'd' }, after: 'aaaa1111', dates: null },
  ] as const
  assert.deepEqual(shapes.map(one => readSchedule(one as never)), [
    '—',
    '2026-11-12',
    'every year from 2026-11-12',
    'every 90 days after it is done',
  ])
})

test('and a matter with an interval and no start is PAUSED, not broken', () => {
  // Which is what suspending a recurrence leaves: the shape stays, the date
  // goes, and restarting it is one field.
  assert.equal(
    readSchedule({ start: null, every: { n: 90, unit: 'd' }, after: null, dates: null }),
    'every 90 days, not started',
  )
})

test('THE INTERVAL carries the day it means, so a month cannot drift', () => {
  // Only where a clamp can hide it: the 31st in February. Days and weeks have
  // no such problem, so the field is refused on them.
  assert.deepEqual(parseInterval('90d'), { n: 90, unit: 'd' })
  assert.deepEqual(parseInterval('6 months'), { n: 6, unit: 'm' })
  assert.deepEqual(parseInterval('1m on 31'), { n: 1, unit: 'm', day: 31 })
  assert.deepEqual(parseInterval('1m on the 31st'), { n: 1, unit: 'm', day: 31 })
  assert.equal(parseInterval('90d on 31'), null, 'a day means nothing on an interval of days')
  assert.equal(parseInterval('1m on 41'), null)
  assert.equal(parseInterval('every 90 fortnights'), null)
  assert.equal(parseInterval('0d'), null, 'every no days is not a schedule')
})

test('and it round-trips, which is what the file depends on', () => {
  for (const said of ['90d', '1m', '1y', '1m on 31']) {
    const every = parseInterval(said)
    assert.ok(every !== null, said)
    assert.equal(spellInterval(every), said)
    assert.deepEqual(parseInterval(spellInterval(every)), every)
  }
})

test('and reads back in words for the column', () => {
  assert.equal(readInterval({ n: 90, unit: 'd' }), 'every 90 days')
  assert.equal(readInterval({ n: 1, unit: 'y' }), 'every year')
  assert.equal(readInterval({ n: 1, unit: 'm', day: 31 }), 'every month on the 31st')
  assert.equal(readInterval({ n: 1, unit: 'm', day: 2 }), 'every month on the 2nd')
})

test('THE OLD `when:` IS READ, so a docket from before the split opens', () => {
  // Read and never written — which is how the format moved without anybody
  // migrating a file, the same bargain the trigger line got.
  assert.deepEqual(parseLegacyWhen('—'), { start: null, every: null, after: null, dates: null })
  assert.deepEqual(parseLegacyWhen('2026-11-12'),
    { start: '2026-11-12', every: null, after: null, dates: null })
  assert.deepEqual(parseLegacyWhen('every 90d from 2026-10-01'),
    { start: '2026-10-01', every: { n: 90, unit: 'd' }, after: null, dates: null })
  assert.deepEqual(parseLegacyWhen('every 90d'),
    { start: null, every: { n: 90, unit: 'd' }, after: null, dates: null })
})

test('and a form that was WITHDRAWN is not understood here either', () => {
  // Ranges, seasons and `N after done` went for their own reasons (D76); an
  // old file holding one keeps it verbatim, to be corrected rather than lost.
  for (const said of [
    '2026-11-12..2026-11-20', '2026-03..2026-05', '6m after done', 'next Tuesdayish',
  ]) {
    assert.equal(parseLegacyWhen(said), null, said)
  }
})

test('and an impossible date is still impossible', () => {
  assert.equal(parseLegacyWhen('2026-02-30'), null)
  assert.equal(parseLegacyWhen('every 90d from 2026-13-01'), null)
})

// ── a block ────────────────────────────────────────────────

test('a block carries everything a matter is', () => {
  const matter = parseMatter([
    '## Change the air filters',
    'when: every 90d from 2026-10-01',
    "tags: #house #'air quality'",
    'owner: me',
    'link: ../notes/hvac.md',
    'steps:',
    '- -3d task: Change the air filters #house',
    '- -1d note: order filters if none left',
    '<!--tephra:matter aa11bb22 1757462400 2 2026-09-14-->',
  ].join('\n'))
  assert.ok(matter !== null)
  assert.equal(matter.name, 'Change the air filters')
  assert.deepEqual(matter.when, { start: '2026-10-01', every: { n: 90, unit: 'd' }, after: null, dates: null })
  assert.deepEqual(matter.tags, ['house', 'air quality'])
  assert.equal(matter.owner, 'me')
  assert.equal(matter.link, '../notes/hvac.md')
  // **The old trigger line is a readable subset**, which is why no file needed
  // migrating: no id, nothing done, and `note` reading as the `status` kind it
  // always meant.
  assert.deepEqual(matter.steps, [
    { id: null, kind: 'task', when: { kind: 'at', offset: '-3d' }, text: 'Change the air filters #house', done: null, made: null },
    { id: null, kind: 'status', when: { kind: 'at', offset: '-1d' }, text: 'order filters if none left', done: null, made: null },
  ])
})

test('THE FOUR THAT CANNOT BE BACKFILLED are all in the marker', () => {
  // id, arrived-on, decline count, outstanding occurrence. Every mechanism over
  // them may wait; none of them may.
  const matter = parseMatter(`## x\n<!--tephra:matter aa11bb22 1757462400 3 2026-09-14-->`)
  assert.ok(matter !== null)
  assert.equal(matter.id, 'aa11bb22')
  assert.equal(matter.arrived, 1757462400)
  assert.equal(matter.declines, 3)
  assert.equal(matter.occurrence, '2026-09-14')
})

test('and the occurrence is optional, because most matters have none', () => {
  const matter = parseMatter(`## x\n${MARK}`)
  assert.equal(matter?.occurrence, null)
})

test('a block somebody typed by hand has no id, and is still a matter', () => {
  // Which is what lets a docket be started in any editor and adopted later.
  const matter = parseMatter('## Fix the gate\nwhen: 2026-10-01')
  assert.ok(matter !== null)
  assert.equal(matter.id, null)
  assert.deepEqual(matter.when, { start: '2026-10-01', every: null, after: null, dates: null })
})

test('any heading level below the title opens a block', () => {
  for (const hashes of ['##', '###', '######']) {
    assert.equal(parseMatter(`${hashes} Repaint the house`)?.name, 'Repaint the house')
  }
})

test('THE TITLE IS NOT A MATTER: `#` is the document, by markdown convention', () => {
  // One `#` per document, `##` for its sections. A docket hand-written in
  // another editor opens with `# The house`, and reading that as a matter
  // called *The house* is what an integration test caught.
  assert.equal(parseMatter('# The house'), null)
  assert.deepEqual(
    scanMatters('# The house\n\nEverything true about it.\n\n## The gate sticks\nwhen: —\n')
      .map(m => m.matter.name),
    ['The gate sticks'],
  )
})

test('but something that is not a heading is not a matter', () => {
  assert.equal(parseMatter('when: 2026-10-01'), null)
  assert.equal(parseMatter('## '), null, 'and a heading with no name is not one either')
})

// ── leniency ───────────────────────────────────────────────

test('THE LENIENCY RULE: nothing a person wrote is lost, whatever it is', () => {
  // Two different survivals, and the line between them is whether it reads as a
  // field: an unknown `key: value` is kept as one, and bare prose is a note.
  // Neither is dropped, which is the only part that matters.
  const block = [
    '## The oven is broken',
    'when: —',
    'quoted: 480 for the part, plus labour',
    'a line of ordinary prose about the oven',
    MARK,
  ].join('\n')
  const matter = parseMatter(block)
  assert.ok(matter !== null)
  assert.deepEqual(matter.extra, ['quoted: 480 for the part, plus labour'])
  assert.deepEqual(matter.notes, ['a line of ordinary prose about the oven'])
  const back = matterBlock(matter)
  assert.ok(back.includes('quoted: 480 for the part, plus labour'))
  assert.ok(back.includes('a line of ordinary prose about the oven'))
})



test('and a trigger line it cannot read is kept rather than dropped', () => {
  const matter = parseMatter([
    '## A trip', 'steps:', '- -60d status: the trip is close', '- sometime, book the car', MARK,
  ].join('\n'))
  assert.equal(matter?.steps.length, 1)
  assert.deepEqual(matter?.extra, ['- sometime, book the car'])
})

test('THE WHITESPACE RULE: a bad indent changes nothing structural', () => {
  const tidy = parseMatter(['## A trip', 'steps:', '- -60d status: it is close', MARK].join('\n'))
  const messy = parseMatter(['## A trip', 'steps:', '    - -60d status: it is close', MARK].join('\n'))
  assert.deepEqual(messy, tidy)
})

// ── round trip ─────────────────────────────────────────────

test('THE PROPERTY: a block round-trips through parse and back', () => {
  const original = bare({
    name: 'The ACM talk',
    when: { start: '2026-11-12' as DateKey, every: null, after: null, dates: null },
    tags: ['speaking'],
    owner: 'me',
    link: '../notes/acm.md',
    steps: [{ id: 'aa11', kind: 'task' as const, when: { kind: 'at' as const, offset: '-14d' }, text: 'draft the slides', done: null, made: null }],
    occurrence: '2026-11-12' as DateKey,
    extra: ['venue: Portland'],
  })
  assert.deepEqual(parseMatter(matterBlock(original)), original)
})

test('and nothing empty is written, so a hand-made docket stays hand-made', () => {
  const block = matterBlock(bare())
  assert.equal(block, `## The oven is broken\nmode: task\nstart: —\n${MARK}`)
  assert.ok(!block.includes('owner:'))
  assert.ok(!block.includes('steps:'))
})

// ── scanning a docket ──────────────────────────────────────

const DOCKET = [
  '## The oven is broken',
  'when: —',
  'tags: #house',
  '<!--tephra:matter aaaa1111 1757462400 0-->',
  '',
  '',
  '## Repaint the house',
  'when: 2026-03..2026-05',
  '<!--tephra:matter bbbb2222 1757462400 1-->',
  '',
  '## Change the air filters',
  'when: every 90d',
  '<!--tephra:matter cccc3333 1757462400 0-->',
  '',
].join('\n')

test('every matter is found, in the order written', () => {
  const found = scanMatters(DOCKET)
  assert.deepEqual(found.map(m => m.matter.id), ['aaaa1111', 'bbbb2222', 'cccc3333'])
})

test('THE BLOCK BOUNDS: a verb rewrites one matter and no blank line around it', () => {
  const found = scanMatters(DOCKET)
  const second = found[1]
  assert.ok(second !== undefined)
  assert.equal(DOCKET.slice(second.from, second.to),
    '## Repaint the house\nwhen: 2026-03..2026-05\n<!--tephra:matter bbbb2222 1757462400 1-->')
  // Replacing that range must leave the spacing a person chose untouched.
  const edited = DOCKET.slice(0, second.from) + '## Repaint it\nwhen: —' + DOCKET.slice(second.to)
  assert.ok(edited.includes('\n\n\n## Repaint it'), 'the two blank lines above survive')
  assert.equal(scanMatters(edited).length, 3)
})

test('prose before the first heading belongs to the docket, not to a matter', () => {
  const found = scanMatters('Everything about the house.\n\n## The oven is broken\nwhen: —\n')
  assert.equal(found.length, 1)
  assert.equal(found[0]?.matter.name, 'The oven is broken')
})

test('an empty docket has no matters and does not throw', () => {
  assert.deepEqual(scanMatters(''), [])
  assert.deepEqual(scanMatters('\n\n'), [])
})

test('ids are minted against what is already taken', () => {
  const taken = new Set(['aaaa1111'])
  const made = unusedMatterId(taken, () => 0.5)
  assert.equal(made.length, 8)
  assert.ok(!taken.has(made))
})

// ── run-ups (MH1, H4) ──────────────────────────────────────

test('THE COMMON CASE IS BEFORE, so a bare offset needs no minus sign', () => {
  // The concept is a *run-up window* and every example in the requirements is
  // ahead of the date. Making somebody type punctuation nobody says out loud to
  // get the ordinary case is a tax on the common gesture.
  assert.equal(parseOffset('14d'), '-14d')
  assert.equal(parseOffset('2w'), '-2w')
  assert.equal(parseOffset('6m'), '-6m')
  assert.equal(parseOffset('1y'), '-1y')
})

test('and `+` is how you get the other one, explicitly', () => {
  // Because it exists — *file the expenses three days after the trip* — and a
  // silent version of the rare case would be a surprise.
  assert.equal(parseOffset('+3d'), '+3d')
  assert.equal(parseOffset('-3d'), '-3d')
})

test('T+0 IS a schedule, and the commonest one (D76)', () => {
  // It used to be refused — *an offset of nothing is a date, not a run-up* —
  // which was true while every step was preparation before a known date. The
  // first step of a backlog matter is due the moment it is activated, so zero
  // is the default rather than the nonsense case.
  assert.equal(parseOffset('0d'), '+0d')
  assert.equal(spellOffset('+0d'), 'right away')
  assert.equal(parseOffset('right away'), '+0d', 'and the words go back in')
  assert.equal(parseOffset('now'), '+0d')
})

test('and what is not an offset says so rather than guessing', () => {
  // `14 days` was on this list until use reported the asymmetry it came from:
  // the row read *14 days before* and the field beside it took only `14d`. A
  // spelled-out NUMBER is still refused — *two weeks* would need a numeral
  // parser, and nothing on the surface ever renders one.
  for (const said of ['', 'soon', 'two weeks', '14', 'd14', 'fortnight']) {
    assert.equal(parseOffset(said), null, said)
  }
  assert.equal(parseOffset('14 days'), '-14d', 'this one is now the point')
})

test('whitespace and case are forgiven, because this is typed while talking', () => {
  assert.equal(parseOffset(' 2W '), '-2w')
  assert.equal(parseOffset('2 w'), '-2w')
})

test('THE READBACK: an offset is read in words, not in notation', () => {
  // This is the line somebody says out loud across a table.
  assert.equal(spellOffset('-14d'), '14 days before')
  assert.equal(spellOffset('-1d'), '1 day before')
  assert.equal(spellOffset('-2w'), '2 weeks before')
  assert.equal(spellOffset('-6m'), '6 months before')
  assert.equal(spellOffset('+3d'), '3 days after')
})

test('and an offset it cannot read is shown as written rather than swallowed', () => {
  assert.equal(spellOffset('whenever'), 'whenever')
})

test('a step round-trips through the block, id and completion and all', () => {
  const matter = parseMatter([
    '## The ACM talk',
    'when: 2026-11-12',
    'steps:',
    '- -60d status: the talk is close <!--tephra:step 11aa22bb-->',
    '- -14d task: draft the slides <!--tephra:step 33cc44dd 1789148616-->',
    '- after 33cc44dd +3d task: file the expenses <!--tephra:step 55ee66ff-->',
    MARK,
  ].join('\n'))
  assert.ok(matter !== null)
  assert.deepEqual(matter.steps.map(t => `${t.when.kind === 'at' ? t.when.offset : `after ${t.when.step}`} ${t.kind}`),
    ['-60d status', '-14d task', 'after 33cc44dd task'])
  assert.equal(matter.steps[1]?.done, 1789148616, 'the completion stamp survives')
  assert.equal(matter.steps[2]?.when.kind === 'after' ? matter.steps[2].when.offset : null, '+3d')
  assert.deepEqual(parseMatter(matterBlock(matter))?.steps, matter.steps)
})

// ── anchored recurrence (MH1, H7) ──────────────────────────





// ── notes on a matter (MH1) ────────────────────────────────

test('THE NOTE: bare prose in the block, and nothing in it is parsed', () => {
  const matter = parseMatter([
    '## The oven is broken',
    'when: —',
    'The element went on Tuesday. Cheaper to replace the whole thing #maybe',
    'Waiting on a quote from the second firm.',
    MARK,
  ].join('\n'))
  assert.ok(matter !== null)
  assert.deepEqual(matter.notes, [
    'The element went on Tuesday. Cheaper to replace the whole thing #maybe',
    'Waiting on a quote from the second firm.',
  ])
  // The hash in the note is NOT a tag: a note is prose (D56's rule, carried).
  assert.deepEqual(matter.tags, [])
})

test('a note round-trips, and sits between the fields and the marker', () => {
  const matter = bare({ notes: ['Quoted 480 for the part.'], tags: ['house'] })
  const block = matterBlock(matter)
  assert.equal(block, [
    '## The oven is broken',
    'mode: task',
    'start: —',
    'tags: #house',
    'Quoted 480 for the part.',
    MARK,
  ].join('\n'))
  assert.deepEqual(parseMatter(block), matter)
})

test('a note and a run-up coexist without confusing each other', () => {
  const matter = parseMatter([
    '## Service the boiler',
    'when: 2026-10-14',
    'steps:',
    '- -2w task: book it',
    'Last one was done by the firm on the high street.',
    MARK,
  ].join('\n'))
  assert.equal(matter?.steps.length, 1)
  assert.deepEqual(matter?.notes, ['Last one was done by the firm on the high street.'])
})

test('and a note that reads as a field is kept as one rather than lost', () => {
  // No text is lost either way; only its classification differs, and it
  // round-trips in place.
  const matter = parseMatter(`## x\nwhen: —\ncost: about 500\n${MARK}`)
  assert.deepEqual(matter?.notes, [])
  assert.deepEqual(matter?.extra, ['cost: about 500'])
  assert.ok(matterBlock(matter as never).includes('cost: about 500'))
})




// ── what the app renders, the app parses ───────────────────



test('a run-up is too, because its row reads back in words as well', () => {
  assert.equal(parseOffset('2 weeks'), '-2w')
  assert.equal(parseOffset('2 weeks before'), '-2w')
  assert.equal(parseOffset('3 days after'), '+3d')
  assert.equal(parseOffset('week'), '-1w')
  // An explicit sign is the more deliberate of the two, so it wins.
  assert.equal(parseOffset('-3d after'), '-3d')
  for (const offset of ['-14d', '+3d', '-1w', '-6m', '+2y']) {
    assert.equal(parseOffset(spellOffset(offset)), offset, spellOffset(offset))
  }
})

test('and nonsense is still nonsense', () => {
  for (const said of ['2 fortnights', '2 weeks sideways', '']) {
    assert.equal(parseOffset(said), null, said)
  }
})



test('THE EDITABLE FORM names the step by its number, not by its id', () => {
  // Prefilling an edit field with `after okc8kiff` hands back the one reference
  // a person cannot type, which is the reason indices exist. Given the mapping
  // it says `after step 2`; without one — reading a file, where the block
  // stands alone — it is the id, which is what the file holds.
  const when = { kind: 'after' as const, step: 'okc8kiff' }
  assert.equal(spellStepWhen(when), 'after okc8kiff')
  assert.equal(spellStepWhen(when, () => 2), 'after #2')
  assert.equal(spellStepWhen({ ...when, offset: '+3d' }, () => 2), 'after #2 +3d')
  // And an id the mapping does not know falls back rather than inventing one.
  assert.equal(spellStepWhen(when, () => null), 'after okc8kiff')
})

test('and what it produces goes back in, which is the whole point of a pair', () => {
  for (const said of ['after #2', 'after step 2', 'after 2 +3d', 'after okc8kiff', '-2w', '+0d']) {
    const when = parseStepWhen(said, { resolve: token => (token === '2' ? 'okc8kiff' : token) })
    assert.ok(when !== null, said)
    assert.deepEqual(
      parseStepWhen(spellStepWhen(when, () => 2), { resolve: token => (token === '2' ? 'okc8kiff' : token) }),
      when,
      said,
    )
  }
})

test('A DEPENDENCY READS AS A NUMBER, which is what the row already shows', () => {
  // Naming the step it waits on read well alone and badly in a list: two rows
  // side by side said *after Find electrician* and *after 1*, which look like
  // different kinds of thing — and the long one pushed the text column out of
  // line with its neighbours.
  const when = { kind: 'after' as const, step: 'okc8kiff' }
  assert.equal(readStepWhen(when, () => 2), 'after #2')
  assert.equal(readStepWhen({ ...when, offset: '+3d' }, () => 2), '3 days after #2')
  // A reference to a step that is not there is visible, not silent.
  assert.equal(readStepWhen(when, () => null), 'after ?')
})

test('and every way of writing one goes back in (accept flexibly)', () => {
  const to = (token: string): string | null => (token === '2' ? 'okc8kiff' : token)
  for (const said of ['after #2', 'after 2', 'after step 2', 'after step #2', 'after okc8kiff']) {
    assert.deepEqual(
      parseStepWhen(said, { resolve: to }),
      { kind: 'after', step: 'okc8kiff' },
      said,
    )
  }
})

// ── an explicit list of instances (H7, restored) ────────────

test('a listed schedule reads as its next date and how many are left', () => {
  const dates = ['2026-09-20', '2026-10-04', '2026-10-18'] as DateKey[]
  assert.equal(
    readSchedule({ start: '2026-09-20' as DateKey, every: null, after: null, dates }),
    '2026-09-20, 2 more',
  )
  assert.equal(
    readSchedule({ start: '2026-10-18' as DateKey, every: null, after: null, dates }),
    '2026-10-18, the last',
  )
  assert.equal(
    readSchedule({ start: null, every: null, after: null, dates }),
    '3 dates, all past',
  )
})

test('and the block round-trips a list, which is the format claim', () => {
  const dates = ['2026-09-20', '2026-10-04'] as DateKey[]
  const block = matterBlock(bare({
    name: 'The campaign',
    when: { start: '2026-09-20' as DateKey, every: null, after: null, dates },
  }))
  assert.match(block, /^dates: 2026-09-20, 2026-10-04$/m)
  assert.deepEqual(parseMatter(block)?.when.dates, dates)
})

test('AND A LIST WITH ONE BAD DATE IN IT IS KEPT VERBATIM, not silently pruned', () => {
  // The leniency rule (D72): a typo is somebody's mistake to correct, and
  // rewriting the line without the broken one would drop a session without
  // saying so.
  const parsed = parseMatter('## The campaign\nstart: 2026-09-20\ndates: 2026-09-20, notaday')
  assert.equal(parsed?.when.dates, null)
  assert.ok(parsed?.extra.some(one => one.includes('notaday')))
})

// ── a task's date is not an event's (D80, amended) ──────────
//
// **`start` means two different things**, and the column only ever said one. For
// an event it is *the day this happens*; for a task it is *the day work began*,
// which is what activating writes. Read as a bare date, every task sounded like
// an appointment.

test('A TASK SAYS WHEN IT STARTED; an event says when it happens', () => {
  const when = { start: '2026-09-10' as DateKey, every: null, after: null, dates: null }
  const today = '2026-09-13' as DateKey
  assert.equal(readSchedule(when, 'task', today), 'started 2026-09-10')
  assert.equal(readSchedule(when, 'event', today), '2026-09-10')
})

test('and a task dated ahead has NOT started, which the tense has to say', () => {
  // Otherwise the row repeats a small lie every day until the date arrives.
  const when = { start: '2026-09-20' as DateKey, every: null, after: null, dates: null }
  assert.equal(readSchedule(when, 'task', '2026-09-13' as DateKey), 'starting 2026-09-20')
})

test('and an undated task says so in the words its button uses', () => {
  // *No date yet* is true of a task and useful about it only if you already know
  // that dating it is what starting it means. **Activate** is the control beside
  // it, so the two have to agree.
  const when = { start: null, every: null, after: null, dates: null }
  assert.equal(readSchedule(when, 'task'), 'not started')
  assert.equal(readSchedule(when, 'event'), '—')
})

test('a recurring task counting from a date reads as a task, not an appointment', () => {
  const when = { start: '2026-09-10' as DateKey, every: { n: 90, unit: 'd' as const }, after: null, dates: null }
  assert.equal(readSchedule(when, 'recurring-task', '2026-09-13' as DateKey),
    'every 90 days, started 2026-09-10')
  assert.equal(readSchedule(when, 'recurring-event', '2026-09-13' as DateKey),
    'every 90 days from 2026-09-10')
})

test('and one counting from completion already said it right, so it is unchanged', () => {
  const when = { start: '2026-09-10' as DateKey, every: { n: 90, unit: 'd' as const }, after: 'abcd1234', dates: null }
  assert.equal(readSchedule(when, 'recurring-task'), 'every 90 days after it is done')
})

test('and with no mode given it reads as it always did, for callers that have none', () => {
  const when = { start: '2026-09-10' as DateKey, every: null, after: null, dates: null }
  assert.equal(readSchedule(when), '2026-09-10')
})

test('BACK AND FORWARD ROUND-TRIP, so "last done" can be asked for instead', () => {
  // A matter recurring from its own completion stores *when it is next due*, and
  // what a person knows is *when I last did it*. The panel asks the question
  // somebody can answer and converts, which needs the inverse to exist.
  for (const every of [
    { n: 120, unit: 'd' as const },
    { n: 2, unit: 'w' as const },
    { n: 3, unit: 'm' as const },
    { n: 1, unit: 'y' as const },
  ]) {
    const from = '2026-09-13' as DateKey
    assert.equal(addInterval(backInterval(from, every), every).date, from, JSON.stringify(every))
  }
})

test('and a month-end anchor survives the trip, which is where it could not', () => {
  // 31 Jan going back a month is 31 Dec, not 28 Feb's worth of drift — the same
  // rule `addInterval` keeps going forward.
  assert.equal(backInterval('2026-01-31' as DateKey, { n: 1, unit: 'm' }), '2025-12-31')
  assert.equal(backInterval('2026-03-31' as DateKey, { n: 1, unit: 'm' }), '2026-02-28')
})

test('THE FIELD TAKES WHAT IT SHOWS: "every 5 years" parses', () => {
  // Reported from use, and the second time this asymmetry has appeared — the
  // first was `every 90d` accepted while `every 90 days` was not. The column
  // renders *every 5 years*; being told that is not an interval is being
  // corrected for agreeing with the app.
  for (const said of ['every 5 years', '5 years', '5y', 'every 5y', 'EVERY 5 YEARS']) {
    assert.deepEqual(parseInterval(said), { n: 5, unit: 'y' }, said)
  }
  assert.deepEqual(parseInterval('every 1 month on the 31st'), { n: 1, unit: 'm', day: 31 })
  // And it still refuses what is not one.
  assert.equal(parseInterval('every so often'), null)
  assert.equal(parseInterval('every 0 days'), null)
})
