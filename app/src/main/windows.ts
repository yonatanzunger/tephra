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
import type { WindowInfo, WindowReport } from '../shared/ipc.ts'
import type { NavTarget } from '../shared/pane-api.ts'
import { defaultUiState, defaultWindowState, type UiState, type WindowState } from '../shared/ui-state.ts'

interface Entry {
  readonly id: number
  readonly window: BrowserWindow
  state: WindowState
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

  /** A new window, showing `target` — or today, which is what New Window means. */
  open(target?: NavTarget): BrowserWindow {
    return this.#open({ location: target ?? { kind: 'today' }, cursor: null })
  }

  #open(state: WindowState): BrowserWindow {
    const window = this.#make()
    const id = this.#nextId++
    this.#entries.set(id, { id, window, state })
    attachWindow(this.#service, window)

    if (state.bounds !== undefined) window.setBounds(state.bounds)
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
    this.#vim = report.vim
    this.#theme = report.theme
    if (!found.window.isDestroyed() && found.window.getTitle() !== report.name) {
      found.window.setTitle(report.name)
    }
    this.#save()
  }

  close(sender: WebContents): void {
    this.#entryFor(sender)?.window.close()
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
