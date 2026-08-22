// Theme parsing (D41). These files are meant to be hand-edited, which means the
// interesting cases are all the ways a person can get one wrong.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  BUILT_IN_THEMES,
  defaultTheme,
  mixHex,
  parseTheme,
  rgbTriple,
  serialiseTheme,
  themeTokens,
} from '../../src/shared/theme.ts'

test('every built-in theme survives a round trip', () => {
  for (const theme of BUILT_IN_THEMES) {
    const back = parseTheme(serialiseTheme(theme), theme.name)
    assert.deepEqual(back, theme, `${theme.name} did not round trip`)
  }
})

test('the default theme leaves the capture stream room to land on slack', () => {
  // D42's arithmetic and D41's parameters meet here: the default must not be a
  // theme whose measure forces the overlay to cover the annotation gutter on the
  // machine this is written on. 54ch + 19ch + 3ch at 20px is comfortably inside
  // a 1512px laptop once the nav's 248px is spent.
  const theme = defaultTheme()
  assert.ok(theme.measure <= 58, `default measure ${theme.measure} is too wide`)
  assert.ok(theme.gutter > 0, 'the gutter must be reserved in every theme')
})

test('every theme reserves an annotation gutter', () => {
  // R27 made the margin durable content, and D41 says reserving it cannot wait:
  // a gutter that appears later reflows the corpus. No theme may opt out.
  for (const theme of BUILT_IN_THEMES) {
    assert.ok(theme.gutter >= 12, `${theme.name} reserves only ${theme.gutter}ch`)
  }
})

test('a corrupt file is a fallback, never a crash', () => {
  assert.equal(parseTheme('{not json', 'x'), null)
  assert.equal(parseTheme('null', 'x'), null)
  assert.equal(parseTheme('[]', 'x'), null)
})

test('one bad field does not discard the rest of the file', () => {
  // The failure that matters: somebody edits a theme, fat-fingers one number,
  // and loses an evening's work because the loader rejected the whole file.
  const edited = JSON.stringify({
    ...defaultTheme(),
    measure: 'wide',
    size: null,
    leading: 1.9,
    label: 'My Theme',
  })
  const theme = parseTheme(edited, 'mine')
  assert.ok(theme !== null)
  assert.equal(theme.label, 'My Theme', 'the good fields survived')
  assert.equal(theme.leading, 1.9)
  assert.equal(theme.measure, defaultTheme().measure, 'the bad ones fell back')
  assert.equal(theme.size, defaultTheme().size)
})

test('absurd numbers are clamped rather than obeyed', () => {
  // A theme with size 0 renders nothing at all, including the controls that
  // would let you fix it — an unrecoverable state reachable by one typo.
  const theme = parseTheme(JSON.stringify({ ...defaultTheme(), size: 0, measure: 5000 }), 'x')
  assert.ok(theme !== null)
  assert.ok(theme.size >= 9, `size clamped to ${theme.size}`)
  assert.ok(theme.measure <= 140, `measure clamped to ${theme.measure}`)
})

test('the name comes from the filename, not from inside the file', () => {
  // Otherwise a copied file silently shadows the theme it was copied from.
  const theme = parseTheme(JSON.stringify({ ...defaultTheme(), name: 'pretender' }), 'onDisk')
  assert.equal(theme?.name, 'onDisk')
})

test('hex becomes the space-separated triple the stylesheet needs', () => {
  assert.equal(rgbTriple('#faf7f0'), '250 247 240')
  assert.equal(rgbTriple('faf7f0'), '250 247 240')
  assert.equal(rgbTriple('#fff'), '255 255 255')
  assert.equal(rgbTriple('#000'), '0 0 0')
  assert.equal(rgbTriple('not a colour'), null)
  assert.equal(rgbTriple('#12345'), null)
})

test('mixing is a blend, and its ends are the colours themselves', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0), '#000000')
  assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff')
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(mixHex('#000000', '#ffffff', -3), '#000000', 'clamped, not extrapolated')
  assert.equal(mixHex('nonsense', '#ffffff', 0.5), 'nonsense', 'a bad colour passes through')
})

test('every theme yields a complete token set the stylesheet can use', () => {
  // A missing token is the classic unreadable-page bug: one theme's text on
  // another theme's ground, because a value silently failed to resolve.
  const expected = [
    '--surface', '--surface-ground', '--surface-muted',
    '--text', '--text-heading', '--text-muted', '--border', '--accent',
  ]
  for (const theme of BUILT_IN_THEMES) {
    const tokens = themeTokens(theme)
    for (const name of expected) {
      assert.ok(name in tokens, `${theme.name} is missing ${name}`)
      assert.match(tokens[name] as string, /^\d{1,3} \d{1,3} \d{1,3}$/, `${theme.name} ${name}`)
    }
  }
})

test('a dark theme derives a darker ground, not a lighter one', () => {
  // The derivation mixes paper toward ink, so it follows the theme rather than
  // assuming paper is light. Getting this backwards would put a pale rail
  // beside dark paper in Night.
  const night = BUILT_IN_THEMES.find(t => t.name === 'night')
  assert.ok(night !== undefined)
  const ground = themeTokens(night)['--surface-ground'] as string
  const surface = themeTokens(night)['--surface'] as string
  const luma = (triple: string): number =>
    triple.split(' ').map(Number).reduce((a, b) => a + b, 0)
  assert.ok(luma(ground) > luma(surface), 'Night mixes toward its light ink')
})
