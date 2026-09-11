// Wiring the document service to Electron IPC. Nothing here does work.

import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from 'electron'
import { basename, extname } from 'node:path'
import { IMAGE_EXTENSIONS } from '../shared/ipc.ts'
import { readOutsideBytes } from './w/outside.ts'
import { CHANNEL, type DocketCommand, type EditRequest, type ExtendRequest, type ReadRequest, type SpansRequest, type WindowId, type TodoCommand } from '../shared/ipc.ts'
import { DocumentService } from './document-service.ts'
import { printPassage } from './print.ts'
import { verifyMode } from './verify-mode.ts'
import { Searches } from './searches.ts'
import type { Attached, Base, Clipboard, DayProse, ImageAttachment, PrintJob, SearchRequest } from '../shared/ipc.ts'
import type { QueryId } from '../shared/search-api.ts'
import type { Followed, Reference } from '../shared/nav-api.ts'
import type { CommentId } from '../shared/comments.ts'
import type { DocumentId } from '../shared/document-api.ts'
import type { Windows } from './windows.ts'
import type { WindowReport } from '../shared/ipc.ts'
import type { NavTarget } from '../shared/pane-api.ts'
import type { RelPath } from './w/layout.ts'
import type { UiState } from '../shared/ui-state.ts'
import type { DateKey, DocumentPosition, Span, VersionId } from '../shared/document-api.ts'

export { DocumentService }

