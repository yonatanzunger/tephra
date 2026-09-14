// Wiring the document service to Electron IPC. Nothing here does work.

import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from 'electron'
import { basename, extname } from 'node:path'
import { IMAGE_EXTENSIONS } from '../../shared/ipc.ts'
import { readOutsideBytes } from '../w/outside.ts'
import { CHANNEL, type CaptureCommand, type DocketCommand, type EditRequest, type ExtendRequest, type ReadRequest, type SpansRequest, type WindowId, type TodoCommand } from '../../shared/ipc.ts'
import { DocumentService } from '../services/document-service.ts'
import { claim, type Serves } from '../services/serves.ts'
import { FrameService } from './frame-service.ts'
import { printPassage } from './print.ts'
import { verifyMode } from './verify-mode.ts'
import type { Attached, Base, Clipboard, DayProse, ImageAttachment, PrintJob, SearchRequest } from '../../shared/ipc.ts'
import type { QueryId } from '../../shared/search-api.ts'
import type { Followed, Reference } from '../../shared/nav-api.ts'
import type { DocumentId } from '../../shared/document-api.ts'
import type { Windows } from './windows.ts'
import type { WindowReport } from '../../shared/ipc.ts'
import type { NavTarget } from '../../shared/pane-api.ts'
import type { RelPath } from '../w/layout.ts'
import type { UiState } from '../../shared/ui-state.ts'
import type { DateKey, DocumentPosition, Span, VersionId } from '../../shared/document-api.ts'

export { DocumentService }

/**
 * Wire what the services declare (D83).
 *
 * **Nothing here decides anything.** A service says which channels it answers
 * on; this walks the declarations and hands each to Electron. The duplicate
 * check is `claim`'s, so *each channel belongs to exactly one service* fails at
 * startup rather than being a sentence in a design document.
 *
 * This is the shape the seventy-four cases below are moving into, one service at
 * a time. What is left in `registerDocumentIpc` is what has not moved yet.
 */
function wire(services: readonly Serves[]): void {
  for (const [channel, served] of claim(services)) {
    // **Told or asked, and it has to be one or the other.** `ipcMain.handle` is
    // deaf to `ipcRenderer.send` and `ipcMain.on` cannot reply, so a channel
    // registered at the wrong door fails in total silence (`serves.ts`, `told`).
    if (served.told === true) {
      ipcMain.on(channel, (event, ...args: unknown[]) => {
        if (served.wantsAsker === true) served.answer(event.sender.id, ...args)
        else served.answer(...args)
      })
      continue
    }
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      // **The asker is a number, and only when asked for.** A service may not
      // import Electron, so the one thing it can be told about the caller is an
      // id — which is all anybody needs: it says *which window*, and a window is
      // what a search cursor belongs to.
      served.wantsAsker === true
        ? served.answer(event.sender.id, ...args)
        : served.answer(...args),
    )
  }
}

