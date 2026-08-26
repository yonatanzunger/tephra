// Assembling a run of days for paper.
//
// The date labels are the whole subject here: they are added by the printer,
// so they must not be able to pass through the markdown parser and compete with
// the headings someone actually wrote.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  printRangePage, PAPER_INLINE_TAGS, PAPER_MARGIN, PAPER_NOTES, rangeTitle, readable,
} from '../../src/renderer/src/print/page.ts'
import type { DayProse } from '../../src/shared/ipc.ts'
import type { DateKey, ProseOffset, ProseText } from '../../src/shared/document-api.ts'
import type { Annotation } from '../../src/shared/prose.ts'
import type { CommentThread, CommentId } from '../../src/shared/comments.ts'

const at = (from: number, to: number): { from: ProseOffset; to: ProseOffset } =>
  ({ from: from as ProseOffset, to: to as ProseOffset })

const day = (
  date: string,
  text: string,
  annotations: readonly Annotation<ProseOffset>[] = [],
): DayProse => ({
  date: date as DateKey,
  prose: {
    text: text as ProseText,
    annotations: [{ kind: 'date', at: at(0, text.length), date }, ...annotations],
  },
})

const thread = (id: string, author: string, body: string): CommentThread => ({
  id: id as CommentId,
  resolved: false,
  assignee: null,
  messages: [{ author, at: '2026-03-01T10:00', body, reactions: {}, unknown: [] }],
})

// Dates are formatted in the reader's locale, so these assert what is IN the
// label rather than the order the label puts it in.
test('each day is a section under its own date', () => {
  const { html } = printRangePage([day('2026-03-01', 'One.\n'), day('2026-03-02', 'Two.\n')], 'x')
  assert.equal((html.match(/<section class="day">/g) ?? []).length, 2)
  assert.match(html, /<h2 class="date">[^<]*March[^<]*<\/h2>/)
  assert.match(html, /<h2 class="date">[^<]*Sunday[^<]*<\/h2>/, 'the weekday, which is the point of a journal')
  assert.match(html, /<p>One\.<\/p>/)
})

test("a day's own headings are still its own", () => {
  // The label is an element, not `## 1 March` put through the parser — so a
  // heading in the text keeps its level and its meaning relative to the label.
  const { html } = printRangePage([day('2026-03-01', '## A real heading\n\nText.\n')], 'x')
  assert.match(html, /<h2 class="date">/)
  assert.match(html, /<h2[^>]*>A real heading<\/h2>/)
  assert.doesNotMatch(html, /<h2 class="date">A real heading/)
})

test('the year appears when the range crosses one, and not otherwise', () => {
  const within = printRangePage([day('2026-03-01', 'a\n'), day('2026-03-02', 'b\n')], 'x').html
  assert.doesNotMatch(within, /2026/, 'one year, so saying it twice a page is noise')
  const across = printRangePage([day('2025-12-31', 'a\n'), day('2026-01-01', 'b\n')], 'x').html
  assert.match(across, /2025/)
  assert.match(across, /2026/)
})

test('the title says what is on the pages, not what was asked for', () => {
  assert.equal(rangeTitle([day('2026-03-01', 'a')]), readable('2026-03-01', false))
  assert.equal(
    rangeTitle([day('2026-03-01', 'a'), day('2026-03-04', 'b')]),
    `${readable('2026-03-01', true)} – ${readable('2026-03-04', false)}`,
  )
})

// ── the policy, which is the point of D50 ───────────────────────────────────

test('clean is clean: an annotated day prints as the words alone', () => {
  const { html } = printRangePage(
    [day('2026-03-01', 'A tagged phrase here.\n', [
      { kind: 'tag', at: at(2, 15), subject: 'Subject' },
      { kind: 'comment', at: at(2, 15), thread: thread('k1', 'Y', 'A remark.') },
    ])],
    'x',
  )
  assert.doesNotMatch(html, /Subject/)
  assert.doesNotMatch(html, /A remark/)
  assert.doesNotMatch(html, /class="notes"/)
})

test('the same day, one policy later, closes with its notes', () => {
  const { html } = printRangePage(
    [day('2026-03-01', 'A tagged phrase here.\n', [
      { kind: 'tag', at: at(2, 15), subject: 'Subject' },
      { kind: 'comment', at: at(2, 15), thread: thread('k1', 'Yonatan', 'A remark.') },
    ])],
    'x',
    PAPER_NOTES,
  )
  assert.match(html, /class="notes"/)
  assert.match(html, /<q>tagged phrase<\/q>/, 'a note quotes what it is about')
  assert.match(html, /<b>Yonatan<\/b>/)
  assert.match(html, /A remark\./)
  // The tag is not a note: this policy says comments close the day and tags are
  // absent, and a renderer that drew both would be ignoring the policy.
  assert.doesNotMatch(html, /Subject/)
})

test('notes are numbered in reading order, not in the order they were found', () => {
  const { html } = printRangePage(
    [day('2026-03-01', 'One two three four five six seven.\n', [
      { kind: 'comment', at: at(20, 24), thread: thread('late', 'Y', 'Later.') },
      { kind: 'comment', at: at(0, 3), thread: thread('early', 'Y', 'Earlier.') },
    ])],
    'x',
    PAPER_NOTES,
  )
  const first = html.indexOf('Earlier.')
  const second = html.indexOf('Later.')
  assert.ok(first > 0 && first < second, 'the note about the first words comes first')
})

// ── the treatments that draw at the text (D50) ──────────────────────────────

test('a tag inline is an underline with its subject named once', () => {
  const { html } = printRangePage(
    [day('2026-03-01', 'A tagged phrase here.\n', [
      { kind: 'tag', at: at(2, 15), subject: 'House Deal' },
    ])],
    'x',
    PAPER_INLINE_TAGS,
  )
  assert.match(html, /<span class="tag"><span class="tag-name">House Deal<\/span>tagged phrase<\/span>/)
})

test('the same tag in the margin puts the subject there instead', () => {
  const { html } = printRangePage(
    [day('2026-03-01', 'A tagged phrase here.\n', [
      { kind: 'tag', at: at(2, 15), subject: 'House Deal' },
    ])],
    'x',
    PAPER_MARGIN,
  )
  assert.match(html, /<span class="margin tag-margin">House Deal<\/span>/)
  assert.doesNotMatch(html, /tag-name/, 'and not in the text as well')
  assert.match(html, /class="has-margin"/, 'the page gives up the room for it')
})

test('a bookmark reaches paper at all, which it did not before', () => {
  const { html } = printRangePage(
    [day('2026-03-01', 'A marked spot here.\n', [{ kind: 'anchor', at: at(2, 2), name: 'the spot' }])],
    'x',
    PAPER_MARGIN,
  )
  assert.match(html, /<span class="margin anchor">✳ the spot<\/span>/)
})

test('a footnote leaves a number where the passage ends', () => {
  const { html } = printRangePage(
    [day('2026-03-01', 'A remarked-on phrase here.\n', [
      { kind: 'comment', at: at(2, 20), thread: thread('k1', 'Y', 'Check this.') },
    ])],
    'x',
    PAPER_NOTES,
  )
  assert.match(html, /<sup class="cue">1<\/sup>/)
  assert.match(html, /class="notes"/, 'and the note itself closes the day')
})

test('a clean print reserves no margin it is not going to use', () => {
  const { html } = printRangePage([day('2026-03-01', 'Nothing annotated.\n')], 'x')
  assert.doesNotMatch(html, /has-margin/)
})
