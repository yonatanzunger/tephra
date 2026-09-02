// The windows this app has open, and what each of them is showing (MC6).
//
// **A window is a VIEW on a document, and the set of them is the session.**
// Someone who left a note open beside the stream left an arrangement; restoring
// only the last window they touched throws that away, so `ui-state.json` holds
// a set and this is what keeps it true (D54).
//
// The division of knowledge, which is what makes the file small: each renderer
// knows what IT is showing and reports that; main knows which renderers there
// are, and which facts are the machine's rather than one window's. The theme is
// the machine's — two windows disagreeing about it is not a state this can
// represent — and where you are is the window's.
//
// Electron lives here, and deliberately: `DocumentService` stays free of it so
// the integration suites can drive it under plain node (`layering.test.ts`).

import type { BrowserWindow, WebContents } from 'electron'
import type { DocumentService } from './document-service.ts'
import { attachWindow } from './ipc.ts'
import { setMenuTargets } from './menu.ts'
import { STREAM_ID, type DocumentId } from '../shared/document-api.ts'
import type { WindowInfo, WindowReport } from '../shared/ipc.ts'
import type { NavTarget } from '../shared/pane-api.ts'
import { defaultUiState, defaultWindowState, type UiState, type WindowState } from '../shared/ui-state.ts'

interface Entry {
  readonly id: number
  readonly window: BrowserWindow
  state: WindowState
  /** The outside document it is showing, if any — what `Import` would act on. */
  importable: DocumentId | null
  /** The corpus document it is showing, if Rename and Delete apply. */
  renamable: DocumentId | null
}

export class Windows {
  readonly #service: DocumentService
  readonly #make: () => BrowserWindow
  readonly #entries = new Map<number, Entry>()
  #nextId = 1

  /** Settings are the machine's, not a window's; whoever changed one last wins. */
  #vim = defaultUiState.vim
  #theme = defaultUiState.theme

  #saving: ReturnType<typeof setTimeout> | null = null

  constructor(service: DocumentService, make: () => BrowserWindow) {
    this.#service = service
    this.#make = make
  }

  /**
   * Reopen the session, or open the one window a first run gets.
   *
   * Nothing here consults which window was focused: the arrangement is what is
   * being restored, and the platform decides which of them comes forward.
   */
  async restore(): Promise<void> {
    const saved = await this.#service.loadUiState()
    this.#vim = saved.vim
    this.#theme = saved.theme
    const windows = saved.windows.length > 0 ? saved.windows : [defaultWindowState]
    for (const state of windows) this.#open(state)
  }

  /**
   * Show `target` in a window of its own — the one that already has it if there
   * is one, a new one if there is not.
   *
   * **For the places you keep going back to**, of which the task list is the
   * first: a person works with the list open BESIDE what they are writing, not
   * instead of it, so navigating the current window would be taking away the
   * thing they were looking at. And opening a second window every time would
   * leave a drift of identical ones.
   *
   * Only main can answer this: it holds the set of windows and what each is
   * showing (MC6), which is exactly the knowledge a renderer does not have.
   */
  reveal(target: NavTarget): BrowserWindow {
    const wanted = documentOf(target)
    for (const entry of this.#entries.values()) {
      if (entry.window.isDestroyed()) continue
      if (wanted === null || documentOf(entry.state.location) !== wanted) continue
      if (entry.window.isMinimized()) entry.window.restore()
      entry.window.focus()
      return entry.window
    }
    return this.open(target)
  }

  /** A new window, showing `target` — or today, which is what New Window means. */
  open(target?: NavTarget): BrowserWindow {
    return this.#open({ location: target ?? { kind: 'today' }, cursor: null })
  }

