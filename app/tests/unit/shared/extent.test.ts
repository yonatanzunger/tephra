import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ScreenMetric, screens, charsFor, V1_EXTENT_POLICY } from '../../../src/shared/extent.ts'

test('an uncalibrated metric still gives a usable rate', () => {
  const m = new ScreenMetric()
  assert.ok(!m.calibrated)
  assert.ok(m.charsPerScreen > 0)
  assert.ok(m.toChars(screens(2)) > 0)
})

test('the rate is measured from the viewport, not guessed', () => {
  const m = new ScreenMetric()
  for (let i = 0; i < 40; i++) m.observe(3000)
  assert.ok(Math.abs(m.charsPerScreen - 3000) < 50, `got ${m.charsPerScreen}`)
  assert.ok(m.calibrated)
})

test('a screen filled by one figure does not crater the estimate', () => {
  // The failure this guards: a full-page image is ~40 characters. Taken at face
  // value it would say a screen holds 40 chars, the window would load almost
  // nothing, and the reader would hit a boundary immediately.
  const m = new ScreenMetric()
  for (let i = 0; i < 40; i++) m.observe(2800)
  const before = m.charsPerScreen
  m.observe(40)
  assert.ok(m.charsPerScreen > before * 0.8, 'one sparse screen must not dominate')
  assert.ok(m.charsPerScreen >= 300, 'clamped to the floor at worst')
})

test('an absurd sample is clamped rather than trusted', () => {
  const m = new ScreenMetric()
  for (let i = 0; i < 50; i++) m.observe(10_000_000)
  assert.ok(m.charsPerScreen <= 6000)
})

test('nonsense observations are ignored', () => {
  const m = new ScreenMetric()
  const before = m.charsPerScreen
  m.observe(0)
  m.observe(-5)
  m.observe(Number.NaN)
  assert.equal(m.charsPerScreen, before)
  assert.ok(!m.calibrated)
})

test('the hard character bound wins over the screen arithmetic', () => {
  // The safety property: whatever the screens say, never exceed measured ground.
  const m = new ScreenMetric()
  for (let i = 0; i < 40; i++) m.observe(6000)
  const want = screens(1000)
  assert.ok(m.toChars(want) > V1_EXTENT_POLICY.maxChars)
  assert.equal(charsFor(V1_EXTENT_POLICY, want, m), V1_EXTENT_POLICY.maxChars)
})

test('v1 ships Q7 option 1, and the ceiling is measured ground', () => {
  // Both are load-bearing for D36's deferral, not defaults chosen by taste.
  assert.equal(V1_EXTENT_POLICY.autoExtendOnApproach, false)
  assert.equal(V1_EXTENT_POLICY.evict, false)
  assert.equal(V1_EXTENT_POLICY.maxChars, 1_000_000, "Spike A's measured-flat point")
})

test('the v1 target stays inside the measured ceiling at realistic density', () => {
  // The bug this replaces: target was 14 *days*, which is 1.4 MB at average
  // density and 14 MB at the split threshold — far past anything tested.
  const m = new ScreenMetric()
  for (let i = 0; i < 40; i++) m.observe(2800)
  assert.ok(charsFor(V1_EXTENT_POLICY, V1_EXTENT_POLICY.target, m) <= V1_EXTENT_POLICY.maxChars)
})
