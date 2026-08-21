import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFile, spliceBody, renderFrontmatter, frontmatterFor } from '../../../../src/main/x/frontmatter.ts'
import type { DateKey } from '../../../../src/shared/document-api.ts'

const d = (s: string): DateKey => s as DateKey
const FILE = `---
tephra: 1
date: 2026-03-14
kind: stream
---

First paragraph.
`

test('parses the keys the format defines', () => {
  const p = parseFile(FILE)
  assert.equal(p.unparseable, false)
  assert.equal(p.frontmatter?.tephra, 1)
  assert.equal(p.frontmatter?.date, '2026-03-14')
  assert.equal(p.frontmatter?.kind, 'stream')
  assert.equal(p.body, '\nFirst paragraph.\n')
})

test('a file with no frontmatter is all body', () => {
  const p = parseFile('just prose\n')
  assert.equal(p.frontmatter, null)
  assert.equal(p.unparseable, false)
  assert.equal(p.body, 'just prose\n')
  assert.equal(p.blockEnd, 0)
})

test('an opening --- with no closer is a horizontal rule, not frontmatter', () => {
  // Treating the whole file as an unterminated block would hide all its content.
  const text = '---\nnot really frontmatter\n'
  const p = parseFile(text)
  assert.equal(p.frontmatter, null)
  assert.equal(p.body, text)
})

test('unknown keys survive verbatim, in order', () => {
  const text = '---\ntephra: 1\nauthor: someone\nmood: "pensive"\ndate: 2026-03-14\n---\nbody\n'
  const p = parseFile(text)
  assert.deepEqual(p.frontmatter?.extra, [['author', 'someone'], ['mood', '"pensive"']])
  const rendered = renderFrontmatter(p.frontmatter!)
  assert.ok(rendered.includes('author: someone'))
  assert.ok(rendered.includes('mood: "pensive"'), 'quoting is preserved as typed')
})

test('malformed frontmatter is unparseable, and that is a prohibition', () => {
  // The file must then never be rewritten. Overwriting what you could not read
  // is how hand-edited content disappears.
  const text = '---\nnested:\n  - a list we cannot round-trip\n---\nbody\n'
  const p = parseFile(text)
  assert.equal(p.unparseable, true)
  assert.equal(p.frontmatter, null)
  assert.equal(p.body, 'body\n', 'the body is still readable')
})

test('an invalid date is dropped rather than trusted', () => {
  const p = parseFile('---\ndate: 2026-02-30\n---\nx\n')
  assert.equal(p.frontmatter?.date, null)
  assert.equal(p.unparseable, false)
})

test('splicing preserves the frontmatter block byte for byte', () => {
  // Typing changes no metadata, so the bytes above the body are not merely
  // reproduced — they are never touched.
  const odd = '---\ntephra:    1\ndate: 2026-03-14\n#  a comment\nweird:key-ish\n---\nold body\n'
  const p = parseFile(odd)
  const out = spliceBody(odd, p, 'new body\n')
  assert.equal(out, '---\ntephra:    1\ndate: 2026-03-14\n#  a comment\nweird:key-ish\n---\nnew body\n')
  assert.ok(out.startsWith(odd.slice(0, p.blockEnd)), 'prefix is identical')
})

test('CRLF frontmatter parses and splices', () => {
  const crlf = '---\r\ntephra: 1\r\ndate: 2026-03-14\r\n---\r\nbody\r\n'
  const p = parseFile(crlf)
  assert.equal(p.frontmatter?.date, '2026-03-14')
  assert.equal(p.body, 'body\r\n')
  assert.equal(spliceBody(crlf, p, 'x'), '---\r\ntephra: 1\r\ndate: 2026-03-14\r\n---\r\nx')
})

test('a rendered block parses back to the same values', () => {
  const fm = frontmatterFor(d('2026-03-14'), 'stream')
  const p = parseFile(renderFrontmatter(fm) + 'body\n')
  assert.equal(p.frontmatter?.date, '2026-03-14')
  assert.equal(p.frontmatter?.kind, 'stream')
  assert.equal(p.frontmatter?.part, null, 'part 1 is not written')
  assert.equal(p.body, 'body\n')
})
