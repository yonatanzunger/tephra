// Main process. Holds W (files, watcher) and — from the next milestone — X
// (Document, Corpus, History), per D37. The renderer holds Z and the live
// CodeMirror buffer, and nothing else.

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { clickMenuItem, installMenu, popRangeMenu, setMenuSelection } from './menu.ts'
import { verifyMode, verifyEnv } from './verify-mode.ts'
import { author } from './x/comments.ts'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { declareScheme, serveRenderer, APP_ORIGIN } from './scheme.ts'
import { Notebook, type OpenOptions } from './w/notebook.ts'
import { LockHeldError } from './w/lock.ts'
import { deleteTheme, listThemes, saveTheme, seedThemes } from './w/themes.ts'
import type { Theme } from '../shared/theme.ts'
import { CHANNEL } from '../shared/ipc.ts'
import { isOutside, type DocumentId } from '../shared/document-api.ts'
import type { SelectionState } from '../shared/commands.ts'

// Before anything reads it. Electron takes the app name from package.json's
// `name` field, which is the npm package name — lower case, and not what
// belongs in a menu bar.
app.setName('Tephra')

// **In a test run, an uncaught exception should END the run, not block it.**
// Electron's default is a native modal dialog, which in a headless acceptance
// run is a window nobody can dismiss: the harness waits out its whole timeout
// and reports "timed out" for what was actually a stack trace. Gated, because
// in the shipped app the dialog is the right answer — somebody is there to read
// it, and swallowing a crash would be worse than showing one.
if (verifyMode()) {
  process.on('uncaughtException', error => {
    try {
      console.error(`TEPHRA: uncaught exception in main: ${error.stack ?? String(error)}`)
    } catch {
      // Even this can fail once the pipe is gone; exiting is still right.
    }
    app.exit(1)
  })
}

if (verifyMode()) {
  console.warn(
    'TEPHRA: verification mode is ON. Screenshot capture, menu automation, the ' +
      'oversized-window override and abrupt exit are all reachable. Never for ordinary use.',
  )
}
import { DocumentService, registerDocumentIpc, registerWindowIpc } from './ipc.ts'
import { Windows } from './windows.ts'

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

/** How many windows this process has made, so the first one can be told apart. */
let windowsMade = 0

/**
 * Print a line for the harness, and never die trying.
 *
 * **A diagnostic must not be able to crash the app.** `console.log` writes to a
 * pipe, and the pipe is gone once the harness has stopped reading — it killed
 * the child, or the run ended and the process is on its way out. The write then
 * throws EPIPE from inside an event handler, which is an UNCAUGHT exception,
 * which Electron puts on screen as a native error dialog.
 *
 * A set of windows made it easy to reach: they all forward, and the first one's
 * `VERIFY done` ends the run while the others are still talking (MC6).
 */
