// Main process. Holds W (files, watcher) and — from the next milestone — X
// (Document, Corpus, History), per D37. The renderer holds Z and the live
// CodeMirror buffer, and nothing else.

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { clickMenuItem, installMenu, setMenuVim } from './menu.ts'
import { VERIFY_MODE, verifyEnv } from './verify-mode.ts'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { declareScheme, serveRenderer, APP_ORIGIN } from './scheme.ts'
import { Notebook } from './w/notebook.ts'
import { listThemes, saveTheme, seedThemes } from './w/themes.ts'
import type { Theme } from '../shared/theme.ts'
import { CHANNEL } from '../shared/ipc.ts'

// Before anything reads it. Electron takes the app name from package.json's
// `name` field, which is the npm package name — lower case, and not what
// belongs in a menu bar.
app.setName('Tephra')

if (VERIFY_MODE) {
  console.warn(
    'TEPHRA: verification mode is ON. Screenshot capture, menu automation, the ' +
      'oversized-window override and abrupt exit are all reachable. Never for ordinary use.',
  )
}
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


/**
 * Write a PNG of the window and quit. Every test in this project checks state,
 * which is why hand-testing found the invisible selection, the cut-off sheet and
 * the sans-serif Hebrew that no assertion could see (notes.md). The visual
 * milestone needs an instrument that looks at the pixels.
 */
async function captureAndQuit(win: BrowserWindow, to: string): Promise<void> {
  const delay = Number(verifyEnv('TEPHRA_SHOT_DELAY'))
  await new Promise(resolve => setTimeout(resolve, Number.isFinite(delay) && delay > 0 ? delay : 2_500))
  const image = await win.webContents.capturePage()
  await writeFile(to, image.toPNG())
  app.quit()
}

function createWindow(): BrowserWindow {
  // Width-dependent behaviour is the whole substance of D42 — the gutter folds
  // at one width, the capture stream is refused at another — and this desk's
  // display cannot produce the widths where those rules change. A window may be
  // larger than the screen it is on, so the acceptance harness sets this to
  // exercise branches that are otherwise unreachable here.
  const debugWidth = Number(verifyEnv('TEPHRA_WINDOW_WIDTH'))
  const oversize = Number.isFinite(debugWidth) && debugWidth > 0
  const win = new BrowserWindow({
    width: oversize ? debugWidth : 1400,
    height: 950,
    // macOS clamps a window to the display's work area, which silently turned a
    // request for 2000px into 1512px and made the harness report a refusal as
    // though the rule had been tested. This is the switch that lets the window
    // be bigger than the screen it is on.
    enableLargerThanScreen: oversize,
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

  win.once('ready-to-show', () => {
    win.show()
    const shot = verifyEnv('TEPHRA_SHOT')
    if (shot !== undefined && shot !== '') void captureAndQuit(win, shot)
  })

  // Temporary: surface the renderer's self-check, and exit when it finishes.
  if (verifyEnv('TEPHRA_VERIFY') !== undefined) {
    win.webContents.on('console-message', (_e, _level, message) => {
      if (!message.startsWith('VERIFY')) return
      console.log(message)
      if (message === 'VERIFY done') {
        setTimeout(() => {
          void win.webContents
            .capturePage()
            .then(img => writeFileSync(verifyEnv('TEPHRA_SHOT') ?? '/tmp/tephra-shot.png', img.toPNG()))
            .finally(() => {
              // GRACEFUL by default, so the harness exercises the real
              // shutdown — `before-quit` flushes and commits (D32), and a
              // harness that skipped it could never see session-end work.
              //
              // `TEPHRA_EXIT=abrupt` is the other half: app.exit() terminates
              // without running any of that, which is the closest thing to a
              // crash that can be arranged on purpose. The WAL exists for
              // exactly that case and will be tested through this lever.
              if (verifyEnv('TEPHRA_EXIT') === 'abrupt') app.exit(0)
              else app.quit()
            })
        }, 400)
      }
    })
  }

  // Anything that is not us opens in the real browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_ORIGIN)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const scene = verifyEnv('TEPHRA_VERIFY')
  const query = scene === undefined || scene === '' ? '' : `?verify=${encodeURIComponent(scene)}`
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
  const configuredRoot = process.env['TEPHRA_ROOT']
  notebook = await Notebook.open(configuredRoot === undefined ? {} : { root: configuredRoot })
  service = new DocumentService(notebook)
  registerDocumentIpc(service)

  // Seeded before the window opens, so the first launch already has a themes
  // directory to look at rather than an empty one that fills in later.
  await seedThemes(notebook)

  // AFTER seeding, so the first commit includes the themes it just wrote — and
  // before any window opens, so the reconciliation of whatever happened while
  // the app was closed lands before this session starts adding to it.
  await service.openHistory()
  ipcMain.handle(CHANNEL.listThemes, () => (notebook === null ? [] : listThemes(notebook)))
  ipcMain.handle(CHANNEL.saveTheme, (_e, theme: Theme) =>
    notebook === null ? undefined : saveTheme(notebook, theme),
  )

  // The renderer owns the vim setting — it is loaded from ui-state.json and
  // saved per device (D30). The menu's checkmark is a view of that, kept honest
  // by the renderer reporting it, never a second copy that could disagree.
  installMenu()
  ipcMain.on(CHANNEL.vimChanged, (_e, vim: boolean) => setMenuVim(vim === true))

  // Self-check only: lets a renderer scene pull a real menu item. Gated, because
  // nothing in the shipped app should be able to drive the menu bar.
  if (verifyEnv('TEPHRA_VERIFY') !== undefined) {
    ipcMain.handle('tephra:verify:menu', (_e, label: string) => clickMenuItem(label))
  }

  // D34's verification, in the environment that actually matters: not plain
  // Node but the BUNDLED main process, where electron-vite's CJS output and
  // Electron's own Node are what the library has to survive. Gated, and it
  // quits rather than opening a window.
  if (verifyEnv('TEPHRA_VERIFY_GIT') !== undefined) {
    const { verifyGit } = await import('./w/verify-git.ts')
    await verifyGit()
    app.quit()
    return
  }

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
