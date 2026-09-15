// **Shell tier. May use Electron, which is the point of the tier** (D83).
//
// A task somebody asked for, between the asking and the answer (T13).
//
// **It spans two windows, which is why it is not a domain service.** The words
// come from a selection in one window; the item is made in another; and the link
// back can only be written once the item exists, by which time the caret is
// somewhere else entirely. Main is the only thing that can see both ends, and
// *which window* is a shell question.
//
// **It was three closure variables in `ipc.ts`.** `waiting` and `claimed` lived
// inside the registration function — the last mutable state in the wiring, and
// the strongest argument for this file: state belongs to an object that can be
// reasoned about, not to a function that happens to still be on the stack.
//
// **Windows by id, not by object.** `serveAsked` hands over a number and
// `webContents.fromId` turns it back into something to push at — which also
// replaces the old `isDestroyed()` check with a better one: a window that has
// gone is a window the registry no longer knows.

import { BrowserWindow, webContents } from 'electron'
import { CHANNEL, type CaptureCommand } from '../../shared/ipc.ts'
import type { DocumentId } from '../../shared/document-api.ts'
import { serveAskedKinds, type Served, type Serves } from '../services/serves.ts'

/** What was being said when the capture started. */
interface Capture {
  readonly text: string
  readonly wrap: boolean
  /** The window that asked, by id — resolved back only when there is something to send. */
  readonly origin: number
}

/** The far end: the list a captured item goes on. */
export interface CaptureTarget {
  /** The notebook's task list, made if there is not one yet. */
  list(): Promise<DocumentId>
}

export class CaptureService implements Serves {
  readonly #tasks: CaptureTarget

  /** Said, and not yet taken by the list. */
  #waiting: Capture | null = null
  /** Taken by the list, and not yet answered for. */
  #claimed: Capture | null = null

  constructor(tasks: CaptureTarget) {
    this.#tasks = tasks
  }

  serves(): readonly Served[] {
    return [
      // **One channel, three kinds, and each told which window asked** — the
      // asker is the window whose selection this is, which `settle` gives the
      // sentence back to.
      serveAskedKinds<CaptureCommand>(CHANNEL.capture, {
        /**
         * **Left for the list to pull.** Pushing at a window that may have been
         * created a millisecond ago races its renderer: `did-finish-load` is not
         * "React has mounted and subscribed". Something the list reads when it
         * arrives cannot be too early — the same level-rather-than-edge shape the
         * day boundary settled on (D62). Revealing is the caller's next call,
         * because windows are not this service's to know about.
         */
        capture: (asker, command) => {
          this.#waiting = { text: command.text, wrap: command.wrap, origin: asker }
          return this.#tasks.list()
        },
        /**
         * **Only when there is something to take.** The list asks on arrival AND
         * on being revealed, and the second ask used to overwrite the live claim
         * with nothing — so by the time the row was committed there was no one
         * left to answer, and the link never came back. Asking twice is meant to
         * be free; it was destroying the thing it asked about.
         */
        claim: () => {
          if (this.#waiting === null) return null
          this.#claimed = this.#waiting
          this.#waiting = null
          return { text: this.#claimed.text }
        },
        /**
         * **Back where the thought started, committed or abandoned.** The point
         * of the gesture is that a task reaches the list without costing you the
         * sentence you were in, so it ends by giving the sentence back.
         */
        settle: (_asker, command) => {
          const capture = this.#claimed
          this.#claimed = null
          if (capture === null) return
          // **The window that STARTED it**, not the one settling — those are two
          // different windows, which is the whole shape of the gesture.
          const origin = webContents.fromId(capture.origin)
          if (origin === undefined || origin.isDestroyed()) return
          if (command.item !== null && capture.wrap) origin.send(CHANNEL.captured, command.item)
          BrowserWindow.fromWebContents(origin)?.focus()
        },
      }),
    ]
  }
}
