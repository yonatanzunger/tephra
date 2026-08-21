// The only bridge between Z and X. Nothing here does work; it forwards.
//
// Callbacks cannot cross contextBridge, so events arrive on ipcRenderer here
// and are re-dispatched to handlers the renderer registered through this object.

import { contextBridge, ipcRenderer } from 'electron'
import { CHANNEL } from '../shared/ipc.ts'
import type {
  ChangeAck, DocumentInfo, EditAck, EditRequest, ExtendRequest, ReadRequest,
  SpansRequest, WindowChangedMessage, WindowId, WindowSnapshot,
} from '../shared/ipc.ts'
import type { DateKey, DocumentPosition, TypedSpan } from '../shared/document-api.ts'
import type { UiState } from '../shared/ui-state.ts'

type Handler<T> = (message: T) => void

const changedHandlers = new Set<Handler<WindowChangedMessage>>()
const resetHandlers = new Set<Handler<{ id: WindowId }>>()

ipcRenderer.on(CHANNEL.windowChanged, (_e, message: WindowChangedMessage) => {
  for (const handler of changedHandlers) handler(message)
})
ipcRenderer.on(CHANNEL.windowReset, (_e, message: { id: WindowId }) => {
  for (const handler of resetHandlers) handler(message)
})

const tephra = {
  hello: (): Promise<{ version: string; origin: string }> => ipcRenderer.invoke('tephra:hello'),

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
    extent: (): Promise<{ first: DateKey; last: DateKey } | null> => ipcRenderer.invoke(CHANNEL.extent),
    today: (): Promise<DateKey> => ipcRenderer.invoke(CHANNEL.today),

    onWindowChanged(handler: Handler<WindowChangedMessage>): () => void {
      changedHandlers.add(handler)
      return () => changedHandlers.delete(handler)
    },
    onWindowReset(handler: Handler<{ id: WindowId }>): () => void {
      resetHandlers.add(handler)
      return () => resetHandlers.delete(handler)
    },
  },
} as const

export type TephraBridge = typeof tephra

contextBridge.exposeInMainWorld('tephra', tephra)
