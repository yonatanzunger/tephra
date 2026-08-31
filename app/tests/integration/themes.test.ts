// The theme store: seeding, topping up, and deleting (D41).
//
// These are the parts that touch somebody's `config/themes/` directory, where
// the rule is that a file a person edited is theirs. What is asserted here is
// mostly restraint: what seeding will NOT do.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { deleteTheme, listThemes, saveTheme, seedThemes } from '../../src/main/w/themes.ts'
import { BUILT_IN_THEMES, defaultTheme } from '../../src/shared/theme.ts'

async function notebook(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-themes-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => nb.close())
  return { nb, root }
}

const themeAt = async (root: string, name: string): Promise<Record<string, never>> =>
  JSON.parse(await readFile(join(root, 'config', 'themes', `${name}.json`), 'utf8'))

test('seeding writes the built-ins into a notebook that has none', async t => {
  const { nb, root } = await notebook(t)
  await seedThemes(nb)

  for (const built of BUILT_IN_THEMES) {
    assert.equal(existsSync(join(root, 'config', 'themes', `${built.name}.json`)), true, built.name)
  }
  assert.equal((await listThemes(nb)).length, BUILT_IN_THEMES.length)
})

test('and leaves a file somebody edited exactly as it is', async t => {
  // The rule this store is built around: finding your edit silently restored
  // teaches you never to trust the directory again.
  const { nb, root } = await notebook(t)
  await seedThemes(nb)
  const mine = { ...defaultTheme(), label: 'My Aldine', size: 33 }
  await saveTheme(nb, mine)

  await seedThemes(nb)
  const after = await themeAt(root, mine.name)
  assert.equal((after as unknown as { label: string }).label, 'My Aldine')
  assert.equal((after as unknown as { size: number }).size, 33)
})

test('THE EXCEPTION: a key the file never had an opinion about is filled in', async t => {
  // A file written before `panel` existed does not DISAGREE about panel — it
  // has no opinion, because there was nothing to have one about. Adding what
  // its author never chose is not overwriting what they did.
  const { nb, root } = await notebook(t)
  await mkdir(join(root, 'config', 'themes'), { recursive: true })
  const built = BUILT_IN_THEMES[0] as (typeof BUILT_IN_THEMES)[number]
  const { panel: _dropped, ...older } = built.palette
  await writeFile(
    join(root, 'config', 'themes', `${built.name}.json`),
    JSON.stringify({ ...built, label: 'Mine', palette: older }, null, 2),
  )

  await seedThemes(nb)
  const after = await themeAt(root, built.name)
  const palette = (after as unknown as { palette: Record<string, string> }).palette
  assert.equal(palette.panel, built.palette.panel, 'the built-in chose one, and now the file says so')
  assert.equal((after as unknown as { label: string }).label, 'Mine', 'and the edit is untouched')
})

test('an untouched file is not rewritten at all', async t => {
  // A no-op write is still a modification time, a git diff, and a reason to
  // wonder what changed.
  const { nb, root } = await notebook(t)
  await seedThemes(nb)
  const before = await readFile(join(root, 'config', 'themes', 'aldine.json'), 'utf8')
  await seedThemes(nb)
  assert.equal(await readFile(join(root, 'config', 'themes', 'aldine.json'), 'utf8'), before)
})

test('a theme somebody made can be deleted; a built-in cannot', async t => {
  // Deleting a built-in would delete it until the next launch and then quietly
  // bring it back — a control that appears to work and does not.
  const { nb, root } = await notebook(t)
  await seedThemes(nb)
  await saveTheme(nb, { ...defaultTheme(), name: 'evening', label: 'Evening' })

  assert.equal(await deleteTheme(nb, 'evening'), true)
  assert.equal(existsSync(join(root, 'config', 'themes', 'evening.json')), false)

  assert.equal(await deleteTheme(nb, 'aldine'), false, 'refused')
  assert.equal(existsSync(join(root, 'config', 'themes', 'aldine.json')), true, 'and still there')
})

test('deleting something that is not there is false, not an error', async t => {
  const { nb } = await notebook(t)
  await seedThemes(nb)
  assert.equal(await deleteTheme(nb, 'no-such-theme'), false)
})
