// Putting a subject over a range, and taking it off one.
//
// The invariant every case here is really testing is ALTERNATION: for one
// subject, tag-start and tag-end must strictly alternate through the file,
// because that is what lets a span be paired with no identifier (D21). If any
// operation can leave two starts in a row, tags stop meaning anything and the
// damage is silent.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parser } from '@lezer/markdown'
import { resolveTags, scanMarkers, subjectKey, tagBody } from '../../../../src/main/x/markers.ts'

/** Asked of the real markdown parser, never of a belief about it. */
function strong(src: string): boolean {
  let found = false
  parser.parse(src).iterate({ enter: n => { if (n.name === 'StrongEmphasis') found = true } })
  return found
}

const apply = (body: string, subject: string, from: number, to: number, op: 'add' | 'remove'): string =>
  tagBody(body, subject, { from, to }, op)

/** The subject's spans, as the text they actually cover. */
const covered = (body: string, subject: string): string[] =>
  resolveTags(scanMarkers(body), body)
    .filter(t => subjectKey(t.name) === subjectKey(subject))
    .map(t => body.slice(t.from, t.to).replace(/<!--tephra:[^>]*-->/g, '').trim())

/** Alternation, checked directly rather than inferred from the spans. */
function alternates(body: string, subject: string): boolean {
  let open = false
  for (const m of scanMarkers(body)) {
    if (subjectKey(m.name) !== subjectKey(subject)) continue
    if (m.kind === 'tag-start') {
      if (open) return false
      open = true
    } else if (m.kind === 'tag-end') {
      if (!open) return false
      open = false
    }
  }
  return true
}

/**
 * The raw range of some VISIBLE text — the words with the markers taken out.
 *
 * Once a body carries markers, `indexOf` on the words no longer finds them:
 * `alpha<!--tephra:tag-end s--> beta` contains no "alpha beta". A person
 * selecting those two words does not see the marker, so the tests should not
 * have to either.
 */
function at(body: string, text: string): { from: number; to: number } {
  const map: number[] = []
  let visible = ''
  for (let i = 0; i < body.length; ) {
    if (body.startsWith('<!--tephra:', i)) {
      const end = body.indexOf('-->', i)
      if (end !== -1) { i = end + 3; continue }
    }
    map.push(i)
    visible += body[i]
    i++
  }
  const start = visible.indexOf(text)
  assert.notEqual(start, -1, `"${text}" is not visible in ${JSON.stringify(body)}`)
  return { from: map[start] as number, to: (map[start + text.length - 1] as number) + 1 }
}

test('tagging a range covers exactly that text', () => {
  const body = 'The house deal closed on Tuesday.\n'
  const r = at(body, 'house deal')
  const out = apply(body, 'house deal', r.from, r.to, 'add')
  assert.deepEqual(covered(out, 'house deal'), ['house deal'])
  assert.ok(alternates(out, 'house deal'))
})

test('tagging an overlapping range merges rather than nesting', () => {
  const body = 'alpha beta gamma delta\n'
  let out = apply(body, 's', at(body, 'alpha beta').from, at(body, 'alpha beta').to, 'add')
  out = apply(out, 's', at(out, 'beta gamma').from, at(out, 'beta gamma').to, 'add')
  assert.deepEqual(covered(out, 's'), ['alpha beta gamma'])
  assert.ok(alternates(out, 's'))
})

test('tagging an abutting range extends the existing span', () => {
  const body = 'alpha beta gamma\n'
  let out = apply(body, 's', at(body, 'alpha').from, at(body, 'alpha').to, 'add')
  const next = at(out, ' beta')
  out = apply(out, 's', next.from, next.to, 'add')
  assert.deepEqual(covered(out, 's'), ['alpha beta'])
})

