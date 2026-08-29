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

/** The app's editing settings. A surface uses whichever apply to it. */
export interface EditingSettings {
  readonly vim: boolean
  readonly typography: Typography
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
  /** Put the view on a place in the window, and show it. */
  revealAt(at: number): void
}

export interface SurfaceProps {
  readonly window: DocumentWindow
  readonly settings: EditingSettings
  readonly onError?: (err: Error) => void
  /** Where the caret is, for the sidebar's where-you-are line and the saved cursor. */
  readonly onCursor?: (at: DocumentPosition) => void
  /**
   * What is on screen. The Pane owns the extent policy and this is its input —
   * the surface reports a fact rather than being observed, which is what keeps
   * X from depending on Z (D40).
   */
  readonly onViewport?: (visible: { from: WindowPosition; to: WindowPosition }) => void
  readonly onHandle?: (handle: SurfaceHandle | null) => void
  readonly annotations?: AnnotationSink
}
