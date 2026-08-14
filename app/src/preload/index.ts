// The only bridge between Z and X. Nothing here does work; it forwards.
// Grows in the IPC-bridge milestone — for now it exists so the renderer can
// prove it is talking to a real main process.

import { contextBridge, ipcRenderer } from 'electron'

const tephra = {
  /** Which build this is, and whether the origin is the custom scheme. */
  hello: (): Promise<{ version: string; origin: string }> => ipcRenderer.invoke('tephra:hello'),
} as const

export type TephraBridge = typeof tephra

contextBridge.exposeInMainWorld('tephra', tephra)
