// Assembling a run of days for paper.
//
// The date labels are the whole subject here: they are added by the printer,
// so they must not be able to pass through the markdown parser and compete with
// the headings someone actually wrote.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { printRangePage, rangeTitle, readable } from '../../src/renderer/src/print/page.ts'
import type { DayProse } from '../../src/shared/ipc.ts'
import type { DateKey } from '../../src/shared/document-api.ts'

const day = (date: string, text: string): DayProse => ({ date: date as DateKey, text })

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
