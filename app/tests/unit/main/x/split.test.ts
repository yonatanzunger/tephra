// The split rule (format-spec.md).
//
// At ~100 KB a day, a 1 MB threshold means this will essentially never fire —
// which is its own hazard. **A path that fires once every few years is broken
// when it fires**, so everything here forces it with a small threshold instead
// of waiting for a real day to grow.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { splitBody, SPLIT_THRESHOLD } from '../../../../src/main/x/split.ts'

/** `n` paragraphs of roughly `size` characters each. */
function paragraphs(n: number, size: number): string {
  const filler = 'word '.repeat(Math.max(1, Math.ceil(size / 5)))
  return Array.from({ length: n }, (_, i) => `${i}: ${filler.slice(0, size)}`).join('\n\n') + '\n'
}

test('an ordinary day is one part', () => {
  const body = paragraphs(20, 400)
  assert.deepEqual(splitBody(body), [body])
  assert.deepEqual(splitBody('', 10), [''])
})

test('THE INVARIANT: the parts always rejoin into exactly the body', () => {
  // Everything else rests on this. If it ever fails, a day silently loses or
  // gains text at a boundary and no other test would necessarily catch it.
  for (const [n, size, threshold] of [
    [50, 100, 500],
    [50, 100, 137],
    [3, 5000, 1000],
    [200, 10, 64],
    [1, 100, 10],
  ] as const) {
    const body = paragraphs(n, size)
    const parts = splitBody(body, threshold)
    assert.equal(parts.join(''), body, `n=${n} size=${size} threshold=${threshold}`)
    assert.ok(parts.length >= 1)
  }
})

test('a part ends at a paragraph boundary, not mid-sentence', () => {
  const body = paragraphs(20, 100)
  const parts = splitBody(body, 300)
  for (const part of parts.slice(0, -1)) {
    assert.match(part, /\n\n$|\n$/, 'parts break where paragraphs do')
  }
})

test('PREFIX-STABILITY: appending never moves an existing boundary', () => {
  // The property the whole rule exists for. A boundary that moved when a day
  // was appended to would reshuffle that day's files and manufacture a sync
  // conflict out of a change nobody made.
  const threshold = 400
  let body = paragraphs(10, 90)
  let previous = splitBody(body, threshold)

  for (let i = 0; i < 40; i++) {
    body += `appended paragraph ${i}, of some length or other\n\n`
    const now = splitBody(body, threshold)

    // Every part except the last one must be byte-identical to before: only
    // the tail may still grow.
    const settled = previous.slice(0, -1)
    assert.deepEqual(
      now.slice(0, settled.length),
      settled,
      `boundary moved after append ${i}`,
    )
    assert.ok(now.length >= previous.length, 'parts are never un-split')
    previous = now
  }
})

test('the split is the same however the text arrived', () => {
  // Determinism, which prefix-stability implies but which is worth pinning
  // separately: a day typed in one sitting and the same day assembled from a
  // dozen appends must produce identical files, or two machines holding the
  // same text would disagree about how it is stored.
  const threshold = 350
  const whole = paragraphs(30, 80)
  const built = paragraphs(30, 80)
    .split('\n\n')
    .reduce((acc, p, i, all) => acc + p + (i < all.length - 1 ? '\n\n' : ''), '')
  assert.deepEqual(splitBody(whole, threshold), splitBody(built, threshold))
})

test('a single paragraph larger than the threshold is kept whole', () => {
  // Splitting inside it would cut a sentence in half in a file a person may
  // open in another editor. A rare, visible, harmless overflow beats silent
  // damage to the text.
  const huge = 'x'.repeat(5000)
  const body = `short\n\n${huge}\n\nafter\n`
  const parts = splitBody(body, 1000)
  assert.equal(parts.join(''), body)
  assert.ok(
    parts.some(p => p.includes(huge)),
    'the oversized paragraph survives intact in one part',
  )
})

test('no part is empty', () => {
  // An empty part would become an empty file with frontmatter and no body —
  // a day fragment that exists for no reason and shows up in every listing.
  for (const threshold of [10, 37, 100, 512]) {
    const parts = splitBody(paragraphs(40, 60), threshold)
    for (const part of parts) assert.notEqual(part.length, 0)
  }
})

test('a body ending exactly on a boundary does not produce a trailing empty part', () => {
  const body = 'one\n\ntwo\n\n'
  const parts = splitBody(body, 5)
  assert.equal(parts.join(''), body)
  // Parenthesised: `x?.length ?? 0 > 0` parses as `x?.length ?? (0 > 0)`, so
  // the first version of this line asserted a length against `true`.
  assert.ok((parts.at(-1)?.length ?? 0) > 0)
})

test('the shipped threshold is 1 MB and a realistic day is nowhere near it', () => {
  assert.equal(SPLIT_THRESHOLD, 1_000_000)
  const busyDay = paragraphs(1000, 100) // ~100 KB, a heavy day
  assert.ok(busyDay.length < SPLIT_THRESHOLD / 5)
  assert.equal(splitBody(busyDay).length, 1)
})