test('untagging the middle of a span splits it in two', () => {
  const body = 'alpha beta gamma\n'
  let out = apply(body, 's', 0, 16, 'add')
  out = apply(out, 's', at(out, ' beta ').from, at(out, ' beta ').to, 'remove')
  assert.deepEqual(covered(out, 's'), ['alpha', 'gamma'])
  assert.ok(alternates(out, 's'))
})

test('untagging an edge trims the span', () => {
  const body = 'alpha beta gamma\n'
  let out = apply(body, 's', 0, 16, 'add')
  out = apply(out, 's', at(out, 'alpha ').from, at(out, 'alpha ').to, 'remove')
  assert.ok(alternates(out, 's'))
  assert.deepEqual(covered(out, 's'), ['beta gamma'])
})

test('untagging the whole span restores the original text exactly', () => {
  for (const body of [
    'alpha beta gamma\n',
    '**Bold opening** and then some text that wraps\nonto a second line.\n',
    'A line.\n\nAnother paragraph entirely.\n',
  ]) {
    const tagged = apply(body, 'House Deal', 0, body.length, 'add')
    assert.notEqual(tagged, body, `nothing was tagged in ${JSON.stringify(body)}`)
    const back = apply(tagged, 'house deal', 0, tagged.length, 'remove')
    assert.equal(back, body)
  }
})

test('tagging the same range twice changes nothing the second time', () => {
  const body = 'alpha beta gamma\n'
  const r = at(body, 'alpha beta')
  const once = apply(body, 's', r.from, r.to, 'add')
  const again = at(once, 'alpha beta')
  assert.equal(tagBody(once, 's', { from: again.from, to: again.to }, 'add'), once)
})

test('tagging a bold opening leaves it bold, per the real parser', () => {
  const body = '**Bold opening** is a property of the thing.\n'
  const out = apply(body, 's', 0, body.length, 'add')
  assert.ok(out.includes('**Bold opening**'), 'the text itself was altered')
  assert.ok(strong(out), `the bold did not survive: ${JSON.stringify(out)}`)
})

test('a subject already in the file keeps the capitalisation it was given', () => {
  const body = 'alpha beta gamma delta\n'
  let out = apply(body, 'House Deal', at(body, 'alpha').from, at(body, 'alpha').to, 'add')
  out = apply(out, 'HOUSE DEAL', at(out, 'gamma').from, at(out, 'gamma').to, 'add')
  assert.equal(out.match(/tag-start [^-]*/g)?.every(s => s.includes('House Deal')), true)
})

test('markers in fenced code are text, not tags', () => {
  const body = '```\n<!--tephra:tag-start s-->\n```\nreal text here\n'
  const out = apply(body, 's', at(body, 'real text').from, at(body, 'real text').to, 'add')
  assert.ok(out.includes('```\n<!--tephra:tag-start s-->\n```'), 'the code block was rewritten')
  assert.deepEqual(covered(out, 's'), ['real text'])
})

test('two subjects over the same text overlap freely and independently', () => {
  const body = 'alpha beta gamma delta\n'
  let out = apply(body, 'one', at(body, 'alpha beta').from, at(body, 'alpha beta').to, 'add')
  out = apply(out, 'two', at(out, 'beta gamma').from, at(out, 'beta gamma').to, 'add')
  assert.deepEqual(covered(out, 'one'), ['alpha beta'])
  assert.deepEqual(covered(out, 'two'), ['beta gamma'])

  // And removing one leaves the other exactly where it was.
  out = apply(out, 'one', 0, out.length, 'remove')
  assert.deepEqual(covered(out, 'one'), [])
  assert.deepEqual(covered(out, 'two'), ['beta gamma'])
})

test('untagging text that carries no such subject is a no-op', () => {
  const body = 'alpha beta\n'
  assert.equal(tagBody(body, 'absent', { from: 0, to: 5 }, 'remove'), body)
})

test('a range of only whitespace tags nothing', () => {
  const body = 'alpha   beta\n'
  assert.equal(tagBody(body, 's', { from: 5, to: 8 }, 'add'), body)
})