  #open(state: WindowState): BrowserWindow {
    const window = this.#make()
    const id = this.#nextId++
    this.#entries.set(id, { id, window, state, importable: null, renamable: null })
    attachWindow(this.#service, window)

    if (state.bounds !== undefined) window.setBounds(state.bounds)
    // The menu describes the FOCUSED window, so it changes when focus does.
    window.on('focus', () => this.#syncMenu())
    window.on('closed', () => {
      // Its bounds are gone with it, so the entry goes too. Closing a window IS
      // saying you do not want it back — the alternative is a session that
      // grows every time you open something and never shrinks.
      this.#entries.delete(id)
      this.#save()
    })
    return window
  }

  /** Which window a renderer is, answered to the renderer asking. */
  infoFor(sender: WebContents): WindowInfo {
    const found = this.#entryFor(sender)
    return {
      id: found?.id ?? 0,
      state: found?.state ?? defaultWindowState,
      vim: this.#vim,
      theme: this.#theme,
    }
  }

  /** What a window is showing now. Also what it is called, which is its title. */
  report(sender: WebContents, report: WindowReport): void {
    const found = this.#entryFor(sender)
    if (found === undefined) return
    found.state = { location: report.location, cursor: report.cursor }
    found.importable = report.importable
    found.renamable = report.renamable
    this.#vim = report.vim
    this.#theme = report.theme
    this.#syncMenu()
    if (!found.window.isDestroyed() && found.window.getTitle() !== report.name) {
      found.window.setTitle(report.name)
    }
    this.#save()
  }

  close(sender: WebContents): void {
    this.#entryFor(sender)?.window.close()
  }

  /**
   * What `Import` would act on, from the MENU: the focused window's document.
   *
   * The menu describes the focused window because that is what a menu bar is
   * about, and the item is greyed when there is nothing to act on.
   */
  importable(): DocumentId | null {
    return this.#focused()?.importable ?? null
  }

  /** What Rename, Save a Copy and Delete would act on. */
  renamable(): DocumentId | null {
    return this.#focused()?.renamable ?? null
  }

  /**
   * The same question from a WINDOW, which does not have to guess which it is.
   *
   * **Focus is the wrong question when the asker is known.** The read-only
   * badge is in a window; a window that is not focused — one shown without
   * taking focus, or one whose click landed while a dialog had it — would
   * otherwise be told there is nothing to import, about the file it is showing.
   */
  importableFor(sender: WebContents): DocumentId | null {
    return this.#entryFor(sender)?.importable ?? null
  }

  #focused(): Entry | undefined {
    for (const entry of this.#entries.values()) {
      if (!entry.window.isDestroyed() && entry.window.isFocused()) return entry
    }
    return undefined
  }

  #syncMenu(): void {
    setMenuTargets({ importable: this.importable() !== null, renamable: this.renamable() !== null })
  }

  /** Every window, with its live bounds — what the file should say right now. */
  snapshot(): UiState {
    const windows: WindowState[] = []
    for (const entry of this.#entries.values()) {
      if (entry.window.isDestroyed()) continue
      windows.push({ ...entry.state, bounds: entry.window.getBounds() })
    }
    return { version: 1, windows, vim: this.#vim, theme: this.#theme }
  }

  /** Write the set, before the app goes away rather than because it is going. */
  async flush(): Promise<void> {
    if (this.#saving !== null) clearTimeout(this.#saving)
    this.#saving = null
    const state = this.snapshot()
    // An empty set would erase the session on the way out — the last window's
    // `closed` fires before the app quits, and a file saying "no windows" reads
    // on the next launch as "nothing to restore".
    if (state.windows.length === 0) return
    await this.#service.saveUiState(state)
  }

  #entryFor(sender: WebContents): Entry | undefined {
    for (const entry of this.#entries.values()) {
      if (!entry.window.isDestroyed() && entry.window.webContents.id === sender.id) return entry
    }
    return undefined
  }

  /**
   * Coalesced, because the caret moves on every keystroke.
   *
   * Losing a cursor position is cheap and self-correcting (D11's one exception),
   * so this must not compete with the write tiers that guard text.
   */
  #save(): void {
    if (this.#saving !== null) clearTimeout(this.#saving)
    this.#saving = setTimeout(() => {
      this.#saving = null
      const state = this.snapshot()
      if (state.windows.length > 0) void this.#service.saveUiState(state)
    }, 400)
  }
}

/**
 * Which document a target names — the question `reveal` is really asking.
 *
 * **A window is on a DOCUMENT, not on a place inside one.** Somebody asking for
 * the notebook wants the window that has the notebook in it, whatever day it
 * happens to be showing; comparing the targets themselves would open a second
 * window every time the first one had scrolled. A date, a bookmark and "today"
 * are all the stream.
 */
function documentOf(target: NavTarget): DocumentId | null {
  switch (target.kind) {
    case 'today':
    case 'date':
    case 'anchor':
      return STREAM_ID
    case 'document':
      return target.id
    case 'span':
      return target.doc
    default:
      return null // a URL and an OS file are not windows of ours
  }
}
