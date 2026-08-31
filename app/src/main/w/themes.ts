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
 *
 * **With one exception, and it is not a violation of that.** A built-in's file
 * written before a field EXISTED does not disagree with the built-in about that
 * field — it has no opinion, because there was nothing to have an opinion about
 * when it was written. Filling in a key that is absent adds what the author
 * never chose; it never touches a key they did. Without this, every notebook
 * that ran an older Tephra keeps the derived colour for a value the built-in
 * now chooses deliberately — which for `panel` is exactly the grey sidebar that
 * made this worth doing.
 */
export async function seedThemes(notebook: Notebook): Promise<void> {
  for (const theme of BUILT_IN_THEMES) {
    const rel = themeFile(theme.name)
    const existing = await notebook.read(rel)
    if (existing === null) {
      await notebook.write(rel, serialiseTheme(theme))
      continue
    }
    const filled = withMissingKeys(existing, theme)
    if (filled !== null) await notebook.write(rel, filled)
  }
}

/**
 * The file, plus any palette key it does not mention, from the built-in.
 *
 * Null when there is nothing to add, so an untouched file is not rewritten —
 * a no-op write is still a modification time, a git diff, and a reason to
 * wonder what changed.
 */
function withMissingKeys(text: string, built: Theme): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null // unreadable is the reader's problem, not something to fix here
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null

  const file = raw as { palette?: Record<string, unknown> }
  const palette = typeof file.palette === 'object' && file.palette !== null ? file.palette : {}
  let added = false
  for (const [key, value] of Object.entries(built.palette)) {
    if (palette[key] === undefined) {
      palette[key] = value
      added = true
    }
  }
  if (!added) return null
  return `${JSON.stringify({ ...file, palette }, null, 2)}\n`
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

/**
 * Remove a theme somebody made.
 *
 * **A built-in cannot be removed, and refusing is the honest answer.** Seeding
 * writes any built-in whose file is absent, so deleting one would delete it
 * until the next launch and then quietly bring it back — a control that appears
 * to work and does not. Duplicating a built-in and editing the copy is the way
 * to be rid of one in practice, and the copy IS deletable.
 */
export async function deleteTheme(notebook: Notebook, name: string): Promise<boolean> {
  if (BUILT_IN_THEMES.some(theme => theme.name === name)) return false
  const rel = themeFile(name)
  if (!(await notebook.has(rel))) return false
  await notebook.remove(rel)
  return true
}
