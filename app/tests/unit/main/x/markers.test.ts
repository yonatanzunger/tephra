import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanMarkers, resolveTags, resolveAnchors, subjectKey, codeRegions } from '../../../../src/main/x/markers.ts'

const names = (body: string, kind?: string) =>
  scanMarkers(body).filter(m => kind === undefined || m.kind === kind).map(m => m.name)

test('finds anchors, tags and headings in order', () => {
  const body = [
    '# Title',
    'Prose with <!--tephra:mark titration idea--> an anchor.',
    '<!--tephra:tag-start house deal-->tagged<!--tephra:tag-end house deal-->',
    '## Later',
  ].join('\n')
  assert.deepEqual(scanMarkers(body).map(m => `${m.kind}:${m.name}`), [
    'heading:Title',
    'anchor:titration idea',
    'tag-start:house deal',
    'tag-end:house deal',
    'heading:Later',
  ])
})

test('markers inside a fenced code block are text, not markup', () => {
  // The failure this prevents is specific and inevitable: this is a physics
  // notebook, it will contain fenced code, and code *about* Tephra contains
  // Tephra markers. A regex scan corrupts the document's idea of itself.
  const body = [
    'Real: <!--tephra:mark real-->',
    '```markdown',
    'Example: <!--tephra:mark not-real-->',
    '<!--tephra:tag-start not-real-either-->',
    '```',
    'Also real: <!--tephra:mark second-->',
  ].join('\n')
  assert.deepEqual(names(body, 'anchor'), ['real', 'second'])
  assert.deepEqual(names(body, 'tag-start'), [])
})

test('headings inside a fence are not headings', () => {
  const body = ['# Real', '```', '# Not a heading', '```', '## Also real'].join('\n')
  assert.deepEqual(names(body, 'heading'), ['Real', 'Also real'])
})

test('tilde fences work, and a fence closes only on its own character', () => {
  const body = ['~~~', '<!--tephra:mark hidden-->', '```', 'still inside', '~~~', '<!--tephra:mark visible-->'].join('\n')
  assert.deepEqual(names(body, 'anchor'), ['visible'])
})

test('a longer fence is needed to close a longer fence', () => {
  const body = ['````', '```', '<!--tephra:mark hidden-->', '````', '<!--tephra:mark visible-->'].join('\n')
  assert.deepEqual(names(body, 'anchor'), ['visible'])
})

test('an unterminated fence swallows the rest, deliberately', () => {
  // Better to under-report markers than to interpret code as markup.
  const body = ['ok <!--tephra:mark before-->', '```', '<!--tephra:mark after-->'].join('\n')
  assert.deepEqual(names(body, 'anchor'), ['before'])
})

test('inline code spans hide markers too', () => {
  const body = 'Write `<!--tephra:mark example-->` to bookmark, then <!--tephra:mark actual--> here.'
  assert.deepEqual(names(body, 'anchor'), ['actual'])
})

test('indented code blocks hide markers', () => {
  const body = ['Prose.', '', '    <!--tephra:mark indented-->', '', '<!--tephra:mark plain-->'].join('\n')
  assert.deepEqual(names(body, 'anchor'), ['plain'])
})

test('code regions are reported for the whole fenced block', () => {
  const body = 'a\n```\nb\n```\nc\n'
  const regions = codeRegions(body)
  assert.ok(regions.length >= 1)
  const [start, end] = regions[0]!
  assert.equal(body.slice(start, end), '```\nb\n```\n')
})

test('tags pair into spans over the text between them', () => {
  const body = 'before <!--tephra:tag-start house deal-->middle<!--tephra:tag-end house deal--> after'
  const tags = resolveTags(scanMarkers(body), body.length)
  assert.equal(tags.length, 1)
  assert.equal(tags[0]!.name, 'house deal')
  assert.equal(body.slice(tags[0]!.from, tags[0]!.to), 'middle')
  assert.equal(tags[0]!.unterminated, false)
})

test('overlapping tags of different subjects are expressible', () => {
  // The whole reason for paired point markers: nested delimiters cannot express
  // a tag over 3–8 crossing one over 6–12. Four independent points can.
  const body =
    '<!--tephra:tag-start alpha-->one <!--tephra:tag-start beta-->two<!--tephra:tag-end alpha--> three<!--tephra:tag-end beta-->'
  const tags = resolveTags(scanMarkers(body), body.length)
  assert.deepEqual(tags.map(t => t.name).sort(), ['alpha', 'beta'])
  const alpha = tags.find(t => t.name === 'alpha')!
  const beta = tags.find(t => t.name === 'beta')!
  assert.ok(alpha.from < beta.from && alpha.to < beta.to && beta.from < alpha.to, 'genuinely crossing')
})

test('an unterminated tag stops at the segment end, not the document end', () => {
  // Bounded blast radius, per the degradation table.
  const body = 'x <!--tephra:tag-start orphan-->rest of the day'
  const tags = resolveTags(scanMarkers(body), body.length)
  assert.equal(tags.length, 1)
  assert.equal(tags[0]!.unterminated, true)
  assert.equal(tags[0]!.to, body.length)
})

test('a tag-end with no start is ignored', () => {
  const body = 'x <!--tephra:tag-end nobody--> y'
  assert.deepEqual(resolveTags(scanMarkers(body), body.length), [])
})

test('a duplicate anchor name resolves to the first', () => {
  const body = 'a <!--tephra:mark dup--> b <!--tephra:mark dup--> c'
  const anchors = resolveAnchors(scanMarkers(body))
  assert.equal(anchors.size, 1)
  assert.equal(anchors.get('dup')!.from, body.indexOf('<!--'))
})

test('subjects compare loosely but are stored as typed', () => {
  assert.equal(subjectKey('House  Deal'), subjectKey('house deal'))
  const body = '<!--tephra:tag-start House Deal-->x<!--tephra:tag-end house deal-->'
  const tags = resolveTags(scanMarkers(body), body.length)
  assert.equal(tags.length, 1, 'paired despite differing case')
  assert.equal(tags[0]!.name, 'House Deal', 'the capitalisation the user typed survives')
})
