// Rich clipboard content converted to markdown.
//
// **The important test is the round trip**, not the output shape. What matters
// is that converted markdown, read back by the SAME parser the editor uses,
// yields the text that was on the clipboard — because the way this fails in
// practice is an unescaped `*` or `#` in imported prose quietly becoming markup,
// which nobody notices until the passage is unrecoverable in place. (It is
// recoverable from `attachments/`, which is why the rule exists — but a corpus
// you have to go to the attic to trust is not the one this is for.)

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const globals = globalThis as unknown as Record<string, unknown>
globals['DOMParser'] = dom.window.DOMParser
globals['document'] = dom.window.document
globals['Node'] = dom.window.Node

const { markdownFromHtml } = await import('../../src/renderer/src/import/html.ts')
const { parser, GFM } = await import('@lezer/markdown')
const md = parser.configure(GFM)

/** The words a reader sees, with every construct's delimiters removed. */
function visible(markdown: string): string {
  const tree = md.parse(markdown)
  const out: string[] = []
  let cursor = 0
  tree.iterate({
    enter: node => {
      // An escape is a backslash and the character it protects; what a reader
      // sees is the character. Missing this made the test accuse the converter
      // of corrupting text it was in fact escaping correctly.
      if (node.name === 'Escape') {
        out.push(markdown.slice(cursor, node.from), markdown.slice(node.from + 1, node.to))
        cursor = node.to
        return false
      }
      if (node.name.endsWith('Mark') || node.name === 'URL' || node.name === 'CodeInfo') {
        out.push(markdown.slice(cursor, node.from))
        cursor = node.to
      }
      return true
    },
  })
  out.push(markdown.slice(cursor))
  return out.join('').replace(/\s+/g, ' ').trim()
}

test('structure survives: headings, lists, emphasis, links', () => {
  const html =
    '<h2>The Shock Limit</h2><p>A <b>bold</b> and <i>slanted</i> claim, ' +
    'with <a href="https://example.com/x">a source</a>.</p><ul><li>One</li><li>Two</li></ul>'
  const out = markdownFromHtml(html) as string
  assert.match(out, /^## The Shock Limit/)
  assert.match(out, /\*\*bold\*\*/)
  assert.match(out, /\*slanted\*/)
  assert.match(out, /\[a source\]\(https:\/\/example\.com\/x\)/)
  assert.match(out, /- One\n- Two/)
})

test('a table arrives as a table, not as a paragraph', () => {
  const html =
    '<table><thead><tr><th>regime</th><th>absorbs</th></tr></thead>' +
    '<tbody><tr><td>thin</td><td>little</td></tr></tbody></table>'
  const out = markdownFromHtml(html) as string
  assert.match(out, /\| regime \| absorbs \|/)
  assert.match(out, /\| thin \| little \|/)
})

test('THE ROUND TRIP: characters that mean something in markdown are escaped', () => {
  // Every one of these is a way for imported prose to silently become markup.
  const cases = [
    'A 5 * 3 = 15 calculation and a _file_name_ here.',
    '# Not a heading, just a hash',
    'A [bracketed] thing and a `backtick` and a 100% rate',
    '> Not a quotation, merely an arrow',
    '- Not a list, a dash at the start',
    'Ampersands & angle brackets < like this >',
    '1986. A year that starts a line, not an ordered list.',
  ]
  for (const source of cases) {
    const html = `<p>${source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
    const markdown = markdownFromHtml(html) as string
    assert.equal(
      visible(markdown),
      source.replace(/\s+/g, ' ').trim(),
      `round trip lost or changed text.\n  source:   ${source}\n  markdown: ${markdown}`,
    )
  }
})

test('Word and Google Docs wrappers are discarded, not converted', () => {
  const html =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office">' +
    '<head><style>p { mso-thing: 1 }</style><meta name="Generator" content="Word"></head>' +
    '<body><!--[if gte mso 9]><xml><o:DocumentProperties/></xml><![endif]-->' +
    '<p class="MsoNormal">The actual sentence.<o:p></o:p></p></body></html>'
  const out = markdownFromHtml(html) as string
  assert.equal(out, 'The actual sentence.')
  assert.equal(out.includes('mso'), false)
})

test('markup that amounts to no text says so', () => {
  assert.equal(markdownFromHtml('<div><span></span></div>'), null)
  assert.equal(markdownFromHtml(''), null)
  // …but markup whose content is not text is still content.
  assert.notEqual(markdownFromHtml('<p><img src="a.png" alt="A plot"></p>'), null)
})

test("a fragment's own comments do not become Tephra's", () => {
  const out = markdownFromHtml('<p>Before<!-- a stray comment -->after.</p>') as string
  assert.equal(out.includes('<!--'), false)
  assert.match(out, /Beforeafter\./)
})
