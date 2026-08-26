// The wire between Z and X.
//
// Document lives in the main process (D37), the live buffer lives in the
// renderer, and this is the only thing that crosses. Everything here is plain
// data: DocumentPosition is three primitives, Span is two of those, and Edit is
// a Span plus a string — so nothing needs a custom serialiser and nothing can
// smuggle a live object across a boundary it cannot survive.

import type {
  WindowEdit, DateKey, DocumentChange, DocumentMeta, EditOrigin, SessionGeneration,
  Span, SpanKind, TypedSpan, DocumentPosition,
} from './document-api.ts'
import type { Marker } from './prose.ts'
import type { WindowPosition, ProseText } from './document-api.ts'

/** Windows are addressed by handle; the objects themselves never cross. */
export type WindowId = number

export const CHANNEL = {
  open: 'tephra:doc:open',
  read: 'tephra:doc:read',
  edit: 'tephra:win:edit',
  release: 'tephra:win:release',
  undo: 'tephra:doc:undo',
  redo: 'tephra:doc:redo',
  flush: 'tephra:doc:flush',
  spans: 'tephra:doc:spans',
  resolveAnchor: 'tephra:doc:resolveAnchor',
  setAnchor: 'tephra:doc:setAnchor',
  tag: 'tephra:doc:tag',
  untag: 'tephra:doc:untag',
  branch: 'tephra:doc:branch',
  renameTag: 'tephra:doc:renameTag',
  removeAnchor: 'tephra:doc:removeAnchor',
  print: 'tephra:doc:print',
  comments: 'tephra:doc:comments',
  emojiPanel: 'tephra:emojiPanel',
  readClipboard: 'tephra:readClipboard',
  versions: 'tephra:history:versions',
  readDay: 'tephra:history:readDay',
  restore: 'tephra:history:restore',
  importText: 'tephra:doc:importText',
  startComment: 'tephra:doc:startComment',
  addComment: 'tephra:doc:addComment',
  editComment: 'tephra:doc:editComment',
  deleteComment: 'tephra:doc:deleteComment',
  setCommentResolved: 'tephra:doc:setCommentResolved',
  setCommentAssignee: 'tephra:doc:setCommentAssignee',
  reactToComment: 'tephra:doc:reactToComment',
  openLink: 'tephra:doc:openLink',
  extent: 'tephra:doc:extent',
  today: 'tephra:doc:today',
  extend: 'tephra:win:extend',
  anomalies: 'tephra:doc:anomalies',
  listThemes: 'tephra:theme:list',
  saveTheme: 'tephra:theme:save',
  loadUiState: 'tephra:ui:load',
  saveUiState: 'tephra:ui:save',
  /** renderer → main: the menu's checkmark follows the app, not the other way. */
  vimChanged: 'tephra:ui:vimChanged',
  /** main → renderer */
  setVim: 'tephra:ui:setVim',
  /** main → renderer: an Edit-menu command, which owns these keystrokes. */
  menuCommand: 'tephra:ui:menuCommand',
  /** renderer → main: what the caret is doing, so menus enable correctly. */
  selectionChanged: 'tephra:ui:selectionChanged',
  /** renderer → main: pop the context menu at the pointer. */
  contextMenu: 'tephra:ui:contextMenu',
  /** main → renderer: a range command was chosen, however it was reached. */
  rangeCommand: 'tephra:ui:rangeCommand',
  windowChanged: 'tephra:win:changed',
  windowReset: 'tephra:win:reset',
  diverged: 'tephra:doc:diverged',
} as const

export interface DocumentInfo {
  readonly meta: DocumentMeta
  readonly generation: SessionGeneration
  readonly today: DateKey
  readonly extent: { readonly first: DateKey; readonly last: DateKey } | null
}

/** Everything the renderer needs to serve the synchronous half of the API. */
export interface WindowSnapshot {
  readonly id: WindowId
  readonly text: ProseText
  readonly span: Span
  readonly generation: SessionGeneration
  readonly spans: readonly TypedSpan[]
  /** Where each segment's body starts in the buffer — the coordinate mapping. */
  /**
   * Where each segment sits, and what its markers are.
   *
   * `start` is a PROSE offset and `length` is the segment's document length; the
   * markers are what lets the renderer build the same prose↔raw map main has
   * (D44). Sending them is what stops there being two implementations of one
   * mapping — the first version omitted them, and tag underlines were drawn at
   * offsets that had never accounted for the marker bytes.
   */
  readonly placement: readonly {
    readonly date: DateKey
    /** Where this segment's prose begins in the window's buffer. */
    readonly start: WindowPosition
    readonly length: number
    readonly markers: readonly Marker[]
  }[]
  readonly boundaries: Boundaries
}

/**
 * The reply to an edit.
 *
 * `length` is a cheap consistency check, not decoration: the renderer applied
 * the same edits locally, so if the authoritative text is a different length
 * the two have diverged and the window must resync rather than continue on a
 * buffer that no longer describes the document.
 */
export interface EditAck {
  readonly generation: SessionGeneration
  readonly length: number
  readonly spans: readonly TypedSpan[]
  readonly placement: WindowSnapshot['placement']
}

export interface ChangeAck {
  readonly change: DocumentChange | null
  readonly generation: SessionGeneration
}

export interface WindowChangedMessage {
  readonly id: WindowId
  readonly edits: readonly WindowEdit[]
  readonly origin: EditOrigin
  readonly generation: SessionGeneration
  readonly text: ProseText
  readonly spans: readonly TypedSpan[]
  readonly placement: WindowSnapshot['placement']
  readonly boundaries: Boundaries
}

export interface ReadRequest {
  readonly first: DateKey
  readonly last: DateKey
}

export interface EditRequest {
  readonly id: WindowId
  readonly edits: readonly WindowEdit[]
  readonly origin: EditOrigin
  /** What the renderer believed when it composed these edits. */
  readonly generation: SessionGeneration
}

export interface SpansRequest {
  readonly kind?: SpanKind
}

export interface ExtendRequest {
  readonly id: WindowId
  readonly direction: 'earlier' | 'later'
  /** Characters, not days (D40). The Pane converts from its screen policy. */
  readonly chars: number
}

/** What lies beyond each edge, so the UI can offer the right affordance. */
export interface Boundaries {
  readonly earlier: boolean
  readonly later: boolean
}

export type { DocumentPosition }

/**
 * A passage on its way to paper.
 *
 * The HTML is rendered in the renderer, where the markdown parser already lives
 * (Spike B: printing is a web-layer job and the shell contributes the panel).
 * `segment` says which day the passage came from, which is what relative links
 * resolve against — main turns it into a base URL, since only main knows where
 * the notebook is. Spike B's fourth trap: without one, printing through a temp
 * file makes every relative image silently 404.
 */
export interface PrintJob {
  readonly html: string
  readonly css: string
  readonly title: string
  readonly segment: DateKey
}

/** What the clipboard is offering. Read in main, which is the only side with one. */
export interface Clipboard {
  readonly text: string
  readonly html: string
}
