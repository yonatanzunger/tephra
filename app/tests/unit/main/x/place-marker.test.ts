// Where a marker may be written (format-spec).
//
// These assert against the REAL markdown parser, not against a belief about it.
// The rule exists because a comment beginning a paragraph's first line turns
// that whole line into an HTML block — every renderer, not just this editor —
// and the bold vanishes from the file permanently.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parser } from '@lezer/markdown'
import { placeMarker } from '../../../../src/main/x/markers.ts'

const MARK = '<!--tephra:mark m-->'

const apply = (body: string, offset: number): string => {
  const { at, text } = placeMarker(body, offset, MARK)
  return body.slice(0, at) + text + body.slice(at)
}

function shape(src: string): { strong: boolean; paragraphs: number } {
  const names: string[] = []
  parser.parse(src).iterate({
    enter: n => {
      names.push(n.name)
    },
  })
  return {
    strong: names.includes('StrongEmphasis'),
    paragraphs: names.filter(n => n === 'Paragraph').length,
  }
}

test('THE BUG: a marker beginning a paragraph would kill its formatting', () => {
  // The naive placement, shown failing, so the rule below has something to be
  // better than.
  const naive = `${MARK}**Intrinsic S** is a property.`
  assert.equal(shape(naive).strong, false, 'this is what went wrong')
})

test('placed by the rule, the bold survives', () => {
  const body = '**Intrinsic S** is a property.\n'
  const out = apply(body, 0)
  assert.equal(shape(out).strong, true)
  assert.ok(out.includes(MARK))
})

test('a hard-wrapped paragraph is not split', () => {
  // The trap in the obvious fix: giving the marker its own line splits a
  // paragraph in two, which is worse than what it was fixing.
  const body = 'A paragraph hard-wrapped\nacross two lines by hand.\n'
  const at = body.indexOf('across')
  const out = apply(body, at)
  assert.equal(shape(out).paragraphs, 1, 'still one paragraph')
})

test('a marker never begins a line that has content after it', () => {
  const bodies = [
    '**Bold** first.\n',
    'One line.\n**Bold** second.\n',
    'Para one.\n\n**Bold** para two.\n',
    'A\nB\nC\n',
  ]
  for (const body of bodies) {
    for (let offset = 0; offset <= body.length; offset++) {
      const { at, text } = placeMarker(body, offset, MARK)
      const out = body.slice(0, at) + text + body.slice(at)
      for (const line of out.split('\n')) {
        if (!line.startsWith(MARK)) continue
        assert.equal(line, MARK, `marker begins a line with content: ${JSON.stringify(line)}`)
      }
    }
  }
})

test('mid-line placements are left exactly alone', () => {
  const body = 'Some text and more text.\n'
  const at = body.indexOf('and')
  assert.deepEqual(placeMarker(body, at, MARK), { at, text: MARK })
})

test('the prose is never altered, wherever the marker is placed', () => {
  // One exception, and it is deliberate: at the very start of a body there is
  // no previous line to hide behind, so the marker takes its own line and a
  // newline follows it. That adds a line to the file and changes nothing about
  // what the file RENDERS — a comment on its own line before a paragraph
  // produces no output anywhere.
  const body = 'Alpha bravo\ncharlie delta\n\nEcho foxtrot\n'
  for (let offset = 0; offset <= body.length; offset++) {
    const stripped = apply(body, offset).split(MARK).join('')
    const allowed = offset === 0 ? `\n${body}` : body
    assert.equal(stripped, allowed, `offset ${offset} altered the prose`)
  }
})

test('the added newline at offset zero costs nothing in the rendering', () => {
  const body = '**Bold** opens the day.\n'
  const out = apply(body, 0)
  assert.equal(shape(out).strong, true, 'bold survives')
  assert.equal(shape(out).paragraphs, 1, 'and it is still one paragraph')
})
