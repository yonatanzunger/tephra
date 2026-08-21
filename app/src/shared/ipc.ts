// The wire between Z and X.
//
// Document lives in the main process (D37), the live buffer lives in the
// renderer, and this is the only thing that crosses. Everything here is plain
// data: DocumentPosition is three primitives, Span is two of those, and Edit is
// a Span plus a string — so nothing needs a custom serialiser and nothing can
// smuggle a live object across a boundary it cannot survive.

import type {
  BufferEdit, DateKey, DocumentChange, DocumentMeta, EditOrigin, SessionGeneration,
  Span, SpanKind, TypedSpan, DocumentPosition,
} from './document-api.ts'

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
  extent: 'tephra:doc:extent',
  today: 'tephra:doc:today',
  extend: 'tephra:win:extend',
  /** main → renderer */
  windowChanged: 'tephra:win:changed',
  windowReset: 'tephra:win:reset',
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
  readonly text: string
  readonly span: Span
  readonly generation: SessionGeneration
  readonly spans: readonly TypedSpan[]
  /** Where each segment's body starts in the buffer — the coordinate mapping. */
  readonly placement: readonly { readonly date: DateKey; readonly start: number; readonly length: number }[]
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
  readonly edits: readonly BufferEdit[]
  readonly origin: EditOrigin
  readonly generation: SessionGeneration
  readonly text: string
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
  readonly edits: readonly BufferEdit[]
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
