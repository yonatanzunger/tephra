// Markdown to HTML for paper.
//
// Asserted against the same parser the editor uses, which is the point: paper
// and screen cannot disagree about what is bold, because only one thing decides.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { toHtml } from '../../src/renderer/src/print/markdown.ts'
import { HANDLE } from '../../src/shared/document-api.ts'

test('prose, emphasis and code', () => {
  const html = toHtml('A **bold** and *slanted* and `literal` sentence.\n')
  assert.equal(html, '<p>A <strong>bold</strong> and <em>slanted</em> and <code>literal</code> sentence.</p>')
})

test('headings keep their level and lose their hashes', () => {
  assert.equal(toHtml('## The Shock Limit\n'), '<h2>The Shock Limit</h2>')
  assert.equal(toHtml('# One\n\n### Three\n'), '<h1>One</h1>\n<h3>Three</h3>')
})

test('a hard-wrapped paragraph is one paragraph', () => {
  const html = toHtml('A thought that runs\nacross two lines.\n')
  assert.equal(html, '<p>A thought that runs\nacross two lines.</p>')
})

test('lists, quotes and rules', () => {
  assert.equal(toHtml('- one\n- two\n'), '<ul><li>one</li>\n<li>two</li></ul>')
  assert.equal(toHtml('1. first\n2. second\n'), '<ol><li>first</li>\n<li>second</li></ol>')
  assert.match(toHtml('> quoted thought\n'), /<blockquote>\s*<p>quoted thought<\/p><\/blockquote>/)
  assert.equal(toHtml('---\n'), '<hr>')
})

test('tables become tables', () => {
  const html = toHtml('| a | b |\n|---|---|\n| 1 | 2 |\n')
  assert.match(html, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead>/)
  assert.match(html, /<tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/)
})

test('fenced code keeps its text and escapes it', () => {
  assert.equal(toHtml('```js\nif (a < b) x()\n```\n'), '<pre><code>if (a &lt; b) x()</code></pre>')
})

test('links and images carry their targets', () => {
  assert.equal(
    toHtml('See [the note](../../../notes/x.md).\n'),
    '<p>See <a href="../../../notes/x.md">the note</a>.</p>',
  )
  assert.match(toHtml('![Titration](../a.png)\n'), /<img src="\.\.\/a\.png" alt="Titration">/)
})

test('math renders rather than printing as dollars', () => {
  const inline = toHtml('The value $S(\\tau)$ matters.\n')
  assert.match(inline, /class="katex"/)
  assert.equal(inline.includes('$'), false, 'the delimiters should not reach paper')

  const display = toHtml('$$\\int_0^1 x\\,dx$$\n')
  assert.match(display, /katex-display|class="katex"/)
  assert.equal(display.startsWith('<p>'), false, 'a display equation is a block, not a paragraph')
})

test("Tephra's own apparatus does not print", () => {
  // Markers are not text (D44), and on paper they are not anything: the passage
  // is what was written. A handle in the buffer must not become a character.
  const html = toHtml(`A ${HANDLE}tagged passage.\n`)
  assert.equal(html, '<p>A tagged passage.</p>')
  assert.equal(toHtml('Before <!--tephra:mark x--> after.\n'), '<p>Before  after.</p>')
})

test('a document cannot smuggle markup onto the page', () => {
  // The text is prose someone wrote, not a template. Passing its HTML through
  // would put whatever it contains into the print document with our styling
  // wrapped around it.
  const html = toHtml('A <script>alert(1)</script> and <b>bold</b> attempt.\n')
  assert.equal(html.includes('<script>'), false, 'nothing may execute')
  assert.equal(html.includes('<b>'), false, 'and nothing may restyle the page')
  // Shown as the text it is. Dropping the tags and keeping what was between
  // them would silently alter what the person wrote, which is worse than either
  // rendering it or refusing it.
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/)
})

test('a heading needs its hashes, which is why print takes whole lines', () => {
  // The bug: the editor conceals `## ` and the concealment is atomic, so a
  // selection starting at the first visible character of a heading starts after
  // them. What reached the renderer was the words alone.
  assert.equal(toHtml('The Shock Limit\n\nProse.\n'), '<p>The Shock Limit</p>\n<p>Prose.</p>')
  assert.equal(toHtml('## The Shock Limit\n\nProse.\n'), '<h2>The Shock Limit</h2>\n<p>Prose.</p>')
})

test('the other block marks fail the same way, and are fixed by the same rule', () => {
  assert.equal(toHtml('one\ntwo\n'), '<p>one\ntwo</p>', 'without the marks, a list is a paragraph')
  assert.equal(toHtml('- one\n- two\n'), '<ul><li>one</li>\n<li>two</li></ul>')
  assert.match(toHtml('> quoted\n'), /<blockquote>/)
  assert.match(toHtml('| a |\n|---|\n| 1 |\n'), /<table>/)
})
