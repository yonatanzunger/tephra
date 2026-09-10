// The application menu.
//
// macOS conventions are load-bearing here, not decoration: menu item labels are
// Title Case, and the application menu carries the app's real name — which is
// why `app.setName` runs before this. Left alone, Electron calls the app
// "Electron" in About, Hide and Quit.
//
// Settings live in menus rather than on screen. The screen is for the document,
// and a setting toggled once in a while and then forgotten is exactly what a
// menu is for — putting it in the chrome means seeing it every day to serve a
// decision made twice a year.
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
  type CommandGroup,
  type RangeCommandId,
  type SelectionState,
} from '../shared/commands.ts'
import { verifyMode } from './verify-mode.ts'

export interface MenuState {
  /** Vim mode, mirrored from the renderer so the checkmark tells the truth. */
  vim: boolean
  /** What the caret is doing, mirrored for the same reason. */
  selection: SelectionState
  /** Whether the focused window is showing a file that could be imported. */
  importable: boolean
  /** Whether it is showing a document of ours, which Rename and Delete need. */
  renamable: boolean
}

/**
 * A window said what its document affords: importing, renaming, both or
 * neither. One call because they change together — focus moves once and both
 * answers move with it, and two setters would rebuild the menu twice.
 */
export function setMenuTargets(targets: { importable: boolean; renamable: boolean }): void {
  if (state.importable === targets.importable && state.renamable === targets.renamable) return
  state.importable = targets.importable
  state.renamable = targets.renamable
  installMenu()
}

const state: MenuState = { vim: false, selection: NO_SELECTION, importable: false, renamable: false }

function send(channel: string, value: unknown): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send(channel, value)
}

/**
 * The range commands as menu items, built from `RANGE_COMMANDS` so the menu bar
 * and the context menu cannot drift apart — they are two renderings of one list.
 */
/** One command by name, for a menu that wants it in a particular place. */
function commandItem(id: RangeCommandId): MenuItemConstructorOptions[] {
  return rangeItems().filter(item => item.id === id)
}

