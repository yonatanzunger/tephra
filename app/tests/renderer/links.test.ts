// Link destinations, checked against the parser that will read them back.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { destination, scanLinks } from '../../src/shared/links.ts'
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

test('AND THE SCANNER AGREES WITH LEZER, which is the pair that used to differ', () => {
  // The bug this pair exists to prevent: `destination` wrote a form the app's
  // own reader could not read. Checking the writer against the real markdown
  // grammar proves it is legal; checking it against `scanLinks` proves the app
  // can read what it wrote. Neither alone would have caught it (ML1, D61).
  for (const url of [
    'https://example.com/kca-1978',
    'https://en.wikipedia.org/wiki/Hold-up_problem_(economics)',
    '../notes/a file with spaces.md',
  ]) {
    const markdown = `[the source](${destination(url)})`
    const found = scanLinks(markdown)
    assert.equal(found.length, 1, `scanLinks found no link in ${markdown}`)
    assert.equal(found[0]?.target, url, `the scanner disagreed with the writer: ${markdown}`)
    assert.notEqual(parsed(markdown), null, `lezer disagreed with the writer: ${markdown}`)
  }
})

test('empty is empty rather than a pair of brackets', () => {
  assert.equal(destination('   '), '')
})
