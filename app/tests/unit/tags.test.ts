// Stacking overlapping subjects, and which colour each one gets (MB.1, MB.3).

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readTag, spellTag, stack, subjectKey, tagMark, tagSlot, TAG_HUES } from '../../src/shared/tags.ts'

test('one tag sits on the first rule, closest to its text', () => {
  assert.deepEqual(stack([{ from: 0, to: 10, name: 'a' }]).map(e => e.depth), [0])
})

test('subjects that do not overlap share the first rule', () => {
  assert.deepEqual(
    stack([
      { from: 0, to: 10, name: 'a' },
      { from: 10, to: 20, name: 'b' },
    ]).map(e => e.depth),
    [0, 0],
  )
})

test('overlapping subjects stack, and each takes the lowest free rule', () => {
  const out = stack([
    { from: 0, to: 30, name: 'a' },
    { from: 5, to: 15, name: 'b' },
    { from: 10, to: 25, name: 'c' },
    { from: 20, to: 24, name: 'd' },
  ])
  assert.deepEqual(out.map(e => e.depth), [0, 1, 2, 1])
})

test('past three deep the extent is not drawn — the marks still are', () => {
  const out = stack([
    { from: 0, to: 40, name: 'a' },
    { from: 1, to: 40, name: 'b' },
    { from: 2, to: 40, name: 'c' },
    { from: 3, to: 40, name: 'd' },
  ])
  assert.equal(out.length, 3, 'the fourth is dropped rather than drawn over the line below')
  assert.deepEqual(out.map(e => e.depth), [0, 1, 2])
})

test('an empty span draws nothing', () => {
  assert.deepEqual(stack([{ from: 5, to: 5, name: 'a' }]), [])
})

test('a subject keeps its colour, whatever it is typed as', () => {
  assert.equal(tagSlot('House Deal'), tagSlot('house deal'))
  assert.equal(tagSlot('House  Deal '), tagSlot('house deal'))
  assert.equal(subjectKey('House  Deal '), 'house deal')
})

test('slots are in range, and the hues are distinct', () => {
  for (const name of ['a', 'house deal', 'shock limit', 'a very long subject name indeed']) {
    const slot = tagSlot(name)
    assert.ok(slot >= 0 && slot < TAG_HUES.length, `${name} → ${slot}`)
  }
  assert.equal(new Set(TAG_HUES).size, TAG_HUES.length)
})

test('the eight hues are all reachable, and none hoards the subjects', () => {
  // Written after the first version took FNV's low three bits directly: three
  // hues were unreachable and a quarter of a sample of names shared one colour.
  // A palette of eight that behaves like a palette of five is worse than
  // useless, because it looks like it is telling you something.
  //
  // Enough names that this measures the hash rather than a coin flip: with two
  // dozen subjects an empty slot happens by luck about a quarter of the time,
  // so a test on two dozen would fail for no reason and pass for no reason.
  const subjects = [
    'shock limit', 'participant', 'house deal', 'titration', 'intrinsic S', 'hold-up',
    'klein', 'mortgage', 'physics', 'tephra', 'margin', 'comment', 'marginalia',
    ...Array.from({ length: 400 }, (_, i) => `subject ${i}`),
  ]
  const counts = new Array<number>(TAG_HUES.length).fill(0)
  for (const subject of subjects) {
    counts[tagSlot(subject)] = (counts[tagSlot(subject)] as number) + 1
  }
  const expected = subjects.length / TAG_HUES.length
  assert.equal(counts.filter(n => n === 0).length, 0, `unreachable hues: ${counts.join(' ')}`)
  assert.ok(Math.min(...counts) > expected / 2, `a hue is starved: ${counts.join(' ')}`)
  assert.ok(Math.max(...counts) < expected * 2, `a hue hoards: ${counts.join(' ')}`)
})

// ── spelling a subject as a tag, and reading it back (MH4) ──
//
// **`spellTag(readTag(x)) === x` is the claim**, and it is the one the docket
// needed: a generated item is tagged with the matter that made it, and matters
// are named by people — *Ada's birthday*, *the house*, *SA-512*.

test('a plain word takes the bare form, which is what people type', () => {
  assert.equal(spellTag('house'), '#house')
  assert.equal(spellTag('SA-512'), '#SA-512')
})

test('and anything else takes the quoted one', () => {
  assert.equal(spellTag('the house'), "#'the house'")
})

test("AN APOSTROPHE IS ESCAPED, not refused", () => {
  // The first cut returned null here, on the grounds that the quoted form had
  // no way to say one — a fair reading of the grammar and an absurd thing to do
  // to a name as ordinary as this. The grammar grew the escape instead.
  assert.equal(spellTag("Ada's birthday"), "#'Ada\\'s birthday'")
  const found = tagMark().exec(spellTag("Ada's birthday") as string)
  assert.equal(readTag(found as RegExpMatchArray), "Ada's birthday")
})

test('and a backslash too, or the escape could not be written literally', () => {
  const said = 'a \\ b'
  const found = tagMark().exec(spellTag(said) as string)
  assert.equal(readTag(found as RegExpMatchArray), said)
})

test('A NEWLINE BECOMES A SPACE rather than an escape', () => {
  // A tag mark lives inside one line of a file people read and edit by hand; an
  // escape for a newline would mean a tag spanning lines in the bytes and not on
  // the page, which is the kind of cleverness that costs somebody an afternoon.
  assert.equal(spellTag('two\nlines'), "#'two lines'")
  assert.equal(spellTag('  spaced   out  '), "#'spaced out'")
})

test('and a name of nothing cannot be a tag, which is the only refusal left', () => {
  assert.equal(spellTag(''), null)
  assert.equal(spellTag('   '), null)
})

test('ROUND TRIP: every one of these survives being written and read', () => {
  for (const said of ['house', 'the house', "Ada's birthday", 'a \\ b', "it's a 'quote'", 'SA-512']) {
    const mark = spellTag(said)
    assert.notEqual(mark, null, said)
    const found = tagMark().exec(mark as string)
    assert.notEqual(found, null, `${said} did not match its own spelling`)
    assert.equal(readTag(found as RegExpMatchArray), said, said)
  }
})
