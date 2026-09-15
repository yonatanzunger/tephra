// **The shell composition root**, and the Electron half of the pair
// (`services/notebook-service.ts` is the other).
//
// It builds the services that need the machine — the window, the desktop, the
// capture gesture — and hands the list to the wiring, exactly as the notebook
// root does for the ten that do not.
//
// ## Why the pair, rather than one root
//
// The tier boundary is the whole point of D83's fourth tier: everything under
// `main/services/` is free of Electron, which is what lets three integration
// suites drive it under plain Node, and the shell above it is not. **Two roots
// make that edge structural rather than remembered**: this one holds a reference
// to the notebook root, and nothing holds a reference back. A single root would
// have had to import Electron to build these three, which is the rule this tier
// exists to keep honest.
//
// ## What each of the three needs from the other side
//
// Each pairing is a verb split along the tier boundary, and the split is legible
// in the two halves' names:
//
// | shell service | asks the notebook for | because |
// |---|---|---|
// | `FrameService` | nothing — it has `Windows` | a window is entirely the machine's |
// | `DesktopService` | the library, intake, the task list | *where does this point* is the notebook's; *open it* is the OS's |
// | `CaptureService` | the task list | it needs somewhere to put what it caught |

import { app } from 'electron'
import type { NotebookService } from '../services/notebook-service.ts'
import type { Serves } from '../services/serves.ts'
import type { DocumentId } from '../../shared/document-api.ts'
import { CaptureService } from './capture-service.ts'
import { DesktopService } from './desktop-service.ts'
import { FrameService } from './frame-service.ts'
import type { Windows } from './windows.ts'

export class ShellService {
  /** Which window this is, and what it now shows (MC6). */
  readonly #frame: FrameService
  /** The clipboard, the dialog, the printer, the emoji panel, opening a path. */
  readonly #desktop: DesktopService
  /** A task caught in one window and made in another (T13). */
  readonly #capture: CaptureService

  constructor(notebook: NotebookService, windows: Windows, onImport: (id: DocumentId | null) => void) {
    this.#frame = new FrameService(windows, onImport)
    this.#desktop = new DesktopService(
      notebook.library, notebook.intake, notebook.todo, notebook.notebookRoot,
    )
    this.#capture = new CaptureService(notebook.todo)

    // **A search cursor dies with the window that opened it** (D65). Here rather
    // than in the search service, which may not import Electron — and here
    // rather than in `FrameService`, because this fires for EVERY window
    // Electron makes, including the offscreen one printing uses, which
    // `Windows` knows nothing about.
    //
    // **The id is taken while the window is alive.** Reading `webContents.id`
    // inside `closed` reaches a destroyed object and throws — and the window
    // that found this was that hidden print window, so the failure was a PDF
    // that came out fine and a main process that fell over on the way back.
    app.on('browser-window-created', (_event, created) => {
      const owner = created.webContents.id
      created.on('closed', () => notebook.searches.forget(owner))
    })
  }

  /** Every shell service that answers the renderer, for the wiring to walk. */
  services(): readonly Serves[] {
    return [this.#frame, this.#desktop, this.#capture]
  }
}
