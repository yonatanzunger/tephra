// A heading is its section, not its line (D51).
//
// The rule is CommonMark's own sense of precedence: a section runs until
// something of equal or greater standing interrupts it, or the day ends. Getting
// it wrong is invisible in the file and visible in the sidebar, where a section
// that ends at its own title cannot be highlighted, jumped through, or nested.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Segment } from '../../../../src/main/x/segment.ts'
import type { DateKey } from '../../../../src/shared/document-api.ts'

const DAY = '2026-03-01' as DateKey

/** One day, as the segment sees it after reading a file. */
function day(body: string): Segment {
  return Segment.load(DAY, 'notebook.stream/2026/03/2026-03-01.md' as never, `---\ndate: ${DAY}\n---\n${body}`)
}

/** Each heading as `name: the text it covers`. */
function sections(body: string): string[] {
  const segment = day(body)
  return segment
    .spans()
    .filter(s => s.kind === 'heading')
    .map(s => `${s.name}: ${JSON.stringify(segment.body.slice(s.from, s.to))}`)
}

test('a heading runs to the next one of the same level', () => {
  assert.deepEqual(sections('## One\n\nalpha\n\n## Two\n\nbeta\n'), [
    'One: "## One\\n\\nalpha\\n\\n"',
    'Two: "## Two\\n\\nbeta\\n"',
  ])
})

test('a deeper heading is INSIDE its parent, not after it', () => {
  const found = sections('# Top\n\na\n\n## Under\n\nb\n')
  assert.match(found[0] ?? '', /## Under/, "the parent's range contains the child")
  assert.match(found[1] ?? '', /^Under: "## Under/)
})

test('a shallower heading ends the deeper one', () => {
  const found = sections('## Section\n\na\n\n# Chapter\n\nb\n')
  assert.doesNotMatch(found[0] ?? '', /Chapter/, 'greater precedence interrupts')
})

test('the last section runs to the end of the day, not to the end of its line', () => {
  const found = sections('Preamble.\n\n## Only\n\nand then some more text.\n')
  assert.match(found[0] ?? '', /more text/)
})

test('a heading in a fenced block is not a heading, and does not end a section', () => {
  // The scan is fence-aware for exactly this reason: a notebook about markdown
  // contains markdown, and a `## ` inside a code fence is a line of an example.
  const found = sections('## Real\n\n```\n## Not real\n```\n\nstill in the section\n')
  assert.equal(found.length, 1)
  assert.match(found[0] ?? '', /still in the section/)
})

test('the day still covers everything, whatever the headings do', () => {
  const body = '## One\n\na\n\n## Two\n\nb\n'
  const segment = day(body)
  const date = segment.spans().find(s => s.kind === 'date')
  assert.equal(date?.from, 0)
  assert.equal(date?.to, segment.body.length)
})
