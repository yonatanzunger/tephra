// What the app hands a surface, whatever kind of document it is showing.
//
// **A surface is a whole view, not a configured editor.** `kinds/Markdown.tsx`
// is one — CodeMirror, and everything under `kinds/markdown/` that makes it
// markdown — and the first kind that is not running text will be another file
// beside it rather than another flag inside it (D54, architecture.md's four
// artifacts). The registry answers which; this file says what they are handed.
//
// The rule for what belongs here: **a boolean varies a view, a file replaces
// one.** Anything that is true of every way of showing a document is a prop;
// anything that is one surface's own is that surface's, and the import path
// says so.

import type { DocumentPosition, DocumentWindow, WindowPosition } from '../../../shared/document-api.ts'
import type { Typography } from './typography.ts'
import type { CommentAnchor, MarkInfo } from './annotations.ts'
import type { FindMarks } from './kinds/markdown/find-marks.ts'

/** The app's editing settings. A surface uses whichever apply to it. */
export interface EditingSettings {
  readonly vim: boolean
  readonly typography: Typography
  /**
   * How the task list is arranged (T8), and how to say it changed.
   *
   * **The surface owns the control; the app owns the setting.** Which is which
   * is decided by what outlives the window: a way of looking that a window
   * forgets is not a setting, and MT4a shipped it as one on the grounds that
   * nobody knew whether it was worth keeping. It is.
   */
  readonly listView?: 'time' | 'tag'
  readonly onListView?: (view: 'time' | 'tag') => void
}

/**
 * What the chrome subscribes to: the annotation layer, as it is drawn.
 *
 * **Offered to every surface, used by the ones that have one.** The mark panel,
 * the comment margin and the rail are app-level furniture listening to what the
 * surface knows — where a mark sits on the page, where an anchor landed. A
 * surface with no annotation layer simply never calls these.
 *
 * When a second surface has a genuinely DIFFERENT annotation model, this moves
 * to context rather than growing further. It is one prop, and grouped, so that
 * the move is a small one when its reason arrives.
 */
export interface AnnotationSink {
  readonly onMark?: (mark: MarkInfo) => void
  readonly onCommentAnchors?: (anchors: readonly CommentAnchor[]) => void
  /** Where the comment rail hangs, which only the surface knows the geometry of. */
  readonly onRailHost?: (host: HTMLElement | null) => void
}

/**
 * What anything showing a document can do for the app that holds it.
 *
 * One method, deliberately: navigation has to be able to say "show me this
 * place", and that is true of a list, a table or a canvas as much as of running
 * text. Everything else the menu drives — a selection, wrapping it, marking the
 * scroll track — is the TEXT surface's, and lives with it.
 */
export interface SurfaceHandle {
  /** Put the caret on a place in the window, and show it. */
  revealAt(at: number): void
  /** Where the find's matches are, and which one it is standing on (MS3). */
  showFindMarks(marks: FindMarks): void
}

/**
 * The least a thing has to be for a range command to reach it.
 *
 * **A surface that is not CodeMirror can still hold text.** The row a task is
 * edited in is an `<input>`, and ⌘K means the same thing there as it does in
 * the notebook — a link is a link. `EditorHandle` is the wrong shape to ask a
 * text field for: most of it (emphasis toggling, scroll-track marks, revealing
 * a buffer position) is about a document view and means nothing in a one-line
 * field, and MT3 was right to answer `null` for it rather than fake it.
 *
 * So this is the part a range command actually uses, and `EditorHandle`
 * satisfies it structurally — the caller does not branch, it just takes
 * whichever target is present.
 */
export interface TextTarget {
  /** Whether anything is selected. A range command needs something to act on. */
  selection(): { readonly empty: boolean }
  /** Put text around the selection, as ordinary typing would. */
  wrapSelection(before: string, after: string): void
  /**
   * Put emphasis on, or take it off again.
   *
   * A toggle for the reason the editor's is: the second press of ⌘B is somebody
   * changing their mind, and `****` reads as broken. From a bare caret it opens
   * the pair and waits inside, which is why emphasis is `point` and not `range`.
   */
  toggleEmphasis(marker: string): void
}

export interface SurfaceProps {
  readonly window: DocumentWindow
  readonly settings: EditingSettings
  readonly onError?: (err: Error) => void
  /** Where the caret is, for the sidebar's where-you-are line and the saved cursor. */
  readonly onCursor?: (at: DocumentPosition) => void
  /**
   * Somewhere a range command can write, when this surface has one open.
   *
   * Null when it does not, which is most of the time and is what greys the
   * menu. Separate from `onHandle` because a text field is not an editor: this
   * says "there is text here with a selection in it", which is the only claim
   * a command like ⌘K needs and the only one a field can honestly make.
   */
  readonly onTextTarget?: (target: TextTarget | null) => void
  /**
   * What is on screen. The Pane owns the extent policy and this is its input —
   * the surface reports a fact rather than being observed, which is what keeps
   * X from depending on Z (D40).
   */
  readonly onViewport?: (visible: { from: WindowPosition; to: WindowPosition }) => void
  readonly onHandle?: (handle: SurfaceHandle | null) => void
  readonly annotations?: AnnotationSink
}
