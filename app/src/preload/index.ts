// The only bridge between Z and X. Nothing here does work; it forwards.
//
// Callbacks cannot cross contextBridge, so events arrive on ipcRenderer here
// and are re-dispatched to handlers the renderer registered through this object.

import { contextBridge, ipcRenderer } from 'electron'
import type { Anomaly } from '../shared/anomalies.ts'
import type { SelectionState } from '../shared/commands.ts'
import type { Clipboard, DayProse, PrintJob } from '../shared/ipc.ts'
import type {
  IndexStatus, Located, OutlineNode, Reference, SectionTree, Subject, ThreadRow,
} from '../shared/nav-api.ts'
import type { CommentId, CommentThread } from '../shared/comments.ts'
import type { Theme } from '../shared/theme.ts'
import { CHANNEL } from '../shared/ipc.ts'
import type {
  ChangeAck, DocumentInfo, EditAck, EditRequest, ExtendRequest, ReadRequest,
  SpansRequest, WindowChangedMessage, WindowId, WindowSnapshot,
} from '../shared/ipc.ts'
import type { DateKey, Divergence, DocumentId, DocumentPosition, Span, TypedSpan, VersionId } from '../shared/document-api.ts'
import type { RestoreReport, Version } from '../shared/history-api.ts'
import type { UiState } from '../shared/ui-state.ts'

type Handler<T> = (message: T) => void

const changedHandlers = new Set<Handler<WindowChangedMessage>>()
const resetHandlers = new Set<Handler<{ id: WindowId }>>()
const divergedHandlers = new Set<Handler<Divergence>>()

ipcRenderer.on(CHANNEL.windowChanged, (_e, message: WindowChangedMessage) => {
  for (const handler of changedHandlers) handler(message)
})
ipcRenderer.on(CHANNEL.windowReset, (_e, message: { id: WindowId }) => {
  for (const handler of resetHandlers) handler(message)
})
ipcRenderer.on(CHANNEL.diverged, (_e, message: Divergence) => {
  for (const handler of divergedHandlers) handler(message)
})

const rangeHandlers = new Set<Handler<string>>()
ipcRenderer.on(CHANNEL.rangeCommand, (_e, id: string) => {
  for (const handler of rangeHandlers) handler(id)
})

const menuHandlers = new Set<Handler<string>>()
ipcRenderer.on(CHANNEL.menuCommand, (_e, command: string) => {
  for (const handler of menuHandlers) handler(command)
})

const vimHandlers = new Set<Handler<boolean>>()
ipcRenderer.on(CHANNEL.setVim, (_e, value: boolean) => {
  for (const handler of vimHandlers) handler(value)
})

