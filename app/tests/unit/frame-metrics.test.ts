// The frame's width arithmetic (D42, as amended). These are the rules the frame
// studies arrived at by measuring a real browser at fifteen widths; here they
// are checked at widths, and against regressions, a screen cannot produce.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  gutterFits,
  readingNeed,
  streamOcclusion,
  streamWidth,
  STREAM_BOUNDS,
  type ReadingNeed,
} from '../../src/renderer/src/frame/metrics.ts'

// The Aldine case from the frame studies: 54ch measure, 19ch gutter, 3ch gap at
// 19px Hoefler, which measured 611 / 215 / 34 in Chrome, plus 0.3in either side.
const ALDINE: ReadingNeed = { measure: 611, gutter: 215, gap: 34, padding: 58 }
const NAV = 248

test('the reading need is the measure, the gutter, the gap and the breathing room', () => {
  assert.equal(readingNeed(ALDINE), 611 + 34 + 215 + 58)
  assert.equal(readingNeed(ALDINE), 918)
})

test('the stream is available at every width, including ones no laptop has', () => {
  // The rule this replaced refused to open it below about 1440px, which made it
  // unavailable at every width this author's laptop can produce — and a surface
  // meant for typing blindly while reading is most wanted precisely there.
  for (const frame of [600, 900, 1200, 1400, 1512, 1728, 2560, 3840]) {
    assert.ok(streamWidth(frame) >= STREAM_BOUNDS.min, `refused at ${frame}`)
  }
})

test('the stream never grows past its preferred width, nor eats a small window', () => {
  assert.equal(streamWidth(2560), STREAM_BOUNDS.max, 'extra space is slack, not stream')
  assert.equal(streamWidth(1728), STREAM_BOUNDS.max)
  // On a genuinely small window it is bounded by share, not by preference —
  // an overlay taking most of the window would defeat reading underneath it.
  assert.ok(streamWidth(700) < STREAM_BOUNDS.max)
  assert.ok(streamWidth(700) >= STREAM_BOUNDS.min)
})

test('the stream width is monotone in the window width', () => {
  let previous = 0
  for (let frame = 300; frame <= 4000; frame++) {
    const width = streamWidth(frame)
    assert.ok(width >= previous, `narrowed from ${previous} to ${width} at ${frame}`)
    previous = width
  }
})

test('occlusion is zero exactly when the overlay lands on slack', () => {
  // This is what lets one mechanism serve both cases with no mode to switch
  // between: pinned to the right edge, the overlay covers nothing until there
  // is nothing left to cover.
  const wide = NAV + readingNeed(ALDINE) + STREAM_BOUNDS.max
  assert.equal(streamOcclusion(wide, NAV, ALDINE), 0, 'no occlusion when slack suffices')
  assert.equal(streamOcclusion(wide + 500, NAV, ALDINE), 0)

  const tight = NAV + readingNeed(ALDINE)
  assert.equal(
    streamOcclusion(tight, NAV, ALDINE),
    streamWidth(tight),
    'with no slack at all, the whole overlay is covering something',
  )
})

test('occlusion never exceeds the stream itself, and never goes negative', () => {
  for (let frame = 300; frame <= 4000; frame++) {
    const covered = streamOcclusion(frame, NAV, ALDINE)
    assert.ok(covered >= 0, `negative occlusion at ${frame}`)
    assert.ok(
      covered <= streamWidth(frame),
      `covering ${covered} with a ${streamWidth(frame)}px stream at ${frame}`,
    )
  }
})

test('opening the stream changes no width the text depends on', () => {
  // The property the whole frame exists for, expressed at the level the
  // arithmetic can see it: nothing about the measure, the gutter or the nav is
  // a function of the stream. An overlay cannot reflow what is under it.
  const need = readingNeed(ALDINE)
  for (const frame of [900, 1400, 1512, 2000]) {
    assert.equal(readingNeed(ALDINE), need, 'the reading need is stream-independent')
    assert.equal(
      gutterFits(frame, NAV, ALDINE),
      frame - NAV >= need,
      'the fold decision is stream-independent too',
    )
  }
})

test('the gutter folds below the width where it fits, with no unhandled band', () => {
  const need = readingNeed(ALDINE)
  assert.equal(gutterFits(NAV + need, NAV, ALDINE), true, 'fits exactly at the boundary')
  assert.equal(gutterFits(NAV + need - 1, NAV, ALDINE), false)

  // The band that went unhandled in the studies: for 350px of width the layout
  // did not fit and nothing had collapsed. Every width must have an answer.
  for (let frame = 300; frame <= 4000; frame++) {
    const fits = gutterFits(frame, NAV, ALDINE)
    assert.equal(typeof fits, 'boolean')
    if (!fits) {
      assert.ok(
        streamOcclusion(frame, NAV, ALDINE) > 0,
        `frame ${frame}: gutter folded but the overlay reports covering nothing`,
      )
    }
  }
})

test('a dismissed nav still spends its column, which is what Reserved means', () => {
  // Reserved keeps the nav's width whether or not the nav is drawn, so the same
  // navWidth goes in either way and no answer here can change when the nav is
  // toggled. If this ever stops being true, the text moves.
  assert.equal(streamOcclusion(1600, NAV, ALDINE), streamOcclusion(1600, NAV, ALDINE))
  assert.equal(gutterFits(1600, NAV, ALDINE), gutterFits(1600, NAV, ALDINE))
})
