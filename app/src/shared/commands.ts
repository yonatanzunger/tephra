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

export type RangeCommandId =
  | 'bookmark' | 'tag' | 'untag' | 'link' | 'comment' | 'branch' | 'print'
  | 'bold' | 'italic' | 'strike' | 'image' | 'task'

/**
 * Which menu a command appears under.
 *
 * **One list, still.** The menu bar wants emphasis under `Format`, where every
 * text application puts it and where a reader will look; the rest are things
 * done to a passage and belong under `Range`. Splitting the LIST would be two
 * lists to keep in step — this splits only the rendering, and the context menu
 * goes on showing everything, because a selection is a selection.
 */
export type CommandGroup = 'format' | 'insert' | 'file'

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
  readonly group: CommandGroup
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
  // **Emphasis works from a caret as well as a selection**, which is what makes
  // it `point` rather than `range`: with nothing selected it opens the markers
  // and leaves the caret between them, which is how a person types a bold word
  // they have not written yet.
  { id: 'bold', label: 'Bold', accelerator: 'CmdOrCtrl+B', needs: 'point', group: 'format', built: true },
  { id: 'italic', label: 'Italic', accelerator: 'CmdOrCtrl+I', needs: 'point', group: 'format', built: true },
  { id: 'strike', label: 'Strikeout', accelerator: 'CmdOrCtrl+/', needs: 'point', group: 'format', built: true },
  { id: 'bookmark', label: 'Bookmark…', accelerator: 'CmdOrCtrl+D', needs: 'point', group: 'insert', built: true },
  { id: 'tag', label: 'Tag…', accelerator: 'CmdOrCtrl+T', needs: 'range', group: 'insert', built: true },
  { id: 'untag', label: 'Remove Tag…', accelerator: '', needs: 'range', group: 'insert', built: true },
  // ⌘K is where every editor puts "make this a link", and a reader who has
  // used one before will try it. Commenting is the rarer act and takes the
  // longer reach.
  { id: 'link', label: 'Link…', accelerator: 'CmdOrCtrl+K', needs: 'range', group: 'insert', built: true },
  { id: 'comment', label: 'Comment…', accelerator: 'CmdOrCtrl+Alt+M', needs: 'range', group: 'insert', built: true },
  // **`point`, because it does two things and both are capture** (T13). With a
  // selection it takes those words; with a bare caret it offers the line, which
  // is the same gesture asking rather than assuming. The point of both is that
  // the thought reaches the list without leaving the sentence it arrived in —
  // a task carried in the head instead is the failure the whole list exists
  // against.
  { id: 'task', label: 'Task…', accelerator: 'CmdOrCtrl+Shift+T', needs: 'point', group: 'insert', built: true },
  // It MAKES a document, which is what the File menu is about, and it belongs
  // beside the other commands that make and unmake files.
  { id: 'branch', label: 'Branch Selection to Its Own File…', accelerator: '', needs: 'range', group: 'file', built: true },
  { id: 'print', label: 'Print Selection…', accelerator: 'CmdOrCtrl+Shift+P', needs: 'range', group: 'file', built: true },
  // **The promise the disabled item was making, kept** (R7). It sat here as
  // `built: false` from MC6 to M4 with a note saying so; a picture also arrives
  // by paste and by drop, and this is the door for the one that arrives from a
  // file you have to go and find.
  { id: 'image', label: 'Image…', accelerator: '', needs: 'point', group: 'insert', built: true },
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
