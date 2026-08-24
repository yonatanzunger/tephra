// What can be done to a selection, defined ONCE.
//
// Six operations are arriving (R11–R14, R27, R28) and each of them is reachable
// three ways: the menu bar, a keyboard shortcut, and a context menu on the
// selection. **Three renderings of one list, never three lists.** Two menus
// maintained separately disagree the first time either gains an item, and the
// disagreement is invisible until someone right-clicks and finds the thing they
// just used from the menu bar missing.
//
// Type-only plus data: no Electron, no DOM. Main builds native menus from it;
// the renderer decides what is currently applicable.

export type RangeCommandId = 'bookmark' | 'tag' | 'untag' | 'comment' | 'branch' | 'print'

/** What a command needs before it can do anything. */
export type CommandNeeds =
  /** A caret is enough — the degenerate range (R11's note: a point is a range of zero length). */
  | 'point'
  /** Real selected text. */
  | 'range'

export interface RangeCommand {
  readonly id: RangeCommandId
  readonly label: string
  /** Electron accelerator syntax; also what the menu displays. */
  readonly accelerator: string
  readonly needs: CommandNeeds
  /** Absent until the milestone that builds it — the menu says so rather than lying. */
  readonly built: boolean
}

/**
 * **`Cmd+P` is not here, and that is deliberate.** Every application prints the
 * whole document on `Cmd+P`, and taking that for a range operation would be a
 * small daily surprise in exchange for one saved keystroke. Printing a range is
 * `Cmd+Shift+P`; printing the whole thing arrives with a File menu, where the
 * stream will need a date range rather than a document.
 *
 * Order matters: it is the order both menus show, so it should read as a
 * sequence someone might actually work through — mark a place, name a subject,
 * say something about it, move it out, put it on paper.
 */
export const RANGE_COMMANDS: readonly RangeCommand[] = [
  { id: 'bookmark', label: 'Bookmark…', accelerator: 'CmdOrCtrl+D', needs: 'point', built: true },
  { id: 'tag', label: 'Tag…', accelerator: 'CmdOrCtrl+T', needs: 'range', built: true },
  { id: 'untag', label: 'Remove Tag…', accelerator: '', needs: 'range', built: true },
  { id: 'comment', label: 'Comment…', accelerator: 'CmdOrCtrl+K', needs: 'range', built: true },
  { id: 'branch', label: 'Branch to Its Own File…', accelerator: '', needs: 'range', built: true },
  { id: 'print', label: 'Print Selection…', accelerator: 'CmdOrCtrl+Shift+P', needs: 'range', built: true },
]

/** What the renderer tells main about the caret, so menus can enable correctly. */
export interface SelectionState {
  /** There is a document open and a caret in it. */
  readonly hasPoint: boolean
  /** Something is actually selected. */
  readonly hasRange: boolean
}

export const NO_SELECTION: SelectionState = { hasPoint: false, hasRange: false }

/**
 * Whether a command applies right now.
 *
 * A command that has not been built yet is never enabled. **The alternative —
 * enabling it and failing on invoke — is the "throwing beats pretending" rule
 * pointed at the user instead of at the programmer**, and a menu item that does
 * nothing teaches people to distrust the menu.
 */
export function isEnabled(command: RangeCommand, selection: SelectionState): boolean {
  if (!command.built) return false
  return command.needs === 'range' ? selection.hasRange : selection.hasPoint
}