function rangeItems(group?: CommandGroup): MenuItemConstructorOptions[] {
  return RANGE_COMMANDS.filter(command => group === undefined || command.group === group).map(command => ({
    id: command.id,
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
/**
 * What the menu can ask the app to do that no renderer can.
 *
 * Only one so far, and it is the one that matters: a window is an OS object, so
 * making one is main's job however the gesture arrives (MC6).
 */
export interface MenuActions {
  newWindow: () => void
  /** The same act as `tasks`, for the one document that is not a file. */
  notebook: () => void
  /**
   * Show the task list, in a window of its own.
   *
   * **Main's, because only main knows the window set.** A person works with the
   * list open beside what they are writing rather than instead of it, so this
   * focuses the window that already has it and opens one when none does — a
   * question a renderer cannot answer about windows it is not (MC6).
   */
  tasks: () => void
  /** The link directory (ML3): a window's location that is not a document. */
  links: () => void
  /**
   * Ask for a file, the way every other application asks for one.
   *
   * **Main's, all of it.** The dialog is the OS's, resolving a path to a
   * document is the notebook's, and making a window is main's — the renderer is
   * involved only when the answer lands in the window it already has (MC6).
   */
  open: (inNewWindow: boolean) => void
  /**
   * Bring a file in. `pick` asks which; without it, whatever the focused window
   * is showing — which is the same act reached from the read-only indicator.
   */
  import: (pick: boolean) => void
  /** A new document, in a window of its own. */
  newFile: () => void
  /**
   * A new OVERALL task list — a single `.todo.md` (MT7).
   *
   * Beside New File because it is the same act with a different kind: a list
   * that does not turn over daily is a document like any other, and this is the
   * only thing about reaching one that had to be built. A DAILY list is not
   * made here and could not be — a directory document has no single file to
   * create, and its first carry is what brings it into being (D59).
   */
  newTaskList: () => void
}

/**
 * Held, because the menu is REBUILT on every state change — a checkmark can
 * only be moved in Electron by making the menu again — and a rebuild must not
 * lose the actions it was installed with.
 */
let actions: MenuActions = {
  newWindow: () => undefined,
  notebook: () => undefined,
  tasks: () => undefined,
  links: () => undefined,
  open: () => undefined,
  import: () => undefined,
  newFile: () => undefined,
  newTaskList: () => undefined,
}

export function installMenu(next?: MenuActions): void {
  if (next !== undefined) actions = next
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          // **Where a person looks for it**, which is the application menu on
          // `Cmd+,` and not View. It was `View ▸ Typography…`, which was doubly
          // wrong: the wrong menu, and a name for one of the things it holds
          // rather than for the thing itself (M3).
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => send(CHANNEL.menuCommand, 'typography'),
        },
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
      //
      // The rest of this menu is what having more than one document means: a
      // way to reach another one, a way to get back to the notebook, and a
      // second window to put one in (MC6). **`New Window` is main's**, because
      // making a window is not something a renderer can do; the two `Open`s
      // are the renderer's, because choosing is a dialog.
      label: 'File',
      submenu: [
        // **Making and unmaking documents**, then bringing them in, then
        // putting them out. Reading order is the order somebody works in.
        {
          // Main's, because it makes a WINDOW as well as a document, and a
          // window is an OS object no renderer can conjure.
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => actions.newFile(),
        },
        {
          label: 'New Task List\u2026',
          click: () => actions.newTaskList(),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => actions.open(false),
        },
        {
          label: 'Open in New Window…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => actions.open(true),
        },
        { type: 'separator' },
        // **`Save a Copy`, not `Save As`.** Nothing here is ever unsaved — the
        // write tiers and the WAL see to that — so "save it somewhere else"
        // does not name an act this app has, and `Save As` would imply the
        // original was in some sense not saved until you did. Making a second
        // copy under a new name is the act, and it is what other applications
        // call it when there is nothing to save.
        {
          label: 'Save a Copy…',
          accelerator: 'CmdOrCtrl+Shift+S',
          enabled: state.renamable,
          click: () => send(CHANNEL.menuCommand, 'duplicateFile'),
        },
        // Naming is the renderer's: a name needs a text field, and this app
        // asks in-app rather than in a native box, for the reason `Prompt` was
        // written — `window.prompt` blocks the renderer's whole event loop.
        { label: 'Rename…', enabled: state.renamable, click: () => send(CHANNEL.menuCommand, 'renameFile') },
        { label: 'Delete…', enabled: state.renamable, click: () => send(CHANNEL.menuCommand, 'deleteFile') },
        { type: 'separator' },
        ...commandItem('branch'),
        { type: 'separator' },
        {
          // Enabled only when there is something to import, which is when the
          // focused window is showing a file from outside the notebook.
          label: 'Import Current File',
          enabled: state.importable,
          click: () => actions.import(false),
        },
        {
          label: 'Import…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => actions.import(true),
        },
        { type: 'separator' },
        ...commandItem('print'),
        {
          // **`Cmd+P` prints the document, where every other program puts it.**
          // For the stream that cannot mean "all of it" — all of it is twenty
          // years — so it asks which days first.
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
        // They must also be present: an Edit menu on macOS without Undo is a
        // broken application. And the menu is the ONLY path — there is no
        // keydown listener in the renderer competing for the accelerator, so
        // these items are how ⌘Z arrives at all.
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
        { type: 'separator' },
        // **Find is the walk, not the list** (D66): it takes you to successive
        // places in the document you are reading, and ⌘⇧F's pane is the other
        // rendering of the same query.
        //
        // **Earlier and Later, rather than Previous and Next.** The stream's
        // axis is time and its newest end is where you always are, so the
        // useful default is backwards — and *previous* would have to mean
        // "further into the past", which is the opposite of what it says.
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => send(CHANNEL.menuCommand, 'find') },
        {
          label: 'Find Earlier',
          accelerator: 'CmdOrCtrl+G',
          click: () => send(CHANNEL.menuCommand, 'findEarlier'),
        },
        {
          label: 'Find Later',
          accelerator: 'Shift+CmdOrCtrl+G',
          click: () => send(CHANNEL.menuCommand, 'findLater'),
        },
        // **The other rendering of the same query** (D66): ⌘F walks one
        // document, this shows every place at once across everything.
        {
          label: 'Search Tephra…',
          accelerator: 'Shift+CmdOrCtrl+F',
          click: () => send(CHANNEL.menuCommand, 'searchAll'),
        },
        { type: 'separator' },
        // **Emphasis is editing**, so it lives here: the same kind of act as
        // cut and paste, and the only commands in the set that work from a bare
        // caret. Built from `RANGE_COMMANDS` like every other command, so the
        // context menu shows them without a second list to maintain.
        ...rangeItems('format'),
      ],
    },
    {
      // Everything that puts something INTO the text: a bookmark, a subject, a
      // link, a note in the margin. What they have in common is the result, not
      // the selection they start from — the acts that make or print a FILE are
      // in the File menu even though they start from a selection too.
      label: 'Insert',
      submenu: rangeItems('insert'),
    },
    {
      label: 'View',
      submenu: [
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
    {
      // **The system owns most of this menu, and should.** macOS adds Cycle
      // Through Windows, the Move & Resize submenu — Fill, Center, the tiling
      // commands — and an entry per open window to whichever menu is registered
      // as the Window menu. Hand-rolling those would be worse versions of what
      // the platform already does, and they would stop matching every other
      // application on the machine.
      //
      // What is ours is the two ways to get a window in the first place.
      label: 'Window',
      role: 'windowMenu',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => actions.newWindow() },
        {
          // The one document that is not a file, under the name everybody uses
          // for it. `Cmd+0` because it is the zeroth thing.
          label: 'Notebook',
          accelerator: 'CmdOrCtrl+0',
          click: () => actions.notebook(),
        },
        {
          // **The other place you are always going**, and it opens in a window
          // of its own: the list is something you keep beside your writing, so
          // navigating the current window would take away what you were
          // looking at. ⌘1 after the zeroth thing (T7, MT3).
          label: 'Task List',
          accelerator: 'CmdOrCtrl+1',
          click: () => actions.tasks(),
        },
        {
          // **The third place you are always going**, and the first that is not
          // a document at all (ML3): a window's location can be a query. Same
          // gesture as its neighbours — there should be a window with this in
          // it, in front — because it is still one subject.
          label: 'Links',
          accelerator: 'CmdOrCtrl+2',
          click: () => actions.links(),
        },
        { type: 'separator' },
        // **Minimize without ⌘M.** The role carries the system accelerator, and
        // that key is a daily hazard for someone who does not want it: a
        // mistyped ⌘N or ⌘, drops the window to the Dock mid-sentence. The item
        // stays, because a Window menu without it is a broken macOS
        // application; only the shortcut goes.
        {
          label: 'Minimize',
          click: () => BrowserWindow.getFocusedWindow()?.minimize(),
        },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close', label: 'Close Window' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
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
