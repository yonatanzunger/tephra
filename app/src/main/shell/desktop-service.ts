// **Shell tier. May use Electron, which is the point of the tier** (D83).
//
// What only the desktop can do: the clipboard, the file dialog, the printer, the
// emoji panel, and handing a path to whatever the OS thinks should open it.
//
// **The far side of every split already made.** Three verbs were split in two
// along exactly this line before the tier had a name — a service says *where does
// this point*, and something else opens it (`LibraryService.linkTarget`,
// `navOpen`, `chooseImage`). Those were read as special cases, which is what a
// tier boundary looks like when it has not been drawn yet. Drawn, they are one
// rule: **the notebook's meaning is a service's; the machine is this file's.**
//
// **The gain is the Electron-free rule kept honest.** Everything in
// `main/services/` can be driven under plain Node, which is what lets three
// integration suites test it at all — a property broken three times by three
// imports each added for a good local reason. The cost is one hop, and the hop is
// legible in the two halves' names.

import { app, clipboard, dialog, shell } from 'electron'
import { basename, extname } from 'node:path'
import { CHANNEL, IMAGE_EXTENSIONS, type Attached, type Base, type Clipboard, type ImageAttachment, type PrintJob } from '../../shared/ipc.ts'
import type { Followed, Reference } from '../../shared/nav-api.ts'
import type { DocumentId } from '../../shared/document-api.ts'
import type { RelPath } from '../w/layout.ts'
import { readOutsideBytes } from '../w/outside.ts'
import { serve, type Served, type Serves } from '../services/serves.ts'
import { printPassage } from './print.ts'

/** What the library answers about a path, without opening it. */
export interface Paths {
  /** Which document a path names, or null if it names none. */
  documentAt(target: string, from?: RelPath): Promise<DocumentId | null>
  /** Where a link points on disk, or null if it will not be followed. */
  linkTarget(target: string, from?: RelPath): Promise<string | null>
}

/** Where bytes from outside end up. */
export interface Attachments {
  attachImage(request: ImageAttachment): Promise<Attached>
}

/** The list a task reference opens. */
export interface Lists {
  list(): Promise<DocumentId>
}

export class DesktopService implements Serves {
  readonly #paths: Paths
  readonly #attachments: Attachments
  readonly #lists: Lists
  readonly #notebookRoot: string

  constructor(paths: Paths, attachments: Attachments, lists: Lists, notebookRoot: string) {
    this.#paths = paths
    this.#attachments = attachments
    this.#lists = lists
    this.#notebookRoot = notebookRoot
  }

  serves(): readonly Served[] {
    return [
      serve(CHANNEL.openLink, (target: string) => this.openLink(target)),
      serve(CHANNEL.navOpen, (reference: Reference, from?: RelPath) => this.follow(reference, from)),
      serve(CHANNEL.print, (job: PrintJob) => printPassage(this.#notebookRoot, job)),
      serve(CHANNEL.chooseImage, (base: Base) => this.chooseImage(base)),
      serve(CHANNEL.readClipboard, () => this.readClipboard()),
      serve(CHANNEL.emojiPanel, () => this.emojiPanel()),
    ]
  }

  /**
   * Open a link found in the text, with the OS.
   *
   * The service says WHERE it points — a question about the notebook, answerable
   * under plain Node — and this opens it.
   */
  async openLink(target: string): Promise<boolean> {
    const at = await this.#paths.linkTarget(target)
    if (at === null) return false
    return (await shell.openPath(at)) === ''
  }

  /**
   * Follow a reference that leaves the app (D10's third and fourth kinds).
   *
   * **Split the same way link-following is**: the service says where it points;
   * this opens it. A reference the app should handle ITSELF — a bookmark, a
   * subject, a day — never arrives here, because going there is navigation and
   * not opening.
   */
  async follow(reference: Reference, from?: RelPath): Promise<Followed> {
    if (reference.kind === 'url') {
      await shell.openExternal(reference.href)
      return 'opened'
    }
    if (reference.kind === 'todo') {
      // **A task is a document in the corpus, so it opens like one** (D56).
      // Which day it is showing is the list's business, and it shows today —
      // the item's newest instance is what the item IS now. Landing on the
      // exact line is worth having and is not this milestone's.
      return { document: await this.#lists.list() }
    }
    if (reference.kind !== 'file') return 'unsupported'

    // **A document in the corpus is this app's to open**, and the renderer is
    // told which one rather than being sent to the desktop. Handing it to the
    // OS would open it in some other editor — a different act wearing the same
    // gesture (D54).
    const document = await this.#paths.documentAt(reference.path, from)
    if (document !== null) return { document }

    const at = await this.#paths.linkTarget(reference.path, from)
    if (at === null) return 'missing'
    return (await shell.openPath(at)) === '' ? 'opened' : 'missing'
  }

  /**
   * An image chosen from a dialog (R7).
   *
   * **Two doors, one act**: bytes that arrived in the renderer — a paste, a drop
   * — go straight to the intake service, and a file chosen here comes back
   * through the same door, because only main can open a dialog.
   */
  async chooseImage(base: Base): Promise<Attached | null> {
    const picked = await dialog.showOpenDialog({
      title: 'Insert an image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }],
    })
    const path = picked.filePaths[0]
    if (picked.canceled || path === undefined) return null
    const ext = extname(path).replace(/^\./, '').toLowerCase()
    if (!IMAGE_EXTENSIONS.includes(ext)) return null
    // **Through `w/outside.ts`**, which is where reaching outside the notebook
    // lives: a file the person picked is bytes on disk and not the notebook's,
    // and the layering test is what insisted (MC6).
    const bytes = await readOutsideBytes(path)
    if (bytes === null) return null
    return this.#attachments.attachImage({ base, name: basename(path, extname(path)), ext, bytes })
  }

  /**
   * Whatever is on the clipboard, whole.
   *
   * **The richest flavour is kept and the plainest is annotated.** A copy from a
   * browser or a word processor carries HTML as well as text; the HTML is what a
   * citation should point at, and the text is what a person wants to write on.
   * Converting HTML to markdown well is its own project, and doing it badly would
   * put a mangled approximation in the corpus while throwing the good copy away.
   *
   * **The conversion happens in the renderer**, where Chromium's HTML parser
   * already is — doing it here would mean shipping a DOM implementation to a
   * process that has no use for one. Main reads it because main is the only side
   * that has a clipboard.
   */
  readClipboard(): Clipboard {
    return { text: clipboard.readText(), html: clipboard.readHTML() }
  }

  /**
   * The system's own picker, which knows every emoji and how to search them.
   *
   * It types into whatever has focus, so the renderer focuses a field first.
   * False where there is no such panel, which is everywhere but macOS.
   */
  emojiPanel(): boolean {
    if (process.platform === 'darwin') app.showEmojiPanel()
    return process.platform === 'darwin'
  }
}