/** One service per notebook, one notebook per app. */
export function registerDocumentIpc(service: DocumentService): void {
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

  // Search. **Three messages rather than one**, because the answer to a query
  // over twenty years is not a value (D65): `open` narrows and returns a handle,
  // `next` pulls as far as it must, `close` stops. The cursor lives in
  // `Searches`, keyed to the window that asked, so a window closing takes its
  // searches with it.
  const searches = new Searches(service.search)
  ipcMain.handle(CHANNEL.searchOpen, (e, request: SearchRequest) =>
    searches.open(e.sender.id, request),
  )
  ipcMain.handle(CHANNEL.searchNext, (_e, id: QueryId, count: number) => searches.next(id, count))
  ipcMain.handle(CHANNEL.searchClose, (_e, id: QueryId) => searches.close(id))
  // **The id is taken while the window is alive.** Reading `webContents.id`
  // inside `closed` reaches a destroyed object and throws — and the window that
  // found this was the hidden one printing makes, so the failure was a PDF that
  // came out fine and a main process that fell over on the way back.
  app.on('browser-window-created', (_event, created) => {
    const owner = created.webContents.id
    created.on('closed', () => searches.closeFor(owner))
  })

  // The sidebar. Every one of these is a question about the whole corpus, which
  // is why they go through the index rather than through the document (D52).
  ipcMain.handle(CHANNEL.navSubjects, () => service.index.subjects())
  ipcMain.handle(CHANNEL.navBookmarks, () => service.index.bookmarks())
  ipcMain.handle(CHANNEL.navTimeline, () => service.index.timeline())
  ipcMain.handle(CHANNEL.navLinks, () => service.links())
  ipcMain.handle(CHANNEL.navThreads, () => service.index.threads())
  ipcMain.handle(CHANNEL.navOccurrences, (_e, reference: Reference) =>
    service.index.occurrences(reference),
  )
  ipcMain.handle(CHANNEL.navStatus, () => service.index.status())
  ipcMain.handle(CHANNEL.navSections, () => service.sections.tree())
  ipcMain.handle(CHANNEL.navPin, (_e, reference: Reference, label: string, section?: string) =>
    service.sections.pin(reference, label, section),
  )
  ipcMain.handle(CHANNEL.navUnpin, (_e, reference: Reference, section?: string) =>
    service.sections.unpin(reference, section),
  )
  ipcMain.handle(CHANNEL.navRelabel, (_e, reference: Reference, label: string, section: string) =>
    service.sections.relabel(reference, label, section),
  )

  /**
   * Follow a reference that leaves the app (D10's third and fourth kinds).
   *
   * **Split the same way link-following is**: the service says where it points,
   * which is a question about the notebook; the shell opens it, which is
   * Electron's. A reference the app should handle ITSELF — a bookmark, a
   * subject, a day — never arrives here, because going there is navigation and
   * not opening.
   */
  ipcMain.handle(CHANNEL.navDocuments, () => service.documents())
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

  ipcMain.handle(CHANNEL.docket, async (_e, command: DocketCommand) => {
    switch (command.kind) {
      case 'list':
        return service.dockets()
      case 'matters':
        return service.docketMatters(command.docket)
      case 'add':
        return service.docketAdd(command.docket, command.name, command.when, command.section)
      case 'rename':
        return service.docketRename(command.docket, command.matter, command.name)
      case 'when':
        return service.docketSetWhen(command.docket, command.matter, command.when)
      case 'owner':
        return service.docketSetOwner(command.docket, command.matter, command.owner)
      case 'link':
        return service.docketSetLink(command.docket, command.matter, command.link)
      case 'tag':
        return service.docketTag(command.docket, command.matter, command.subject)
      case 'untag':
        return service.docketUntag(command.docket, command.matter, command.subject)
      case 'remove':
        return service.docketRemove(command.docket, command.matter)
      case 'notes':
        return service.docketSetNotes(command.docket, command.matter, command.notes)
      case 'addTrigger':
        return service.docketAddTrigger(
          command.docket, command.matter, command.offset, command.text, command.effect,
        )
      case 'removeTrigger':
        return service.docketRemoveTrigger(command.docket, command.matter, command.at)
      case 'sections':
        return service.docketSections(command.docket)
      case 'addSection':
        return service.docketAddSection(command.docket, command.name)
      case 'renameSection':
        return service.docketRenameSection(command.docket, command.name, command.to)
      case 'removeSection':
        return service.docketRemoveSection(command.docket, command.name)
      case 'place':
        return service.docketMoveMatter(
          command.docket, command.matter, command.section, command.before,
        )
      case 'nudge':
        return service.docketNudgeMatter(command.docket, command.matter, command.delta)
      case 'move':
        return service.docketMove(command.docket, command.matter, command.to)
    }
  })

  ipcMain.handle(CHANNEL.todo, async (e, command: TodoCommand) => {
    switch (command.kind) {
      case 'list':
        return service.todoList()
      case 'today':
        return service.todoToday(command.list)
      case 'items':
        return service.todoItems(command.list, command.date)
      case 'add':
        return service.todoAdd(command.list, command.text)
      case 'status':
        return service.todoSetStatus(command.list, command.item, command.status, command.note)
      case 'edit':
        return service.todoEdit(command.list, command.item, command.text)
      case 'notes':
        return service.todoSetNotes(command.list, command.item, command.notes)
      case 'remove':
        return service.todoRemove(command.list, command.item)
      case 'tags':
        return service.todoTags()
      case 'days':
        return service.todoDays(command.list)
      case 'resolved':
        return service.todoResolved()
      case 'backlog':
        return service.todoBacklog()
      case 'walk':
        return service.todoWalk(command.list, command.date)
      case 'finishWalk':
        return service.todoFinishWalk(command.list, command.date, command.drop)
      case 'capture': {
        // **Left for the list to pull.** Pushing at a window that may have been
        // created a millisecond ago races its renderer: `did-finish-load` is
        // not "React has mounted and subscribed". Something the list reads when
        // it arrives cannot be too early — the same level-rather-than-edge
        // shape the day boundary settled on (D62). Revealing is the caller's
        // next call, because windows are not this handler's to know about.
        waiting = { text: command.text, wrap: command.wrap, origin: e.sender }
        return service.todoList()
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
      return { document: await service.todoList() }
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

  ipcMain.handle(CHANNEL.versions, (_e, limit?: number) => service.versions(limit))
  ipcMain.handle(CHANNEL.readDay, (_e, version: VersionId, date: DateKey) =>
    service.readDay(version, date),
  )
  ipcMain.handle(CHANNEL.restore, (_e, version: VersionId) => service.restore(version))
  ipcMain.handle(CHANNEL.comments, () => service.comments())
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
  ipcMain.handle(CHANNEL.startComment, (_e, span: Span, body: string) => service.startComment(span, body))
  ipcMain.handle(CHANNEL.addComment, (_e, id: CommentId, body: string) => service.addComment(id, body))
  ipcMain.handle(CHANNEL.editComment, (_e, id: CommentId, i: number, body: string) =>
    service.editComment(id, i, body),
  )
  ipcMain.handle(CHANNEL.deleteComment, (_e, id: CommentId, i: number) => service.deleteComment(id, i))
  ipcMain.handle(CHANNEL.setCommentResolved, (_e, id: CommentId, on: boolean) =>
    service.setCommentResolved(id, on),
  )
  ipcMain.handle(CHANNEL.setCommentAssignee, (_e, id: CommentId, to: string | null) =>
    service.setCommentAssignee(id, to),
  )
  ipcMain.handle(CHANNEL.reactToComment, (_e, id: CommentId, i: number, emoji: string, on: boolean) =>
    service.reactToComment(id, i, emoji, on),
  )
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
/** The window half of the bridge: which window this is, and what it now shows. */
export function registerWindowIpc(windows: Windows, onImport: (id: DocumentId | null) => void): void {
  ipcMain.handle(CHANNEL.windowInfo, e => windows.infoFor(e.sender))
  ipcMain.on(CHANNEL.windowReport, (e, report: WindowReport) => windows.report(e.sender, report))
  ipcMain.handle(CHANNEL.windowCreate, (_e, target?: NavTarget) => {
    windows.open(target)
  })
  /**
   * Show something in a window of its own — the one that already has it, or a
   * new one. What ⌘0 and ⌘1 do, reachable by a renderer that has a reason.
   */
  ipcMain.handle(CHANNEL.windowReveal, (_e, target: NavTarget) => {
    const shown = windows.reveal(target)
    // Told, not left to notice: a window already open has no mount to react to,
    // and a hidden one — every window in verification mode — never sees focus.
    if (!shown.isDestroyed()) shown.webContents.send(CHANNEL.revealed)
  })
  ipcMain.handle(CHANNEL.windowClose, e => windows.close(e.sender))
  // The badge and the File menu reach the same act; main owns it either way.
  ipcMain.handle(CHANNEL.windowImport, e => onImport(windows.importableFor(e.sender)))
}

export function attachWindow(service: DocumentService, window: BrowserWindow): void {
  const detach = service.addSink({
    send: (channel, message) => {
      if (!window.isDestroyed()) window.webContents.send(channel, message)
    },
  })
  window.on('closed', detach)
}
