// Reading and writing comment threads (D47).
//
// The byline is one representation of every fact about a message — what a
// person reads IS what this parses — so these tests are mostly about that line
// being read the way it looks.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseByline, renderBlock, scanThreadBlocks, threadsIn } from '../../../../src/main/x/comments.ts'
import type { CommentId, CommentMessage } from '../../../../src/shared/comments.ts'
import type { DocumentText } from '../../../../src/shared/document-api.ts'
import { rt } from '../../../support/text.ts'

const day = (body: string): DocumentText => rt(body)

test('a byline is read the way it reads', () => {
  const b = parseByline('**Yonatan** 2026-08-23T14:02')
  assert.equal(b.author, 'Yonatan')
  assert.equal(b.at, '2026-08-23T14:02')
  assert.equal(b.assignee, null)
  assert.equal(b.resolved, false)
  assert.deepEqual(b.reactions, {})
})

test('assignee, resolution and reactions', () => {
  const b = parseByline('**Yonatan** 2026-08-23T14:02 → **Rivka** 👍@yonatan 🎉@yonatan,rivka resolved')
  assert.equal(b.assignee, 'Rivka')
  assert.equal(b.resolved, true)
  assert.deepEqual(b.reactions, { '👍': ['yonatan'], '🎉': ['yonatan', 'rivka'] })
})

test('reaction order is the order of first use, and is preserved', () => {
  // People spell things with emoji: three in a row are a sentence, not a set.
  const b = parseByline('**Y** 2026-08-23T14:02 🎉@y 👀@y 👍@y')
  assert.deepEqual(Object.keys(b.reactions), ['🎉', '👀', '👍'])
})

test('an emoji seen twice extends its list rather than moving to the end', () => {
  const b = parseByline('**Y** 2026-08-23T14:02 👍@a 🎉@b 👍@c')
  assert.deepEqual(Object.keys(b.reactions), ['👍', '🎉'])
  assert.deepEqual(b.reactions['👍'], ['a', 'c'])
})

test('compound emoji survive, because only the first code point is tested', () => {
  const b = parseByline('**Y** 2026-08-23T14:02 👍🏽@a 👩‍🔬@b')
  assert.deepEqual(Object.keys(b.reactions), ['👍🏽', '👩‍🔬'])
})

test('a token this version does not understand is kept, not dropped', () => {
  const b = parseByline('**Y** 2026-08-23T14:02 priority=high 👍@a')
  assert.deepEqual(b.unknown, ['priority=high'])
  assert.deepEqual(Object.keys(b.reactions), ['👍'])
})

test('a block is found, and carries the blank line after it', () => {
  const body = day('A passage.\n\n> **Y** 2026-08-23T14:02 <!--tephra:comment k3f9-->\n> A note.\n\nAfter.\n')
  const blocks = scanThreadBlocks(body)
  assert.equal(blocks.length, 1)
  const block = blocks[0]!
  assert.equal(block.id, 'k3f9')
  assert.equal(block.message.body, 'A note.')
  // Elision takes the blank line too: leaving it would turn one paragraph break
  // into two.
  assert.equal(body.slice(block.from, block.to).endsWith('\n\n'), true)
  assert.equal(body.slice(0, block.from) + body.slice(block.to), 'A passage.\n\nAfter.\n')
})

test('a multi-line body keeps its shape', () => {
  const body = day('> **Y** 2026-08-23T14:02 <!--tephra:comment a1-->\n> One line.\n>\n> And another.\n')
  assert.equal(scanThreadBlocks(body)[0]!.message.body, 'One line.\n\nAnd another.')
})

test('several blocks with one id are one thread, in document order', () => {
  const body = day(
    '> **Y** 2026-08-23T14:02 <!--tephra:comment k3f9-->\n> First.\n\n' +
      '> **R** 2026-08-25T09:10 <!--tephra:comment k3f9-->\n> Second.\n\n' +
      '> **Y** 2026-08-26T11:00 <!--tephra:comment zz-->\n> Other thread.\n',
  )
  const threads = threadsIn(body)
  assert.equal(threads.length, 2)
  assert.deepEqual(threads[0]!.messages.map(m => m.body), ['First.', 'Second.'])
  assert.deepEqual(threads[0]!.messages.map(m => m.author), ['Y', 'R'])
})

test('thread state comes from the first block and is not repeated', () => {
  const body = day(
    '> **Y** 2026-08-23T14:02 → **R** resolved <!--tephra:comment k-->\n> First.\n\n' +
      '> **Y** 2026-08-25T09:10 <!--tephra:comment k-->\n> Second.\n',
  )
  const thread = threadsIn(body)[0]!
  assert.equal(thread.resolved, true)
  assert.equal(thread.assignee, 'R')
})

test('a comment block inside a code fence is text, not a thread', () => {
  // This is a notebook about building Tephra; it will contain Tephra's syntax.
  const body = day('```\n> **Y** 2026-08-23T14:02 <!--tephra:comment k-->\n> Not a comment.\n```\n')
  assert.deepEqual(threadsIn(body), [])
})

test('a marker in the middle of a quotation is not a byline', () => {
  const body = day('> Someone else wrote this,\n> and <!--tephra:comment k--> is in it.\n')
  assert.deepEqual(threadsIn(body), [])
})

test('an ordinary blockquote is left entirely alone', () => {
  assert.deepEqual(threadsIn(rt('> Just a quotation.\n')), [])
})

test('what is written can be read back', () => {
  const message: CommentMessage = {
    author: 'Yonatan',
    at: '2026-08-23T14:02',
    body: 'The argument assumes premise 2.\n\nOn reflection, it is the interesting part.',
    reactions: { '👍': ['yonatan'], '🎉': ['yonatan', 'rivka'] },
    unknown: ['priority=high'],
  }
  const text = renderBlock('k3f9' as CommentId, message, { resolved: true, assignee: 'Rivka' })
  const back = scanThreadBlocks(rt(`${text}\n`))[0]!
  assert.deepEqual(back.message, message)
  assert.equal(back.resolved, true)
  assert.equal(back.assignee, 'Rivka')
  assert.equal(back.id, 'k3f9')
})

test('the identifier never begins a line, so the byline keeps its formatting', () => {
  const text = renderBlock('k' as CommentId, {
    author: 'Y', at: '2026-08-23T14:02', body: 'x', reactions: {}, unknown: [],
  })
  const first = text.split('\n')[0] as string
  assert.equal(first.startsWith('> <!--'), false)
  assert.match(first, /<!--tephra:comment k-->$/)
})
