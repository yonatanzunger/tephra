// Link destinations, checked against the parser that will read them back.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { destination } from '../../src/renderer/src/editor/kinds/markdown/links.ts'
import { parser, GFM } from '@lezer/markdown'

const md = parser.configure(GFM)

/** The URL a real parse yields, so the test cannot disagree with the editor. */
function parsed(markdown: string): string | null {
  const tree = md.parse(markdown)
  let url: string | null = null
  tree.iterate({
    enter: node => {
      if (node.name === 'URL') url = markdown.slice(node.from, node.to)
    },
  })
  return url
}

test('an ordinary URL is written plainly', () => {
  assert.equal(destination('https://example.com/kca-1978'), 'https://example.com/kca-1978')
})

test('a relative notebook path is left alone', () => {
  assert.equal(destination('../../../notes/titration-curves.md'), '../../../notes/titration-curves.md')
})

test('THE POINT: a destination survives the round trip through the parser', () => {
  // Each of these would end the link early if written bare, leaving the rest of
  // the URL as prose beside a broken link.
  for (const url of [
    'https://example.com/kca-1978',
    'https://en.wikipedia.org/wiki/Hold-up_problem_(economics)',
    'file:///Users/somebody/a folder/with spaces.pdf',
    '../notes/a file with spaces.md',
  ]) {
    const markdown = `[the source](${destination(url)})`
    const back = parsed(markdown)
    assert.notEqual(back, null, `no link parsed from ${markdown}`)
    assert.equal(
      (back as string).replace(/^<|>$/g, ''),
      url,
      `destination did not survive: ${markdown}`,
    )
  }
})

test('empty is empty rather than a pair of brackets', () => {
  assert.equal(destination('   '), '')
})