/** One service per notebook, one notebook per app. */
export function registerDocumentIpc(service: DocumentService): void {
  // **The extracted services first**, so a collision with a hand-written case
  // below shows up as Electron refusing a second handler for one channel rather
  // than as whichever silently won.
  wire(service.services())

  ipcMain.handle(CHANNEL.open, (_e, id?: DocumentId) => service.info(id))
  ipcMain.handle(CHANNEL.read, (_e, request: ReadRequest) => service.openWindow(request))
  ipcMain.handle(CHANNEL.edit, (_e, request: EditRequest) => service.edit(request))
  ipcMain.handle(CHANNEL.release, (_e, id: WindowId) => service.releaseWindow(id))
  ipcMain.handle(CHANNEL.extend, (_e, request: ExtendRequest) => service.extend(request))
  ipcMain.handle(CHANNEL.loadUiState, () => service.loadUiState())
  ipcMain.handle(CHANNEL.saveUiState, (_e, state: UiState) => service.saveUiState(state))
  ipcMain.handle(CHANNEL.anomalies, () => service.anomalies())
  ipcMain.handle(CHANNEL.setAnchor, (_e, at: DocumentPosition, name: string) =>
    service.setAnchor(at, name),
  )
  ipcMain.handle(CHANNEL.tag, (_e, span: Span, subject: string) => service.tag(span, subject))
  ipcMain.handle(CHANNEL.untag, (_e, span: Span, subject: string) => service.untag(span, subject))
  ipcMain.handle(CHANNEL.branch, (_e, span: Span, name: string) => service.branch(span, name))
  // Following a link is split in two on purpose: the service says WHERE it
  // points — a question about the notebook, answerable under plain node — and
  // the shell opens it, which is Electron's. See `DocumentService.linkTarget`.
  ipcMain.handle(CHANNEL.openLink, async (_e, target: string) => {
    const at = await service.linkTarget(target)
    if (at === null) return false
    return (await shell.openPath(at)) === ''
  })
  ipcMain.handle(CHANNEL.renameTag, (_e, span: Span, from: string, to: string) =>
    service.renameTag(span, from, to),
  )
  ipcMain.handle(CHANNEL.removeAnchor, (_e, name: string) => service.removeAnchor(name))
  ipcMain.handle(CHANNEL.print, (_e, job: PrintJob) => printPassage(service.notebookRoot, job))
  // An image into the corpus (R7). **Two doors, one act**: bytes that arrived
  // in the renderer — a paste, a drop — and a file chosen from a dialog, which
  // only main can open.
  ipcMain.handle(CHANNEL.linkBase, (_e, base: Base) => service.linkBase(base))
  ipcMain.handle(CHANNEL.attachImage, (_e, request: ImageAttachment) => service.attachImage(request))
  ipcMain.handle(CHANNEL.chooseImage, async (_e, base: Base): Promise<Attached | null> => {
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
    return service.attachImage({ base, name: basename(path, extname(path)), ext, bytes })
  })
  ipcMain.handle(CHANNEL.proseIn, (_e, from: DateKey, to: DateKey) => service.proseIn(from, to))

  // Search is `services/search-service.ts` now and declares its own channels —
  // including `searchOpen`, which is told which window asked, because a cursor
  // belongs to the window that opened it (D83).
  //
  // **The id is taken while the window is alive.** Reading `webContents.id`
  // inside `closed` reaches a destroyed object and throws — and the window that
  // found this was the hidden one printing makes, so the failure was a PDF that
  // came out fine and a main process that fell over on the way back.
  app.on('browser-window-created', (_event, created) => {
    const owner = created.webContents.id
    created.on('closed', () => service.searches.forget(owner))
  })

  // The sidebar is `services/nav-service.ts` now, and declares its own channels.
  //
  // **A window of days, asked for by the caller.** The full view wants months
  // and the compact strip wants a fortnight; what counts as *bearing down* is
  // the same computation either way, so only the window differs (D74).
  ipcMain.handle(CHANNEL.horizon, (_e, from: DateKey, to: DateKey) => service.agenda.horizon(from, to))

  /**
   * Follow a reference that leaves the app (D10's third and fourth kinds).
   *
   * **Split the same way link-following is**: the service says where it points,
   * which is a question about the notebook; the shell opens it, which is
   * Electron's. A reference the app should handle ITSELF — a bookmark, a
   * subject, a day — never arrives here, because going there is navigation and
   * not opening.
   */
  ipcMain.handle(CHANNEL.newDocument, (_e, label?: string, section?: string, kind?: 'markdown' | 'todo' | 'docket') =>
    service.newDocument(label, section, kind),
  )

  /**
   * A task somebody asked for, between the asking and the answer.
   *
   * **It spans two windows, which is why it lives here.** The words come from
   * a selection in one window; the item is made in another; and the link back
   * can only be written once the item exists, by which time the caret is
   * somewhere else entirely. Main is the only thing that can see both ends.
   */
  interface Capture {
    readonly text: string
    readonly wrap: boolean
    readonly origin: WebContents
  }
  let waiting: Capture | null = null
  let claimed: Capture | null = null

  // Dockets: declared by the service now, one arm per kind (D83).

  /**
   * Capture, which is a gesture between two windows (T13, D83).
   *
   * **Its own channel now, and it was on the task list's.** It produces a task,
   * which is why it lived there — but every step of it holds a `WebContents`, so
   * it belongs to this layer and not to a service; and while it shared a channel
   * with the list's verbs, that channel could not be wholly the list service's.
   */
  ipcMain.handle(CHANNEL.capture, async (e, command: CaptureCommand) => {
    switch (command.kind) {
      case 'capture': {
        // **Left for the list to pull.** Pushing at a window that may have been
        // created a millisecond ago races its renderer: `did-finish-load` is
        // not "React has mounted and subscribed". Something the list reads when
        // it arrives cannot be too early — the same level-rather-than-edge
        // shape the day boundary settled on (D62). Revealing is the caller's
        // next call, because windows are not this handler's to know about.
        waiting = { text: command.text, wrap: command.wrap, origin: e.sender }
        return service.todo.list()
      }
      case 'claim': {
        // **Only when there is something to take.** The list asks on arrival
        // AND on being revealed, and the second ask used to overwrite the live
        // claim with nothing — so by the time the row was committed there was
        // no one left to answer, and the link never came back. Asking twice is
        // meant to be free; it was destroying the thing it asked about.
        if (waiting === null) return null
        claimed = waiting
        waiting = null
        return { text: claimed.text }
      }
      case 'settle': {
        const capture = claimed
        claimed = null
        if (capture === null || capture.origin.isDestroyed()) return
        // **Back where the thought started, committed or abandoned.** The point
        // of the gesture is that a task reaches the list without costing you
        // the sentence you were in, so it ends by giving the sentence back.
        if (command.item !== null && capture.wrap) {
          capture.origin.send(CHANNEL.captured, command.item)
        }
        BrowserWindow.fromWebContents(capture.origin)?.focus()
        return
      }
    }
  })

  // The task list: declared by the service now, one arm per kind (D83).
  ipcMain.handle(CHANNEL.renameDocument, (_e, id: DocumentId, label: string) =>
    service.renameDocument(id, label),
  )
  ipcMain.handle(CHANNEL.duplicateDocument, (_e, id: DocumentId, label: string) =>
    service.duplicateDocument(id, label),
  )
  ipcMain.handle(CHANNEL.deleteDocument, (_e, id: DocumentId) => service.deleteDocument(id))
  ipcMain.handle(CHANNEL.navOpen, async (_e, reference: Reference, from?: RelPath): Promise<Followed> => {
    if (reference.kind === 'url') {
      await shell.openExternal(reference.href)
      return 'opened'
    }
    if (reference.kind === 'todo') {
      // **A task is a document in the corpus, so it opens like one** (D56).
      // Which day it is showing is the list's business, and it shows today —
      // the item's newest instance is what the item IS now. Landing on the
      // exact line is worth having and is not this milestone's.
      return { document: await service.todo.list() }
    }
    if (reference.kind !== 'file') return 'unsupported'

    // **A document in the corpus is this app's to open**, and the renderer is
    // told which one rather than being sent to the desktop. Handing it to the
    // OS would open it in some other editor — a different act wearing the same
    // gesture (D54).
    const document = await service.documentAt(reference.path, from)
    if (document !== null) return { document }

    const at = await service.linkTarget(reference.path, from)
    if (at === null) return 'missing'
    return (await shell.openPath(at)) === '' ? 'opened' : 'missing'
  })
  /**
   * Import whatever is on the clipboard.
   *
   * **The richest flavour is kept and the plainest is annotated.** A copy from
   * a browser or a word processor carries HTML as well as text; the HTML is
   * what a citation should point at, and the text is what a person wants to
   * write on. Converting HTML to markdown well is its own project, and doing it
   * badly would put a mangled approximation in the corpus while throwing the
   * good copy away.
   */
  // Main reads the clipboard because it is the only side that has one, and
  // hands it over whole. **The conversion happens in the renderer**, where
  // Chromium's HTML parser already is — doing it here would mean shipping a DOM
  // implementation to a process that has no use for one.
  ipcMain.handle(CHANNEL.readClipboard, (): Clipboard => ({
    text: clipboard.readText(),
    html: clipboard.readHTML(),
  }))

  ipcMain.handle(
    CHANNEL.importText,
    (_e, at: DocumentPosition, text: string, original: { content: string; ext: string }) =>
      service.importText(at, text, original),
  )

  // Reading the past is `services/history-service.ts` now (D32, D83).
  if (verifyMode()) ipcMain.handle('tephra:verify:diagnose', () => service.diagnose())

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
   * Verify mode only, and it gives back the previous contents so the scene can
   * put them back: clobbering a person's clipboard because they ran the tests
   * would be a rude way to fix a flaky check.
   */
  if (verifyMode()) {
    ipcMain.handle('tephra:verify:clipboard', (_e, next: Clipboard | null): Clipboard => {
      const had: Clipboard = { text: clipboard.readText(), html: clipboard.readHTML() }
      if (next !== null) {
        if (next.html !== '') clipboard.write({ text: next.text, html: next.html })
        else clipboard.writeText(next.text)
      }
      return had
    })
  }
  // The system's own picker, which knows every emoji and how to search them.
  // It types into whatever has focus, so the renderer focuses a field first.
  ipcMain.handle(CHANNEL.emojiPanel, () => {
    if (process.platform === 'darwin') app.showEmojiPanel()
    return process.platform === 'darwin'
  })
  ipcMain.handle(CHANNEL.undo, (_e, id?: DocumentId) => service.undo(id))
  ipcMain.handle(CHANNEL.redo, (_e, id?: DocumentId) => service.redo(id))
  ipcMain.handle(CHANNEL.flush, () => service.flush())
  ipcMain.handle(CHANNEL.spans, (_e, request: SpansRequest) => service.spans(request))
  ipcMain.handle(CHANNEL.resolveAnchor, (_e, name: string) => service.resolveAnchor(name))
  ipcMain.handle(CHANNEL.extent, () => service.extent())
  ipcMain.handle(CHANNEL.today, () => service.today)
  ipcMain.handle(CHANNEL.setZone, (_e, zone: string) => service.setZone(zone))
  // Asked on the way in as well as pushed: a window that opens between two
  // polls still has to know, and the alternative is re-broadcasting to everyone
  // every time anybody opens a window.
  ipcMain.handle(CHANNEL.zoneNotice, () => service.askZoneNotice())
  ipcMain.handle(CHANNEL.dismissZone, () => service.dismissZone())
}

/** Push messages to a renderer for as long as its window lives. */
/**
 * The window half of the bridge — `shell/frame-service.ts` declares it now.
 *
 * It is a service like any other, on the tier that may use Electron (D83). Its
 * four sender-taking verbs turned out to need only the window's **id**, which
 * `Windows` has always matched on, so no Electron object crosses the boundary.
 */
export function registerWindowIpc(windows: Windows, onImport: (id: DocumentId | null) => void): void {
  wire([new FrameService(windows, onImport)])
}

export function attachWindow(service: DocumentService, window: BrowserWindow): void {
  const detach = service.addSink({
    send: (channel, message) => {
      if (!window.isDestroyed()) window.webContents.send(channel, message)
    },
  })
  window.on('closed', detach)
}
