// Main process. Holds W (files, watcher) and — from the next milestone — X
// (Document, Corpus, History), per D37. The renderer holds Z and the live
// CodeMirror buffer, and nothing else.

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { declareScheme, serveRenderer, APP_ORIGIN } from './scheme.js'

const dirname = join(fileURLToPath(import.meta.url), '..')

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
      preload: join(dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Temporary self-check for the scaffold milestone: report what the renderer
  // actually got, so "served from the custom scheme" is verified rather than
  // assumed. Removed once the editor lands.
  if (process.env['TEPHRA_VERIFY']) {
    win.webContents.once('did-finish-load', async () => {
      const report = await win.webContents.executeJavaScript(
        `JSON.stringify({ origin: location.origin, protocol: location.protocol,
          secure: window.isSecureContext, bridge: typeof window.tephra,
          react: !!document.querySelector('.scaffold h1'),
          heading: document.querySelector('.scaffold h1')?.textContent })`,
      )
      console.log('VERIFY ' + report)
      // Plain ../ is normalised away by the URL parser before the handler sees
      // it, so it tests nothing. Percent-encoded traversal survives parsing and
      // is what the containment check actually exists for.
      for (const probe of ['../../../package.json', '%2e%2e/%2e%2e/%2e%2e/package.json']) {
        const r = await win.webContents.executeJavaScript(
          `fetch('tephra://app/${probe}').then(async r => 'status ' + r.status + ' len ' + (await r.text()).length, e => 'blocked: ' + e.message)`,
        )
        console.log(`VERIFY traversal [${probe}] -> ${r}`)
      }
      const ok = await win.webContents.executeJavaScript(
        `fetch('tephra://app/index.html').then(async r => 'status ' + r.status + ' len ' + (await r.text()).length, e => 'FAILED ' + e.message)`,
      )
      console.log('VERIFY normal fetch -> ' + ok)
    })
  }

  // Anything that is not us opens in the real browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_ORIGIN)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_SERVER) void win.loadURL(DEV_SERVER)
  else void win.loadURL(`${APP_ORIGIN}/index.html`)

  return win
}

ipcMain.handle('tephra:hello', () => ({
  version: process.versions.electron,
  origin: DEV_SERVER ?? APP_ORIGIN,
}))

app.whenReady().then(() => {
  if (!DEV_SERVER) serveRenderer(join(dirname, '../renderer'))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