const tephra = {
  hello: (): Promise<{ version: string; origin: string; author: string }> =>
    ipcRenderer.invoke('tephra:hello'),
  /** What the clipboard holds. Converting it is the renderer's job. */
  readClipboard: (): Promise<Clipboard> => ipcRenderer.invoke(CHANNEL.readClipboard),
  /** Open the system's emoji picker. It types into whatever has focus. */
  emojiPanel: (): Promise<boolean> => ipcRenderer.invoke(CHANNEL.emojiPanel),
  /** Follow a link found in the text. Main decides whether it may be followed. */
  openLink: (target: string): Promise<boolean> => ipcRenderer.invoke(CHANNEL.openLink, target),
  /** Self-check only. What each window holds, for comparing against main. */
  diagnose: (): Promise<unknown> => ipcRenderer.invoke('tephra:verify:diagnose'),
  /** Verify only: seed the clipboard, and get back what was on it. */
  setClipboard: (next: Clipboard | null): Promise<Clipboard> =>
    ipcRenderer.invoke('tephra:verify:clipboard', next),
  /** Self-check only; the handler exists only when TEPHRA_VERIFY is set. */
  clickMenu: (label: string): Promise<boolean> => ipcRenderer.invoke('tephra:verify:menu', label),

  /**
   * The sidebar's half of the world (D51): what the corpus contains, and where.
   *
   * Its own namespace rather than more of `doc`, because these are questions
   * about the CORPUS — a bookmark in a note is a legitimate answer, and no
   * document is holding that note open.
   */
  nav: {
    subjects: (): Promise<readonly Subject[]> => ipcRenderer.invoke(CHANNEL.navSubjects),
    bookmarks: (): Promise<readonly { name: string; at: Located }[]> =>
      ipcRenderer.invoke(CHANNEL.navBookmarks),
    outline: (): Promise<readonly OutlineNode[]> => ipcRenderer.invoke(CHANNEL.navOutline),
    threads: (): Promise<readonly ThreadRow[]> => ipcRenderer.invoke(CHANNEL.navThreads),
    occurrences: (reference: Reference): Promise<readonly Located[]> =>
      ipcRenderer.invoke(CHANNEL.navOccurrences, reference),
    status: (): Promise<IndexStatus> => ipcRenderer.invoke(CHANNEL.navStatus),
    /** The curated half: sections, resolved into a tree (D53). */
    sections: (): Promise<SectionTree> => ipcRenderer.invoke(CHANNEL.navSections),
  },

  doc: {
    open: (): Promise<DocumentInfo> => ipcRenderer.invoke(CHANNEL.open),
    read: (request: ReadRequest): Promise<WindowSnapshot> => ipcRenderer.invoke(CHANNEL.read, request),
    edit: (request: EditRequest): Promise<EditAck> => ipcRenderer.invoke(CHANNEL.edit, request),
    release: (id: WindowId): Promise<void> => ipcRenderer.invoke(CHANNEL.release, id),
    extend: (request: ExtendRequest): Promise<void> => ipcRenderer.invoke(CHANNEL.extend, request),
    loadUiState: (): Promise<UiState> => ipcRenderer.invoke(CHANNEL.loadUiState),
    saveUiState: (state: UiState): Promise<void> => ipcRenderer.invoke(CHANNEL.saveUiState, state),
    undo: (): Promise<ChangeAck> => ipcRenderer.invoke(CHANNEL.undo),
    redo: (): Promise<ChangeAck> => ipcRenderer.invoke(CHANNEL.redo),
    flush: (): Promise<void> => ipcRenderer.invoke(CHANNEL.flush),
    spans: (request: SpansRequest): Promise<readonly TypedSpan[]> => ipcRenderer.invoke(CHANNEL.spans, request),
    resolveAnchor: (name: string): Promise<DocumentPosition | null> =>
      ipcRenderer.invoke(CHANNEL.resolveAnchor, name),
    setAnchor: (at: DocumentPosition, name: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.setAnchor, at, name),
    tag: (span: Span, subject: string): Promise<void> => ipcRenderer.invoke(CHANNEL.tag, span, subject),
    untag: (span: Span, subject: string): Promise<void> => ipcRenderer.invoke(CHANNEL.untag, span, subject),
    branch: (span: Span, name: string): Promise<DocumentId> => ipcRenderer.invoke(CHANNEL.branch, span, name),
    renameTag: (span: Span, from: string, to: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.renameTag, span, from, to),
    removeAnchor: (name: string): Promise<void> => ipcRenderer.invoke(CHANNEL.removeAnchor, name),
    print: (request: PrintJob): Promise<boolean> => ipcRenderer.invoke(CHANNEL.print, request),
    /** Every written day in a range, as prose: what the whole-document print reads. */
    proseIn: (from: DateKey, to: DateKey): Promise<readonly DayProse[]> =>
      ipcRenderer.invoke(CHANNEL.proseIn, from, to),

    /** Store the original untouched and put a copy at this point (R28, D47). */
    importText: (
      at: DocumentPosition,
      text: string,
      original: { content: string; ext: string },
    ): Promise<string> => ipcRenderer.invoke(CHANNEL.importText, at, text, original),
    /** The durable half: commits, and what a day looked like at one (D32). */
    versions: (limit?: number): Promise<readonly Version[]> =>
      ipcRenderer.invoke(CHANNEL.versions, limit),
    readDay: (version: VersionId, date: DateKey): Promise<string | null> =>
      ipcRenderer.invoke(CHANNEL.readDay, version, date),
    restore: (version: VersionId): Promise<RestoreReport> =>
      ipcRenderer.invoke(CHANNEL.restore, version),
    comments: (): Promise<readonly CommentThread[]> => ipcRenderer.invoke(CHANNEL.comments),
    startComment: (span: Span, body: string): Promise<CommentId> =>
      ipcRenderer.invoke(CHANNEL.startComment, span, body),
    addComment: (id: CommentId, body: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.addComment, id, body),
    editComment: (id: CommentId, index: number, body: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.editComment, id, index, body),
    deleteComment: (id: CommentId, index: number): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.deleteComment, id, index),
    setCommentResolved: (id: CommentId, resolved: boolean): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.setCommentResolved, id, resolved),
    setCommentAssignee: (id: CommentId, to: string | null): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.setCommentAssignee, id, to),
    reactToComment: (id: CommentId, index: number, emoji: string, on: boolean): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.reactToComment, id, index, emoji, on),
    extent: (): Promise<{ first: DateKey; last: DateKey } | null> => ipcRenderer.invoke(CHANNEL.extent),
    today: (): Promise<DateKey> => ipcRenderer.invoke(CHANNEL.today),

    anomalies: (): Promise<readonly Anomaly[]> => ipcRenderer.invoke(CHANNEL.anomalies),
    listThemes: (): Promise<readonly Theme[]> => ipcRenderer.invoke(CHANNEL.listThemes),
    saveTheme: (theme: Theme): Promise<void> => ipcRenderer.invoke(CHANNEL.saveTheme, theme),

    /** Tell the menu what vim is set to, so its checkmark is a view and not a copy. */
    vimChanged: (vim: boolean): void => ipcRenderer.send(CHANNEL.vimChanged, vim),
    onSetVim(handler: Handler<boolean>): () => void {
      vimHandlers.add(handler)
      return () => vimHandlers.delete(handler)
    },
    onMenuCommand(handler: Handler<string>): () => void {
      menuHandlers.add(handler)
      return () => menuHandlers.delete(handler)
    },

    /** What the caret is doing, so the menus can grey correctly. */
    selectionChanged: (selection: SelectionState): void =>
      ipcRenderer.send(CHANNEL.selectionChanged, selection),
    /** Ask main to pop the native context menu at the pointer. */
    contextMenu: (): void => ipcRenderer.send(CHANNEL.contextMenu),
    onRangeCommand(handler: Handler<string>): () => void {
      rangeHandlers.add(handler)
      return () => rangeHandlers.delete(handler)
    },

    onWindowChanged(handler: Handler<WindowChangedMessage>): () => void {
      changedHandlers.add(handler)
      return () => changedHandlers.delete(handler)
    },
    onWindowReset(handler: Handler<{ id: WindowId }>): () => void {
      resetHandlers.add(handler)
      return () => resetHandlers.delete(handler)
    },
    /** A day changed on disk while it had unsaved edits. Surfaced, never resolved (D12). */
    onDiverged(handler: Handler<Divergence>): () => void {
      divergedHandlers.add(handler)
      return () => divergedHandlers.delete(handler)
    },
  },
} as const

export type TephraBridge = typeof tephra

contextBridge.exposeInMainWorld('tephra', tephra)
