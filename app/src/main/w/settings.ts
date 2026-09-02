// The notebook's own settings, which travel with it (D63).
//
// **In `config/`, beside the themes, and for the same reason** (D41): this is a
// choice somebody made about the notebook rather than state this machine
// happens to hold. `.tephra/` is machine-local and never synced, so a zone kept
// there would give every device its own — and the zone decides which date a
// passage is filed under, so two devices with different answers would file one
// evening under two dates.
//
// Files are W's, which is why the reading and writing live here rather than in
// the service that asks the questions.

import type { Notebook } from './notebook.ts'
import { SETTINGS_FILE, type RelPath } from './layout.ts'
import { DEFAULT_ZONE, isKnownZone } from '../../shared/dates.ts'

export interface Settings {
  /** The zone this notebook's dates are computed in. */
  readonly zone: string
}

/**
 * What the notebook says, or what an unset one means.
 *
 * **A zone this machine has never heard of is not silently UTC.** A corpus
 * naming a zone that has gone away, or a file somebody mistyped, would
 * otherwise re-date everything written after it — so an answer that cannot be
 * used is discarded and the notebook keeps the zone it has been using. Same
 * rule as an unreadable frontmatter: leave it alone and carry on (D52).
 */
export async function readSettings(notebook: Notebook): Promise<Settings> {
  const text = await notebook.read(SETTINGS_FILE as RelPath)
  if (text === null) return { zone: DEFAULT_ZONE }
  try {
    const held = JSON.parse(text) as { zone?: unknown }
    const zone = typeof held.zone === 'string' && isKnownZone(held.zone) ? held.zone : DEFAULT_ZONE
    return { zone }
  } catch {
    return { zone: DEFAULT_ZONE }
  }
}

/** Written whole, and formatted so a person editing it by hand sees what to do. */
export async function writeSettings(notebook: Notebook, settings: Settings): Promise<void> {
  await notebook.write(SETTINGS_FILE as RelPath, `${JSON.stringify(settings, null, 2)}\n`)
}
