// Wiring the document service to Electron IPC. Nothing here does work.

import { ipcMain, shell, type BrowserWindow } from 'electron'
import { CHANNEL, type EditRequest, type ExtendRequest, type ReadRequest, type SpansRequest, type WindowId } from '../shared/ipc.ts'
import { DocumentService } from './document-service.ts'
import { printPassage } from './print.ts'
import type { PrintJob } from '../shared/ipc.ts'
import type { UiState } from '../shared/ui-state.ts'
import type { DocumentPosition, Span } from '../shared/document-api.ts'
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
