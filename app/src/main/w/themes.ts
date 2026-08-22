// Reading and writing theme files (D41).
//
// W-layer: this is file access and nothing else. What a theme *means* is in
// `shared/theme.ts`, which both processes read, so neither side owns a second
// idea of the format.

import { parseTheme, serialiseTheme, BUILT_IN_THEMES, type Theme } from '../../shared/theme.ts'
import { THEMES_DIR, themeFile } from './layout.ts'
import type { Notebook } from './notebook.ts'

/**
 * Write the built-in themes into the notebook if they are not already there.
 *
 * Deliberately non-destructive: a file that exists is left exactly as it is,
 * even if it differs from the built-in of the same name. Someone editing
 * `aldine.json` and finding it silently restored on next launch would learn
 * never to trust the directory again.
 */
export async function seedThemes(notebook: Notebook): Promise<void> {
  for (const theme of BUILT_IN_THEMES) {
    const rel = themeFile(theme.name)
    if (await notebook.has(rel)) continue
    await notebook.write(rel, serialiseTheme(theme))
  }
}

/**
 * Every theme in the notebook, by name. A file that will not parse is skipped
 * rather than fatal — one bad file must not cost you the other five, and the
 * anomaly belongs on the surface `format-spec.md` leaves open, not in a crash.
 */
export async function listThemes(notebook: Notebook): Promise<readonly Theme[]> {
  const files = await notebook.list(THEMES_DIR)
  const themes: Theme[] = []
  for (const rel of files) {
    if (!rel.endsWith('.json')) continue
    const text = await notebook.read(rel)
    if (text === null) continue
    const name = rel.slice(rel.lastIndexOf('/') + 1, -'.json'.length)
    const theme = parseTheme(text, name)
    if (theme !== null) themes.push(theme)
  }
  return themes.sort((a, b) => a.label.localeCompare(b.label))
}

export async function saveTheme(notebook: Notebook, theme: Theme): Promise<void> {
  await notebook.write(themeFile(theme.name), serialiseTheme(theme))
}
