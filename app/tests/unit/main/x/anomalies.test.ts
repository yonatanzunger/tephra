// The degradation table (format-spec.md), case by case.
//
// Each of these behaviours was already correct and already silent. What is
// under test is the *report* — and the point of testing it is that a promise to
// report every anomaly is worth exactly as much as the cases it actually covers.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { findAnomalies } from '../../../../src/main/x/anomalies.ts'
import { parseFile } from '../../../../src/main/x/frontmatter.ts'
import { scanMarkers } from '../../../../src/main/x/markers.ts'
import type { DateKey } from '../../../../src/shared/document-api.ts'

const DAY = '2026-03-14' as DateKey

function check(text: string, date: DateKey = DAY): ReturnType<typeof findAnomalies> {
  const parsed = parseFile(text)
  return findAnomalies({
    file: 'stream/2026/03/2026-03-14.md',
    date,
    parsed,
    markers: scanMarkers(parsed.body),
    bodyOffset: parsed.blockEnd,
    text,
  })
}

const good = (body: string): string => `---\ntephra: 1\ndate: ${DAY}\nkind: stream\n---\n${body}`

test('a well-formed file reports nothing', () => {
  const found = check(good('Ordinary prose, with no markers at all.\n'))
  assert.deepEqual(found, [])
})

test('an unterminated tag is reported where it was opened', () => {
  const found = check(good('one\n<!--tephra:tag-start house-->two\nthree\n'))
  assert.equal(found.length, 1)
  assert.equal(found[0]?.kind, 'unterminated-tag')
  assert.equal(found[0]?.subject, 'house')
  assert.equal(found[0]?.line, 7, 'file line, not body line')
})

test('a tag end with no start is reported, and is the case resolveTags drops', () => {
  // `resolveTags` discards this one entirely — it is invisible in its output by
  // design — which is exactly why the detector re-runs the alternation instead
  // of reading the resolved list.
  const found = check(good('one\n<!--tephra:tag-end house-->two\n'))
  assert.equal(found.length, 1)
  assert.equal(found[0]?.kind, 'orphan-tag-end')
  assert.equal(found[0]?.subject, 'house')
})

test('a matched pair reports nothing', () => {
  const found = check(
    good('<!--tephra:tag-start house-->inside<!--tephra:tag-end house--> after\n'),
  )
  assert.deepEqual(found, [])
})

test('a repeated bookmark is reported at the SECOND one', () => {
  // The first is the one that resolves, so the later one is the surprise and
  // the place a repair would happen.
  const found = check(good('<!--tephra:mark idea-->one\ntwo\n<!--tephra:mark idea-->three\n'))
  assert.equal(found.length, 1)
  assert.equal(found[0]?.kind, 'duplicate-anchor')
  assert.equal(found[0]?.line, 8)
})

test('frontmatter that cannot be round-tripped is reported, not repaired', () => {
  const found = check(`---\ndate: ${DAY}\nnested:\n  - a list\n  - of things\n---\nbody\n`)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.kind, 'unparseable-frontmatter')
})

test('a file with no frontmatter at all is reported', () => {
  const found = check('Just a body, no block.\n')
  assert.equal(found.length, 1)
  assert.equal(found[0]?.kind, 'missing-frontmatter')
})

test('a frontmatter date that disagrees with the filename names the declared date', () => {
  // Frontmatter wins (format-spec), so the useful thing to say is what it says.
  const found = check(`---\ndate: 2026-03-20\n---\nbody\n`, DAY)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.kind, 'date-mismatch')
  assert.equal(found[0]?.subject, '2026-03-20')
})

test('markers inside a fenced code block are not anomalies', () => {
  // This is a physics notebook; it will contain code, and code about Tephra
  // will contain Tephra markers. `scanMarkers` is fence-aware, and the detector
  // inherits that by working from its output rather than from a regex.
  const found = check(
    good('```\n<!--tephra:tag-start house-->\n<!--tephra:mark idea-->\n<!--tephra:mark idea-->\n```\n'),
  )
  assert.deepEqual(found, [], 'code is content, not markup')
})

test('several anomalies in one file come back in file order', () => {
  const found = check(
    good('<!--tephra:tag-end a-->x\n<!--tephra:mark m-->y\n<!--tephra:mark m-->z\n<!--tephra:tag-start b-->w\n'),
  )
  assert.deepEqual(
    found.map(a => a.kind),
    ['orphan-tag-end', 'duplicate-anchor', 'unterminated-tag'],
  )
  const lines = found.map(a => a.line ?? 0)
  assert.deepEqual([...lines].sort((a, b) => a - b), lines, 'sorted by line')
})
