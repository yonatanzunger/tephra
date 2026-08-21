// Main process. Holds W (files, watcher) and — from the next milestone — X
// (Document, Corpus, History), per D37. The renderer holds Z and the live
// CodeMirror buffer, and nothing else.

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { declareScheme, serveRenderer, APP_ORIGIN } from './scheme.ts'
import { Notebook } from './w/notebook.ts'
import { DocumentService, registerDocumentIpc, attachWindow } from './ipc.ts'

// app.getAppPath() rather than import.meta.url: the built main process is CJS,
// where import.meta does not exist, and this works in both.
const outDir = (...parts: string[]): string => join(app.getAppPath(), 'out', ...parts)

// Before app.whenReady, without exception.
declareScheme()

// In development electron-vite serves the renderer over HTTP so that HMR works.
// That is a dev-only exception to D17 and is bounded: the dev server carries the
// app bundle, never the corpus, which is only reachable through IPC and so only
// from a renderer with our preload attached. Production always uses the scheme.
const DEV_SERVER = process.env['ELECTRON_RENDERER_URL']

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 950,
    show: false,
    title: 'Tephra',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#faf9f8',
    webPreferences: {
      preload: outDir('preload', 'index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Temporary: surface the renderer's self-check, and exit when it finishes.
  if (process.env['TEPHRA_VERIFY']) {
    win.webContents.on('console-message', (_e, _level, message) => {
      if (!message.startsWith('VERIFY')) return
      console.log(message)
      if (message === 'VERIFY done') {
        setTimeout(() => {
          void win.webContents
            .capturePage()
            .then(img => writeFileSync(process.env['TEPHRA_SHOT'] ?? '/tmp/tephra-shot.png', img.toPNG()))
            .finally(() => app.exit(0))
        }, 400)
      }
    })
  }

  // Anything that is not us opens in the real browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_ORIGIN)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const query = process.env['TEPHRA_VERIFY'] ? '?verify=1' : ''
  if (DEV_SERVER) void win.loadURL(DEV_SERVER + query)
  else void win.loadURL(`${APP_ORIGIN}/index.html${query}`)

  return win
}

ipcMain.handle('tephra:hello', () => ({
  version: process.versions.electron,
  origin: DEV_SERVER ?? APP_ORIGIN,
}))

let notebook: Notebook | null = null
let service: DocumentService | null = null

app.whenReady().then(async () => {
  if (!DEV_SERVER) serveRenderer(outDir('renderer'))

  // X and W both live here (D37). The renderer holds Z and the live buffer,
  // and reaches everything else through the bridge.
  notebook = await Notebook.open({ root: process.env['TEPHRA_ROOT'] })
  service = new DocumentService(notebook)
  registerDocumentIpc(service)

  attachWindow(service, createWindow())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && service !== null) {
      attachWindow(service, createWindow())
    }
  })
})

// Quiesce before exit: flush, then release. Skipping the flush silently
// discards whatever has not reached a file yet.
app.on('before-quit', async event => {
  if (notebook === null) return
  event.preventDefault()
  const closing = notebook
  notebook = null
  try {
    await service?.stop()
  } finally {
    await closing.close()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
