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
  type Theme,
} from '../../src/shared/theme.ts'

test('every built-in theme survives a round trip', () => {
  for (const theme of BUILT_IN_THEMES) {
    const back = parseTheme(serialiseTheme(theme), theme.name)
    assert.deepEqual(back, theme, `${theme.name} did not round trip`)
  }
})

test('the default measure is a reading measure, not an inherited accident', () => {
  // This exists because the previous default was 74ch, carried over from Spike A
  // when the text was centred and there was no gutter beside it — nobody chose
  // it for reading. The classic guidance is 45–75 characters; the rail is there
  // to catch another number arriving by inheritance rather than by judgement.
  //
  // It deliberately does NOT assert that the capture stream lands on slack. That
  // was the earlier rule, and it turned a trade into a prohibition: the overlay
  // covering some margin is recoverable and the panel states the cost live, so
  // spending it is a choice the reader gets to make (D42, amended).
  const theme = defaultTheme()
  assert.ok(theme.measure >= 45 && theme.measure <= 75, `default measure ${theme.measure}`)
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

// ── the panel colour, and what "not chosen" means (M3) ────────────────────

test('a theme that does not name a panel is GIVEN one when it is read', () => {
  // Derived once, at the moment of reading, so that everything downstream sees
  // an ordinary colour: the painter, the swatch, and any duplicate made from
  // it. A "derive it later" empty string would have to be understood by all
  // three forever, to save writing six characters once.
  const theme = parseTheme(
    JSON.stringify({ version: 1, palette: { paper: '#ffffff', ink: '#000000' } }),
    'plain',
  )
  assert.notEqual(theme, null)
  assert.match(theme?.palette.panel ?? '', /^#[0-9a-f]{6}$/, 'a real colour, not a blank')
  assert.notEqual(theme?.palette.panel, theme?.palette.paper, 'and it is not the page')
})

test('and it comes from that theme\'s own paper, not the default theme\'s panel', () => {
  // A dark theme written before the field existed must not be handed a cream
  // panel because the built-in it fell back to happened to be light.
  const dark = parseTheme(
    JSON.stringify({ version: 1, palette: { paper: '#101010', ink: '#eeeeee' } }),
    'dark',
  )
  const light = parseTheme(
    JSON.stringify({ version: 1, palette: { paper: '#ffffff', ink: '#000000' } }),
    'light',
  )
  assert.notEqual(dark?.palette.panel, light?.palette.panel)
  // Toward the ink, which on a dark page means lighter than the paper.
  assert.notEqual(dark?.palette.panel, defaultTheme().palette.panel)
})

test('a duplicate carries a real panel colour, because there are no blanks', () => {
  // What "derive later" cost in practice: duplicating a theme copied an empty
  // field, and the copy's panel control had nothing in it.
  const original = parseTheme(
    JSON.stringify({ version: 1, palette: { paper: '#ffffff', ink: '#000000' } }),
    'original',
  ) as Theme
  const copy: Theme = { ...original, name: 'copy', label: 'Copy' }
  assert.equal(copy.palette.panel, original.palette.panel)
  assert.match(copy.palette.panel, /^#[0-9a-f]{6}$/)
})

test('a theme that names one is obeyed, which is the whole point', () => {
  // THE BUG THIS FIXES: the sidebar's ground was mixed in code, so no amount of
  // editing a theme could change it — the one colour the chrome most needed was
  // the one a person could not reach.
  const theme = parseTheme(
    JSON.stringify({
      version: 1,
      palette: { paper: '#ffffff', ink: '#000000', panel: '#123456' },
    }),
    'chosen',
  )
  assert.equal(themeTokens(theme as Theme)['--surface-panel'], '18 52 86')
})

test('the edge follows the panel, not the paper', () => {
  // A chosen panel takes its own border with it; otherwise a dark panel on a
  // light page keeps the page's hairline and reads as unfinished.
  const light = parseTheme(
    JSON.stringify({ version: 1, palette: { paper: '#ffffff', ink: '#000000', panel: '#ffffff' } }),
    'a',
  )
  const dark = parseTheme(
    JSON.stringify({ version: 1, palette: { paper: '#ffffff', ink: '#000000', panel: '#222222' } }),
    'b',
  )
  assert.notEqual(
    themeTokens(light as Theme)['--border-strong'],
    themeTokens(dark as Theme)['--border-strong'],
  )
})

test('every built-in chooses its own panel rather than settling for a mix', () => {
  for (const theme of BUILT_IN_THEMES) {
    assert.notEqual(theme.palette.panel.trim(), '', theme.name)
  }
})

// ── the chrome's own text, and the gap between thoughts ───────────────────

test('the panel gets its own text tiers, mixed toward the ground it sits on', () => {
  // The ink is chosen against the PAPER. A panel much darker than the page —
  // which is the whole reason `panel` is authorable — leaves the sidebar's
  // words set in a colour picked for a surface they are no longer on.
  const theme = parseTheme(
    JSON.stringify({
      version: 1,
      palette: { paper: '#ffffff', ink: '#000000', panel: '#101010', panelInk: '#eeeeee' },
    }),
    'dark-panel',
  ) as Theme
  const tokens = themeTokens(theme)

  assert.equal(tokens['--panel-text-heading'], '238 238 238', 'the authored colour, at full strength')
  assert.notEqual(tokens['--panel-text'], tokens['--text'], 'and not the page\'s ink')
  // Body sits between the heading and the quiet tier, all three toward the panel.
  assert.notEqual(tokens['--panel-text'], tokens['--panel-text-muted'])
  assert.notEqual(tokens['--panel-text-muted'], tokens['--surface-panel'])
})

test('a theme that says nothing about panel text keeps using its ink', () => {
  // Which is what every theme looked like before the panel could differ from
  // the paper — so nothing moves for a light theme that never asked.
  const theme = parseTheme(
    JSON.stringify({ version: 1, palette: { paper: '#ffffff', ink: '#222222' } }),
    'plain',
  ) as Theme
  assert.equal(theme.palette.panelInk, '#222222')
})

test('the space between paragraphs is ONE number, not the sum of two', () => {
  // It was a padding under the last line plus a height for the blank line, so
  // the gap a reader saw was their sum and neither meant anything alone. A
  // newline continues a paragraph (markdown), so there is nothing to set
  // between the lines of one — `leading` is that question, entire.
  const theme = parseTheme(JSON.stringify({ version: 1, paragraphSpace: 0.9 }), 'spaced') as Theme
  assert.equal(theme.paragraphSpace, 0.9)
  assert.equal('lineSpace' in theme, false, 'gone, because a gap inside a paragraph is not a thing')
  assert.equal('blankLine' in theme, false, 'folded into the one gap it was half of')
})

test('justification is a switch, and every built-in starts ragged', () => {
  // Which one is right depends on the measure, the face and the reader, all of
  // which are already theirs to set — so it is a choice, not a default with an
  // opinion. Ragged is what the themes have always looked like.
  for (const built of BUILT_IN_THEMES) assert.equal(built.justify, false, built.name)

  assert.equal((parseTheme(JSON.stringify({ version: 1, justify: true }), 'j') as Theme).justify, true)
  // Anything that is not `true` is false: a hand-edited "yes" is not a boolean,
  // and guessing at one would be worse than ignoring it.
  assert.equal((parseTheme(JSON.stringify({ version: 1, justify: 'yes' }), 'j') as Theme).justify, false)
})
