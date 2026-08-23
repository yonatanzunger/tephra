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
import { verifyMode } from './verify-mode.ts'

export interface MenuState {
  /** Vim mode, mirrored from the renderer so the checkmark tells the truth. */
  vim: boolean
}

const state: MenuState = { vim: false }

/** Rebuild the menu. Cheap, and the only way to move a checkmark in Electron. */
export function installMenu(): void {
  const send = (channel: string, value: unknown): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(channel, value)
  }

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
        { role: 'selectAll' },
      ],
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
