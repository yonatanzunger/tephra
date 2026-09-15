// **Shell tier. Every channel that exists only for the self-checks.**
//
// `verify-mode.ts` says *whether* the affordances are on; this says *what they
// are*, on the IPC boundary. Three channels, gated, and in one file for the
// reason that module gives: **nobody audits a surface that has no name.** They
// were scattered across `ipc.ts` and `index.ts` behind three separate
// `if (verifyMode())`s, which is how a surface grows without anybody deciding
// that it should.
//
// **Not `CHANNEL` constants, deliberately.** These are not part of the app's
// vocabulary — `tephra:verify:…` is spelled out here and in `preload` and
// nowhere else, so `channels.test.ts`'s census of what the renderer asks and
// what main answers stays a census of the real app.

import { ipcMain } from 'electron'
import type { Clipboard } from '../../shared/ipc.ts'
import { clipboard } from 'electron'
import { verifyEnv, verifyMode } from './verify-mode.ts'

/** What a scene may ask of the app itself. */
export interface Verifiable {
  /** What every open window is holding, and whether it agrees. */
  diagnose(): unknown
}

/** Pull a real menu item, by the label a person would read. */
export type ClickMenu = (label: string) => boolean

/**
 * Register the self-check channels, or none of them.
 *
 * One gate rather than one per channel: the gate is the decision, and repeating
 * it three times invites a fourth channel that forgets it.
 */
export function registerVerifyIpc(app: Verifiable, clickMenu: ClickMenu): void {
  if (!verifyMode()) return

  ipcMain.handle('tephra:verify:diagnose', () => app.diagnose())

  // **Gated twice, and it keeps its second gate.** Driving the menu bar is the
  // sharpest of these affordances, and it was reachable only when a scene had
  // actually been named — `TEPHRA_VERIFY` is the scene, `TEPHRA_VERIFY_MODE` is
  // the mode. Collecting the three channels in one file must not quietly hand
  // the narrow one the wide gate.
  if (verifyEnv('TEPHRA_VERIFY') !== undefined) {
    ipcMain.handle('tephra:verify:menu', (_e, label: string) => clickMenu(label))
  }

  /**
   * Put something known on the clipboard, and hand back what was there.
   *
   * **The acceptance run must not depend on what the operator last copied.**
   * Before this, `npm run m2`'s import section passed or failed according to
   * the state of a system pasteboard nobody had set on purpose — it went green
   * for a fortnight because there happened to be HTML on it, and went red the
   * first morning there was not. A test whose result is decided by ambient
   * state is not reporting on the code.
   *
   * It gives back the previous contents so the scene can put them back:
   * clobbering a person's clipboard because they ran the tests would be a rude
   * way to fix a flaky check.
   */
  ipcMain.handle('tephra:verify:clipboard', (_e, next: Clipboard | null): Clipboard => {
    const had: Clipboard = { text: clipboard.readText(), html: clipboard.readHTML() }
    if (next !== null) {
      if (next.html !== '') clipboard.write({ text: next.text, html: next.html })
      else clipboard.writeText(next.text)
    }
    return had
  })
}
