// **Shell tier. May use Electron, which is the point of the tier** (D83, as
// amended).
//
// What a window *is*: which one this renderer is, what it now shows, opening
// another, revealing one, closing this one, importing into it (MC6).
//
// ## Why there is a shell tier at all
//
// The rule was written as *no service imports Electron*, which is a rule about a
// **layer** wearing the clothes of a rule about **all services**. The honest
// version: the foundation and the domain services are Electron-free — which is
// what lets three integration suites drive them under plain Node, a property
// broken three times by three imports each added for a good local reason — and a
// shell tier above them is not. `windows`, `menu`, `print` and `scheme` already
// lived there, in `main/` root, unnamed; naming it makes this a service rather
// than a limitation.
//
// ## And it needed no exemption in the end
//
// Four of these verbs took a `WebContents`, which looked like the reason a frame
// service was impossible. They only ever read `sender.id` — `Windows` has always
// matched windows by id and keyed its registry `Map<number, Entry>` — so they
// take the id, and this declares its channels with `serveAsked` like any other
// service. The Electron object never crosses the boundary.
//
// `windowReveal` is the one that genuinely touches Electron: it pushes to the
// window it revealed, because a window already open has no mount to react to
// and a hidden one never sees focus. That is what the tier is for.

import { CHANNEL } from '../../shared/ipc.ts'
import type { WindowReport } from '../../shared/ipc.ts'
import type { NavTarget } from '../../shared/pane-api.ts'
import type { DocumentId } from '../../shared/document-api.ts'
import { serve, serveAsked, told, type Served, type Serves } from '../services/serves.ts'
import type { Windows } from './windows.ts'

export class FrameService implements Serves {
  readonly #windows: Windows
  readonly #onImport: (id: DocumentId | null) => void

  constructor(windows: Windows, onImport: (id: DocumentId | null) => void) {
    this.#windows = windows
    this.#onImport = onImport
  }

  serves(): readonly Served[] {
    return [
      serveAsked(CHANNEL.windowInfo, (asker: number) => this.#windows.infoFor(asker)),
      // **Told, not asked** — the renderer `send`s this as the caret moves and
      // does not wait. Declaring it as asked cost an acceptance check: a caret
      // reported into a channel with only a handler behind it is dropped in
      // total silence (`serves.ts`, `told`).
      told(
        serveAsked(CHANNEL.windowReport, (asker: number, report: WindowReport) =>
          this.#windows.report(asker, report),
        ),
      ),
      serveAsked(CHANNEL.windowClose, (asker: number) => this.#windows.close(asker)),
      // The badge and the File menu reach the same act; main owns it either way.
      serveAsked(CHANNEL.windowImport, (asker: number) =>
        this.#onImport(this.#windows.importableFor(asker)),
      ),
      serve(CHANNEL.windowCreate, (target?: NavTarget) => {
        this.#windows.open(target)
      }),
      /**
       * Show something in a window of its own — the one that already has it, or
       * a new one. What ⌘0 and ⌘1 do, reachable by a renderer that has a reason.
       */
      serve(CHANNEL.windowReveal, (target: NavTarget) => {
        const shown = this.#windows.reveal(target)
        // Told, not left to notice: a window already open has no mount to react
        // to, and a hidden one — every window in verification mode — never sees
        // focus.
        if (!shown.isDestroyed()) shown.webContents.send(CHANNEL.revealed)
      }),
    ]
  }
}
