// Wiring the document service to Electron IPC. Nothing here does work.

import { app, clipboard, ipcMain, shell, type BrowserWindow } from 'electron'
import { CHANNEL, type EditRequest, type ExtendRequest, type ReadRequest, type SpansRequest, type WindowId } from '../shared/ipc.ts'
import { DocumentService } from './document-service.ts'
import { printPassage } from './print.ts'
import { verifyMode } from './verify-mode.ts'
import type { Clipboard, DayProse, PrintJob } from '../shared/ipc.ts'
import type { Reference } from '../shared/nav-api.ts'
import type { CommentId } from '../shared/comments.ts'
import type { UiState } from '../shared/ui-state.ts'
import type { DateKey, DocumentPosition, Span, VersionId } from '../shared/document-api.ts'
import { StreamDocument } from './x/stream-document.ts'

export { DocumentService }

/** One service per notebook, one notebook per app. */
export function registerDocumentIpc(service: DocumentService): void {
  ipcMain.handle(CHANNEL.open, () => service.info())
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
  ipcMain.handle(CHANNEL.proseIn, (_e, from: DateKey, to: DateKey) => service.proseIn(from, to))

  // The sidebar. Every one of these is a question about the whole corpus, which
  // is why they go through the index rather than through the document (D52).
  ipcMain.handle(CHANNEL.navSubjects, () => service.index.subjects())
  ipcMain.handle(CHANNEL.navBookmarks, () => service.index.bookmarks())
  ipcMain.handle(CHANNEL.navOutline, () => service.index.outline())
  ipcMain.handle(CHANNEL.navThreads, () => service.index.threads())
  ipcMain.handle(CHANNEL.navOccurrences, (_e, reference: Reference) =>
    service.index.occurrences(reference),
  )
  ipcMain.handle(CHANNEL.navStatus, () => service.index.status())
  ipcMain.handle(CHANNEL.navSections, () => service.sections.tree())

  /**
   * Follow a reference that leaves the app (D10's third and fourth kinds).
   *
   * **Split the same way link-following is**: the service says where it points,
   * which is a question about the notebook; the shell opens it, which is
   * Electron's. A reference the app should handle ITSELF — a bookmark, a
   * subject, a day — never arrives here, because going there is navigation and
   * not opening.
   */
  ipcMain.handle(CHANNEL.navOpen, async (_e, reference: Reference): Promise<string> => {
    if (reference.kind === 'url') {
      await shell.openExternal(reference.href)
      return 'opened'
    }
    if (reference.kind !== 'file') return 'unsupported'

    const at = await service.linkTarget(reference.path)
    if (at === null) return 'missing'
    // A markdown file in the corpus is a DOCUMENT, and opening one in the
    // editor waits on documents other than the stream (D27, M3.4). Handing it
    // to the OS instead would open it in some other editor, which is a
    // different act wearing the same gesture.
    if (at.endsWith('.md')) return 'unsupported'
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
  ipcMain.handle(CHANNEL.undo, () => service.undo())
  ipcMain.handle(CHANNEL.redo, () => service.redo())
  ipcMain.handle(CHANNEL.flush, () => service.flush())
  ipcMain.handle(CHANNEL.spans, (_e, request: SpansRequest) => service.spans(request))
  ipcMain.handle(CHANNEL.resolveAnchor, (_e, name: string) => service.resolveAnchor(name))
  ipcMain.handle(CHANNEL.extent, () => service.extent())
  ipcMain.handle(CHANNEL.today, () => StreamDocument.today())
}

/** Push messages to a renderer for as long as its window lives. */
export function attachWindow(service: DocumentService, window: BrowserWindow): void {
  const detach = service.addSink({
    send: (channel, message) => {
      if (!window.isDestroyed()) window.webContents.send(channel, message)
    },
  })
  window.on('closed', detach)
}
