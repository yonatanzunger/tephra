// The application menu.
//
// macOS conventions are load-bearing here, not decoration: menu item labels are
// Title Case, and the application menu carries the app's real name — which is
// why `app.setName` runs before this. Left alone, Electron calls the app
// "Electron" in About, Hide and Quit.
//
// Two things live here that used to be checkboxes in the titlebar. The screen
// is for the document; a setting toggled once in a while and then forgotten is
// exactly what a menu is for, and leaving it on screen means seeing it every
// day to serve a decision made twice a year.
//
// NOTE: setting any application menu REPLACES Electron's default one, which is
// where Cmd-Q, Cmd-C and the window roles come from. They are spelled out below
// rather than inherited; omitting them silently removes copy and paste.

import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { CHANNEL } from '../shared/ipc.ts'
import {
  RANGE_COMMANDS,
  isEnabled,
  NO_SELECTION,
  type SelectionState,
} from '../shared/commands.ts'
import { verifyMode } from './verify-mode.ts'

export interface MenuState {
  /** Vim mode, mirrored from the renderer so the checkmark tells the truth. */
  vim: boolean
  /** What the caret is doing, mirrored for the same reason. */
  selection: SelectionState
}

const state: MenuState = { vim: false, selection: NO_SELECTION }

function send(channel: string, value: unknown): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send(channel, value)
}

/**
 * The range commands as menu items, built from `RANGE_COMMANDS` so the menu bar
 * and the context menu cannot drift apart — they are two renderings of one list.
 */
function rangeItems(): MenuItemConstructorOptions[] {
  return RANGE_COMMANDS.map(command => ({
    label: command.label,
    ...(command.accelerator === '' ? {} : { accelerator: command.accelerator }),
    enabled: isEnabled(command, state.selection),
    click: () => send(CHANNEL.rangeCommand, command.id),
  }))
}

/** Pop the context menu where the pointer is. Same items, same enable rules. */
export function popRangeMenu(): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (win === undefined) return
  Menu.buildFromTemplate(rangeItems()).popup({ window: win })
}

/** Told by the renderer what the caret is doing; rebuilds so items grey correctly. */
export function setMenuSelection(selection: SelectionState): void {
  if (
    state.selection.hasPoint === selection.hasPoint &&
    state.selection.hasRange === selection.hasRange
  ) {
    return
  }
  state.selection = selection
  installMenu()
}

/** Rebuild the menu. Cheap, and the only way to move a checkmark in Electron. */
export function installMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      // **`Cmd+P` prints the document, where every other program puts it.**
      // For the stream that cannot mean "all of it" — all of it is twenty
      // years — so it asks which days first. Printing a selection is the
      // range operation, on `Cmd+Shift+P`, and lives in the Range menu.
      label: 'File',
      submenu: [
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => send(CHANNEL.menuCommand, 'printDocument'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // Undo and Redo are OURS, not the standard roles. Undo here is
        // document-scoped and reaches past the editor facade (D26): the
        // standard role would undo a CodeMirror transaction, which is a
        // different and much smaller thing than undoing a Document change.
        //
        // They must still be present. An Edit menu on macOS without Undo is a
        // broken application, and the earlier version left them out to avoid
        // the accelerator competing with a keydown listener in the renderer.
        // Making the menu the ONLY path removes the competition instead: the
        // listener is gone, and these items are how ⌘Z arrives.
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send(CHANNEL.menuCommand, 'undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send(CHANNEL.menuCommand, 'redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        // Paste puts text in; **import keeps what arrived**. The original goes
        // to `attachments/` untouched and what lands in the day is a copy you
        // can write on (R28, D47) — which is the difference between having a
        // passage and being able to cite it.
        {
          label: 'Import Clipboard',
          accelerator: 'Shift+CmdOrCtrl+V',
          click: () => send(CHANNEL.menuCommand, 'import'),
        },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Range',
      submenu: rangeItems(),
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Typography…',
          accelerator: 'CmdOrCtrl+Alt+T',
          click: () => send(CHANNEL.menuCommand, 'typography'),
        },
        { type: 'separator' },
        {
          label: 'Vim Mode',
          type: 'checkbox',
          checked: state.vim,
          accelerator: 'CmdOrCtrl+Alt+V',
          click: menuItem => send(CHANNEL.setVim, menuItem.checked),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  if (verifyMode()) {
    console.log(
      `VERIFY-MAIN appName=${app.getName()} firstMenu=${menu.items[0]?.label} ` +
        `about=${menu.items[0]?.submenu?.items[0]?.label} quit=${menu.items[0]?.submenu?.items.at(-1)?.label}`,
    )
  }
}

/**
 * Fire a menu item by label, for the self-check. The point is to exercise the
 * REAL item — its accelerator wiring and its click handler — rather than the
 * IPC it happens to send, because the thing worth testing is that Edit ▸ Undo
 * is connected to document-scoped undo at all.
 */
export function clickMenuItem(label: string): boolean {
  const menu = Menu.getApplicationMenu()
  if (menu === null) return false
  for (const item of menu.items) {
    const found = item.submenu?.items.find(sub => sub.label === label)
    if (found !== undefined) {
      found.click()
      return true
    }
  }
  return false
}

/**
 * Told by the renderer what vim is actually set to, and rebuilds so the
 * checkmark matches. The renderer owns the setting — it is loaded from
 * `ui-state.json` at startup and saved per device (D30) — so the menu is a
 * view of that, never a second copy of it.
 */
export function setMenuVim(vim: boolean): void {
  if (state.vim === vim) return
  state.vim = vim
  installMenu()
}