function forward(message: string): void {
  try {
    console.log(message)
  } catch {
    // The harness stopped listening. That is the end of the run, not a fault.
  }
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
    // **Explicit because the suites depend on it.** A window that is never
    // shown still runs its renderer and still paints while this is true; with
    // it false, an acceptance run would go quiet in a way that looks like the
    // app hanging rather than like a setting.
    paintWhenInitiallyHidden: true,
    title: 'Tephra',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#faf9f8',
    webPreferences: {
      preload: outDir('preload', 'index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // **Only in verification mode, and only because the window is hidden.**
      // Chromium throttles timers in a page nobody is looking at — to once a
      // second after ten seconds, and once a minute after five — which is
      // right for an app and wrong for a harness: a scene is a chain of
      // `setTimeout`s in a window that is deliberately never shown, so the
      // throttle applies for its whole run and the longest scene is the first
      // to reach its timeout under load.
      //
      // Left ON in ordinary use, where a backgrounded notebook has nothing to
      // do and the battery is worth more than its timers.
      backgroundThrottling: !verifyMode(),
    },
  })

  win.once('ready-to-show', () => {
    // **In verification mode the window is not shown at all.**
    //
    // It used to appear without taking focus, which solved half the problem:
    // an acceptance run opens a real, focusable editor, and a person working
    // while it runs had their keystrokes captured by it — typed into the
    // notebook under test, changing the thing being asserted about. That
    // produced a run reporting three failures that never reproduced.
    //
    // The other half is that four suites take minutes and put a window on the
    // desk for every launch, which makes the machine unusable while they run.
    // A hidden window still lays out, still paints and still photographs
    // (`paintWhenInitiallyHidden`), so nothing is given up by not showing it —
    // **which is what makes this a better default and not a compromise.**
    //
    // `TEPHRA_SHOW` puts it back, for when the thing you want IS to watch.
    if (!verifyMode()) win.show()
    else if (verifyEnv('TEPHRA_SHOW') !== undefined) win.showInactive()
    const shot = verifyEnv('TEPHRA_SHOT')
    // **Not while a scene is running**, and this raced for a long time before
    // anybody noticed. There are two ways a screenshot gets taken: this timer,
    // and the `VERIFY done` handler below. With a scene set, the timer wins
    // whenever the scene takes longer than `TEPHRA_SHOT_DELAY` — which is
    // 2.5 seconds by default — and `captureAndQuit` then quits the app in the
    // MIDDLE of the scene. The scene stops mid-sentence with no error, which
    // reads exactly like a hang and was chased as one.
    //
    // So the timer is for screenshotting a window with no scene driving it.
    // When there is a scene, `done` is the moment to photograph and the only
    // one that means anything.
    //
    // One file per window: with a set of them, a single path means the last
    // one to finish overwrites the others, and a window that came up blank is
    // exactly the one you would never see (MC6).
    if (shot !== undefined && shot !== '' && verifyEnv('TEPHRA_VERIFY') === undefined) {
      void captureAndQuit(win, windowsMade <= 1 ? shot : shot.replace(/\.png$/, `-${windowsMade}.png`))
    }
  })

  // Temporary: surface the renderer's self-check, and exit when it finishes.
  //
  // **Every window's output is forwarded; only the FIRST one's `done` quits.**
  // A scene that opens a second window gets a second renderer running the same
  // scene, and letting either of them end the run would cut the first one off
  // mid-sentence (MC6).
  if (verifyEnv('TEPHRA_VERIFY') !== undefined) {
    // Counted, not measured: `win` is already in `getAllWindows()` by the time
    // this runs, so asking how many there are always said "not the first".
    const primary = ++windowsMade === 1
    /** A scene that asked for its picture has had it; `done` must not retake. */
    let shotTaken = false
    /**
     * Photograph this window.
     *
     * **`stayHidden` is what makes a hidden window composite at all.** Electron
     * says it plainly: *the page is considered visible when its browser window
     * is hidden and the capturer count is non-zero*. Without it a hidden window
     * hands back whatever it last painted. `stayAwake` for the same reason one
     * step up — a throttled renderer can be asleep when the shutter opens.
     */
    const take = (): Promise<void> =>
      win.webContents
        .capturePage(undefined, { stayHidden: true, stayAwake: true })
        .then(img => writeFileSync(verifyEnv('TEPHRA_SHOT') ?? '/tmp/tephra-shot.png', img.toPNG()))
        .catch(() => undefined)
    win.webContents.on('console-message', (_e, _level, message) => {
      if (!message.startsWith('VERIFY')) return
      forward(message)
      // **The scene says when the picture is worth taking.** Capturing after
      // `done` looked right and was not: a scene ends, and then the app goes on
      // being an app — in one case navigating the pane away a second later, so
      // every shot was of a surface the scene had left. `VERIFY shot` is the
      // scene pointing at the moment it means, which is the only moment anybody
      // wants; `done` still captures if a scene never asked, so old scenes are
      // unaffected.
      if (message === 'VERIFY shot' && primary && !shotTaken) {
        shotTaken = true
        void take()
      }
      if (message === 'VERIFY done' && primary) {
        setTimeout(() => {
          // A scene that pointed at its moment has had its picture; this is the
          // fallback for one that never asked.
          const shot = shotTaken ? Promise.resolve() : take()
          void shot.finally(() => {
            // GRACEFUL by default, so the harness exercises the real shutdown —
            // `before-quit` flushes and commits (D32), and a harness that
            // skipped it could never see session-end work.
            //
            // `TEPHRA_EXIT=abrupt` is the other half: app.exit() terminates
            // without running any of that, which is the closest thing to a
            // crash that can be arranged on purpose. The WAL exists for exactly
            // that case and will be tested through this lever.
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

/**
 * File ▸ Open…, which is the system's dialog and not one of ours.
 *
 * **A picker is a thing people already know how to use**, with their recents,
 * their favourites, search and a path they can type. An in-app list of the
 * corpus is a different gesture — a quick switcher — and giving it this menu
 * item's name was the mistake: it looked like Open… and behaved like neither.
 *
 * Rooted at the notebook, because that is where a person's documents are, and
 * filtered to markdown, because that is what a document is.
 *
 * **A file outside the notebook opens READ-ONLY** rather than being refused.
 * Downloading something and wanting to read it here — and take a paragraph out
 * of it — is an ordinary thing to want, and it costs nothing: the document
 * layer can read anything. What it cannot do is keep its promises about a file
 * it does not manage, so the window says so and offers the gesture that fixes
 * it, which is import (MC6).
 */
async function openDocument(inNewWindow: boolean): Promise<void> {
  if (service === null) return
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const picked = await dialog.showOpenDialog({
    title: inNewWindow ? 'Open in a new window' : 'Open',
    defaultPath: service.notebookRoot,
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  const path = picked.filePaths[0]
  if (picked.canceled || path === undefined) return

  const id = await service.documentForFile(path)
  if (id === null) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'Tephra cannot open that file.',
      detail: 'It opens markdown documents — files ending in .md.',
      buttons: ['OK'],
    })
    return
  }

  if (inNewWindow) windows?.open({ kind: 'document', id })
  else parent?.webContents.send(CHANNEL.openDocument, id)
}

/**
 * A new document, in a window of its own.
 *
 * **Named later, and real immediately.** It is `notes/untitled.md` from the
 * first keystroke — versioned, journalled, recoverable — because Tephra has no
 * unsaved state and the newest thing is the worst one to be able to lose. The
 * name is the only part deferred, which is right: it is the part you do not
 * know before writing the thing.
 */
/**
 * The task list, in its own window.
 *
 * `todoList()` makes it if there is not one yet: a notebook that has never had
 * a task list should not carry an empty directory for one, and asking to see it
 * is a good moment to decide you have one (T1).
 */
async function showTasks(): Promise<void> {
  if (service === null) return
  windows?.reveal({ kind: 'document', id: await service.todoList() })
}

/**
 * Reorient, from anywhere (H11).
 *
 * **Main's, because the list may not be the window you are in.** The offer at
 * the day boundary is the list looking different, which only helps somebody
 * already looking at it; the whole point of an on-demand entrance is that it
 * works while you are writing — so this brings the list forward and then asks it
 * to begin, in that order, because the window has to exist before it can hear.
 */
async function reorient(): Promise<void> {
  if (service === null) return
  const win = windows?.reveal({ kind: 'document', id: await service.todoList() })
  win?.webContents.send(CHANNEL.menuCommand, 'reorient')
}

async function newDocument(kind: 'markdown' | 'todo' | 'docket' = 'markdown'): Promise<void> {
  if (service === null) return
  windows?.open({ kind: 'document', id: await service.newDocument(undefined, undefined, kind) })
}

/**
 * Import: bring a file in, and go to the copy.
 *
 * Two ways in, one act. `Import…` asks which file; `Import` acts on what the
 * focused window is already showing, which is why the read-only indicator is a
 * button — the file is in front of you and the gesture is right there (MC6).
 */
async function importDocument(pick: boolean, asked?: DocumentId | null): Promise<void> {
  if (service === null) return
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

  let id: DocumentId | null = null
  if (pick) {
    const picked = await dialog.showOpenDialog({
      title: 'Import into the notebook',
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    const path = picked.filePaths[0]
    if (picked.canceled || path === undefined) return
    id = await service.documentForFile(path)
  } else {
    // What the ASKING window is showing when a window asked, and the focused
    // one when the menu did. A window knows which it is; a menu does not.
    id = asked ?? windows?.importable() ?? null
  }

  if (id === null) {
    // Parented, so it is a sheet on the window it is about rather than an
    // app-modal box that blocks the whole process — including, once, a test
    // run that then sat there until it timed out.
    if (parent !== undefined) {
      await dialog.showMessageBox(parent, {
        type: 'info',
        message: 'There is nothing to import.',
        detail: 'Import brings a file from outside the notebook in. This one is already inside it.',
        buttons: ['OK'],
      })
    }
    return
  }

  const brought = await service.importFile(id)
  parent?.webContents.send(CHANNEL.openDocument, brought)
}



ipcMain.handle('tephra:hello', () => ({
  version: process.versions.electron,
  origin: DEV_SERVER ?? APP_ORIGIN,
  // Who is writing. A name in a file, not an identity claim — the margin needs
  // it to tell your own reactions from anyone else's.
  author: author(),
}))

let notebook: Notebook | null = null
let service: DocumentService | null = null
let windows: Windows | null = null

/**
 * Open the notebook, and ASK if somebody appears to have it.
 *
 * **The lock's staleness test is good and cannot be perfect.** Liveness is
 * decided by pid, and pids are recycled — so a lock left by a crash can be
 * inherited by an unrelated process and read as held forever. Until now the
 * error from that escaped `whenReady` unhandled, which is both symptoms
 * reported: a stack trace from `run.sh`, and a packaged app that came up with
 * no notebook behind it and every surface broken.
 *
 * Neither the guard nor a cleverer test is the answer. **The person knows
 * whether they have another Tephra open**, and nothing else does — so the app
 * asks, in a native dialog, because there is no window yet and this has to work
 * when nothing else can start.
 */
/**
 * Run without taking the lock at all — `TEPHRA_NO_LOCK=1`, or `--no-lock`.
 *
 * **Development only**, because the lock is not optional (format-spec): two
 * processes over one directory fight over the WAL and the fold, and the failure
 * mode is corruption rather than an error. A packaged build must never be
 * startable without one, which is the same gate `verifyMode` uses and for the
 * same reason.
 *
 * What it is FOR: looking at your real notebook with a second copy while the
 * first is running it. That is a thing a person does while building this, and
 * the honest trade is theirs to make — so it is a switch you throw rather than
 * something inferred.
 */
function noLock(): boolean {
  return !app.isPackaged && process.env['TEPHRA_NO_LOCK'] === '1'
}

async function openTheNotebook(options: OpenOptions): Promise<Notebook | null> {
  if (noLock()) {
    console.log('TEPHRA: --no-lock \u2014 running without the single-instance guard.')
    return Notebook.open({ ...options, lock: false })
  }
  try {
    return await Notebook.open(options)
  } catch (err) {
    if (!(err instanceof LockHeldError)) throw err

    /**
     * **Never a dialog in verification, and never a seizure either.**
     *
     * A scene that stops on a modal reads as a hang, so verification cannot
     * ask — that part of D64 stands. What it used to do instead was *take* the
     * lock, and that was wrong: it meant running any scene against the real
     * notebook killed the copy of Tephra you were using, which is a foot-gun
     * pointed at the one notebook that matters.
     *
     * The justification was orphaned verify runs holding locks. It does not
     * hold up — every acceptance scene gets its own fresh temporary notebook,
     * so an orphan holds a *different* lock and was never in the way. Running
     * without one is both safer and sufficient: the suite proceeds, and
     * whatever is already open keeps the notebook.
     */
    if (verifyMode()) {
      console.log(
        `TEPHRA: verification mode \u2014 pid ${err.holder.pid} holds this notebook; ` +
          'running without the guard rather than taking it.',
      )
      return Notebook.open({ ...options, lock: false })
    }

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Open Anyway', 'Quit'],
      defaultId: 1,
      cancelId: 1,
      message: 'This notebook is already open.',
      detail:
        `Another copy of Tephra (process ${err.holder.pid} on ${err.holder.host}) has held it ` +
        `since ${err.holder.since}.\n\n` +
        'If that copy is still running, opening this one will take the notebook away from it and ' +
        'it will stop and ask you to quit. If it crashed, or the process number now belongs to ' +
        'something else, opening anyway is safe.',
    })
    if (response === 1) return null
    return Notebook.open({ ...options, seize: true })
  }
}

app.whenReady().then(async () => {
  // **A thunk for the notebook's root**, because the handler is registered
  // before a notebook exists and the corpus's own files are served through it
  // (R7). In the dev server the renderer comes from Vite, so only the notebook
  // host is ours to answer — which is why this is registered either way.
  serveRenderer(outDir('renderer'), () => service?.notebookRoot ?? null)

  // X and W both live here (D37). The renderer holds Z and the live buffer,
  // and reaches everything else through the bridge.
  const configuredRoot = process.env['TEPHRA_ROOT']
  const opened = await openTheNotebook(configuredRoot === undefined ? {} : { root: configuredRoot })
  // The person said quit. Nothing has started; there is nothing to unwind.
  if (opened === null) {
    app.exit(0)
    return
  }
  notebook = opened
  // The file tier's quiescence is supplied HERE rather than read there:
  // reading it goes through the verify gate, which imports Electron, and
  // `DocumentService` is deliberately free of Electron so that three
  // integration suites can drive it under plain node. That has now been broken
  // three times by three different imports; `tests/unit/main/no-electron.test.ts`
  // is what stops the fourth.
  const quiesce = Number(verifyEnv('TEPHRA_QUIESCE_MS'))
  service = new DocumentService(
    notebook,
    Number.isFinite(quiesce) && quiesce > 0 ? { quiesceMs: quiesce } : {},
  )
  registerDocumentIpc(service)

  // Seeded before the window opens, so the first launch already has a themes
  // directory to look at rather than an empty one that fills in later.
  // BEFORE anything else touches the corpus: replay whatever the last session
  // did not manage to write. Opening a window first would show the reader a
  // document missing its final seconds, and then change it under them.
  const recovered = await service.recover()
  if (recovered > 0) console.log(`Tephra: recovered ${recovered} unsaved edit(s) from the log`)

  // **And at startup, because the app is not running at midnight most nights**
  // (H5). The boundary tick is the one that fires while somebody is at the
  // desk; this is the one that catches up after a weekend, a holiday, or a
  // laptop that was shut. Running both is safe because the tick is a
  // reconciliation rather than an event: it asks what should be true and makes
  // it so, so a month away converges on one task rather than thirty.
  //
  // **After recovery and before any window**, so that what a reader first sees
  // is the notebook as it should be rather than as it was a week ago, changing
  // under them a second later.
  const ticked = await service.reconcile().catch(() => ({ made: [], withdrawn: [] }))
  if (ticked.made.length > 0) console.log(`Tephra: ${ticked.made.length} task(s) from dockets`)

  // **The other half of taking over: being taken from.** Once another Tephra
  // has the notebook, this one must stop before it writes — so the tiers are
  // stopped first and the telling comes second. `Notebook.write` refuses on its
  // own as well, because "stop the timers" is the tidy half and a write that
  // slips through while it happens is the half that costs a corpus.
  ipcMain.on(CHANNEL.quit, () => app.exit(0))

  notebook.onLost(() => {
    void service?.stop()
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNEL.notebookLost)
    // A native dialog too, because a window may be mid-reload or may never have
    // finished loading, and this is the one message that must always arrive.
    void dialog
      .showMessageBox({
        type: 'error',
        buttons: ['Quit'],
        defaultId: 0,
        message: 'Another copy of Tephra has taken over this notebook.',
        detail:
          'This window has stopped saving so the two copies cannot write over each other. ' +
          'Anything typed since it stopped is still on screen and has not been written.',
      })
      .then(() => app.exit(0))
  })

  await seedThemes(notebook)

  // AFTER seeding, so the first commit includes the themes it just wrote — and
  // before any window opens, so the reconciliation of whatever happened while
  // the app was closed lands before this session starts adding to it.
  await service.openHistory()
  ipcMain.handle(CHANNEL.listThemes, () => (notebook === null ? [] : listThemes(notebook)))
  ipcMain.handle(CHANNEL.saveTheme, (_e, theme: Theme) =>
    notebook === null ? undefined : saveTheme(notebook, theme),
  )
  ipcMain.handle(CHANNEL.deleteTheme, (_e, name: string) =>
    notebook === null ? false : deleteTheme(notebook, name),
  )

  installMenu({
    newWindow: () => windows?.open(),
    open: inNewWindow => void openDocument(inNewWindow),
    import: pick => void importDocument(pick),
    newFile: () => void newDocument(),
    newTaskList: () => void newDocument('todo'),
    notebook: () => windows?.reveal({ kind: 'today' }),
    tasks: () => void showTasks(),
    reorient: () => void reorient(),
    links: () => windows?.reveal({ kind: 'links' }),
  })
  // The renderer owns the caret; main owns the menus. Each tells the other the
  // one thing it knows, which is what keeps a greyed-out item honest.
  ipcMain.on(CHANNEL.selectionChanged, (_e, selection: SelectionState) =>
    setMenuSelection(selection),
  )
  ipcMain.on(CHANNEL.contextMenu, () => popRangeMenu())

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

  // The session, not a window: whatever was open last time comes back (MC6).
  windows = new Windows(service, createWindow)
  registerWindowIpc(windows, id => void importDocument(false, id))
  await windows.restore()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && windows !== null) windows.open()
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
    // The arrangement first: `stop()` releases the documents the windows name,
    // and a window's bounds go with the window when it closes.
    await windows?.flush()
    await service?.stop()
  } finally {
    await closing.close()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
