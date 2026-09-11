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
  matterBlock, parseMatter, parseOffset, parseWhen, scanMatters, spellOffset, spellWhen,
  unusedMatterId, STANDING, type Matter,
} from '../../../src/shared/kinds/docket.ts'
import type { DateKey } from '../../../src/shared/document-api.ts'

const MARK = '<!--tephra:matter 7f3a1b2c 1757462400 0-->'

const bare = (over: Partial<Matter> = {}): Matter => ({
  id: '7f3a1b2c', name: 'The oven is broken', when: STANDING, tags: [], owner: null,
  link: null, triggers: [], arrived: 1757462400, declines: 0, occurrence: null, extra: [],
  ...over,
})

// ── when ───────────────────────────────────────────────────

test('THE THREE KINDS: standing, dated, recurring', () => {
  // H7b: the household case produced all three at once, and *no date* is a
  // state rather than a blank — giving one a date is the point of the review.
  assert.deepEqual(parseWhen('—'), { kind: 'standing' })
  assert.deepEqual(parseWhen(''), { kind: 'standing' })
  assert.deepEqual(parseWhen('2026-11-12'), { kind: 'on', date: '2026-11-12' })
  assert.deepEqual(parseWhen('every 90d'), { kind: 'every', n: 90, unit: 'd' })
})

test('a range is days; a season is months, and nothing else here is coarser', () => {
  assert.deepEqual(parseWhen('2026-11-12..2026-11-14'),
    { kind: 'between', from: '2026-11-12', until: '2026-11-14' })
  assert.deepEqual(parseWhen('2026-03..2026-05'),
    { kind: 'season', from: '2026-03', until: '2026-05' })
})

test('completion-relative recurrence is its own kind, not a rule with a flag', () => {
  // H7: "N days after the last time it actually happened" is why completion has
  // to flow backward at all.
  assert.deepEqual(parseWhen('90d after done'), { kind: 'after', n: 90, unit: 'd' })
})

test('and holidays come from a file, never a service (D69)', () => {
  assert.deepEqual(parseWhen('ics: holidays.ics'), { kind: 'ics', file: 'holidays.ics' })
})

test('THE POINT: a `when` this cannot read is NOT standing', () => {
  // Silently treating it as undated would stop the matter ever reaching the
  // horizon, which is the failure the whole design exists against.
  assert.equal(parseWhen('next Tuesdayish'), null)
  assert.equal(parseWhen('third Thursday of November'), null, 'calendar rules are wanted later')
})

test('every when round-trips through its spelling', () => {
  for (const said of [
    '—', '2026-11-12', '2026-11-12..2026-11-14', '2026-03..2026-05',
    'every 90d', 'every 2w', '90d after done', 'ics: holidays.ics',
  ]) {
    const when = parseWhen(said)
    assert.ok(when !== null, said)
    assert.equal(spellWhen(when), said)
  }
})

// ── a block ────────────────────────────────────────────────

test('a block carries everything a matter is', () => {
  const matter = parseMatter([
    '## Change the air filters',
    'when: 90d after done',
    "tags: #house #'air quality'",
    'owner: me',
    'link: ../notes/hvac.md',
    'triggers:',
    '- -3d task: Change the air filters #house',
    '- -1d note: order filters if none left',
    '<!--tephra:matter aa11bb22 1757462400 2 2026-09-14-->',
  ].join('\n'))
  assert.ok(matter !== null)
  assert.equal(matter.name, 'Change the air filters')
  assert.deepEqual(matter.when, { kind: 'after', n: 90, unit: 'd' })
  assert.deepEqual(matter.tags, ['house', 'air quality'])
  assert.equal(matter.owner, 'me')
  assert.equal(matter.link, '../notes/hvac.md')
  assert.deepEqual(matter.triggers, [
    { offset: '-3d', effect: 'task', text: 'Change the air filters #house' },
    { offset: '-1d', effect: 'note', text: 'order filters if none left' },
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
  assert.deepEqual(matter.when, { kind: 'on', date: '2026-10-01' })
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

test('THE LENIENCY RULE: a key this does not know survives verbatim', () => {
  const block = [
    '## The oven is broken',
    'when: —',
    'quoted: 480 for the part, plus labour',
    'a line of ordinary prose about the oven',
    MARK,
  ].join('\n')
  const matter = parseMatter(block)
  assert.ok(matter !== null)
  assert.deepEqual(matter.extra, ['quoted: 480 for the part, plus labour', 'a line of ordinary prose about the oven'])
  assert.ok(matterBlock(matter).includes('quoted: 480 for the part, plus labour'))
  assert.ok(matterBlock(matter).includes('a line of ordinary prose about the oven'))
})

test('and a trigger line it cannot read is kept rather than dropped', () => {
  const matter = parseMatter([
    '## A trip', 'triggers:', '- -60d doc: from the trip template', '- sometime, book the car', MARK,
  ].join('\n'))
  assert.equal(matter?.triggers.length, 1)
  assert.deepEqual(matter?.extra, ['- sometime, book the car'])
})

test('THE WHITESPACE RULE: a bad indent changes nothing structural', () => {
  const tidy = parseMatter(['## A trip', 'triggers:', '- -60d doc: the template', MARK].join('\n'))
  const messy = parseMatter(['## A trip', 'triggers:', '    - -60d doc: the template', MARK].join('\n'))
  assert.deepEqual(messy, tidy)
})

// ── round trip ─────────────────────────────────────────────

test('THE PROPERTY: a block round-trips through parse and back', () => {
  const original = bare({
    name: 'The ACM talk',
    when: { kind: 'on', date: '2026-11-12' as DateKey },
    tags: ['speaking'],
    owner: 'me',
    link: '../notes/acm.md',
    triggers: [{ offset: '-14d', effect: 'task', text: 'draft the slides' }],
    occurrence: '2026-11-12' as DateKey,
    extra: ['venue: Portland'],
  })
  assert.deepEqual(parseMatter(matterBlock(original)), original)
})

test('and nothing empty is written, so a hand-made docket stays hand-made', () => {
  const block = matterBlock(bare())
  assert.equal(block, `## The oven is broken\nwhen: —\n${MARK}`)
  assert.ok(!block.includes('owner:'))
  assert.ok(!block.includes('triggers:'))
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

test('an offset of nothing is a date, not a run-up', () => {
  assert.equal(parseOffset('0d'), null)
})

test('and what is not an offset says so rather than guessing', () => {
  for (const said of ['', 'soon', 'two weeks', '14', 'd14', '14 days']) {
    assert.equal(parseOffset(said), null, said)
  }
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

test('a trigger round-trips through the block', () => {
  const matter = parseMatter([
    '## The ACM talk',
    'when: 2026-11-12',
    'triggers:',
    '- -60d doc: from the talk template',
    '- -14d task: draft the slides',
    '- +3d task: file the expenses',
    MARK,
  ].join('\n'))
  assert.ok(matter !== null)
  assert.deepEqual(matter.triggers.map(t => `${t.offset} ${t.effect}`),
    ['-60d doc', '-14d task', '+3d task'])
  assert.deepEqual(parseMatter(matterBlock(matter))?.triggers, matter.triggers)
})
