// The Document API — the contract, transcribed from solution/document-api.md.
//
// THIS FILE HAS NO RUNTIME CODE. It is types and interfaces only, so it can be
// imported from main, preload and renderer alike without dragging anything
// across a process boundary. It names no CodeMirror type and imports nothing
// from it: the alignment is a *compatibility* property (D22), so replacing the
// editor costs an adapter rather than a redesign.
//
// The pure position algebra that operates on these types lives in ./positions.ts,
// which is the only other module permitted to know what unit an Offset is in.

// ─────────────────────────────────────────────────────────────
// Identity and coordinates
// ─────────────────────────────────────────────────────────────

declare const SegmentKeyBrand: unique symbol

/**
 * The first component of a position: which segment of the document it is in.
 * The stream's segments are dates; every other document has exactly one (D27).
 */
export type SegmentKey = string & { readonly [SegmentKeyBrand]: void }

/** A SegmentKey of the stream, "YYYY-MM-DD". The stream's ordering axis (D9). */
export type DateKey = SegmentKey

declare const DocumentIdBrand: unique symbol
export type DocumentId = string & { readonly [DocumentIdBrand]: void }

// ─────────────────────────────────────────────────────────────
// TWO VERSION AXES — never one axis at two resolutions (D33)
//
// These are as distinct as DocumentPosition and BufferPosition, and for the
// same reason: conflating them is silent and expensive. Different underlying
// primitives (number vs string) so a cast cannot bridge them, different owning
// objects, no conversion function in either direction, and no method anywhere
// accepts both.
// ─────────────────────────────────────────────────────────────

declare const SessionGenerationBrand: unique symbol
declare const VersionIdBrand: unique symbol

/**
 * VOLATILE. In-memory only; dies with the process. Advanced by every change
 * whatever its origin. The name carries the constraint deliberately: a
 * DocumentPosition stamped with one cannot outlive the session, which is
 * exactly what D11 already requires of it.
 *
 * Owned by Document. Opaque and comparable; the rewind coordinate for undo.
 */
export type SessionGeneration = number & { readonly [SessionGenerationBrand]: void }

/**
 * DURABLE. A commit in the repository. Survives restarts, devices and the
 * application itself — it is readable with `git log` after Tephra is gone.
 *
 * Owned by History. There is NO function converting between the two axes,
 * and none should be added: the correspondence exists only within one session,
 * only for commits made during it, and exposing it would invite treating a
 * volatile coordinate as a durable one.
 */
export type VersionId = string & { readonly [VersionIdBrand]: void }

declare const OffsetBrand: unique symbol

/**
 * An opaque character offset (D24). Its unit is UTF-16 code units — chosen
 * because that is native to the editor and to both target platforms, and
 * because nothing durable ever records an offset, so the choice is not
 * written into the corpus.
 *
 * OPACITY IS THE POINT. Arithmetic on two Offsets yields a plain number
 * that cannot be assigned back without a deliberate cast, so accidental
 * unit-dependence is a type error. Use the position algebra in ./positions.ts.
 *
 * Only two places may know the unit: the window adapter, and the algebra.
 *
 * INVARIANT: no offset ever falls between the halves of a surrogate pair.
 * Asserted at construction, not discovered at a render.
 */
export type Offset = number & { readonly [OffsetBrand]: void }

/** The true position. NEVER PERSISTED (D11). */
export interface DocumentPosition {
  readonly segment: SegmentKey // a DateKey in the stream; a constant elsewhere
  readonly offset: Offset // within that segment's content
  readonly generation: SessionGeneration
}

declare const ProseOffsetBrand: unique symbol

/**
 * An offset into ONE segment's prose — the text with marker syntax taken out
 * and handles standing in for it (D44).
 *
 * **A third coordinate space, and it needed a name.** `Offset` counts bytes in a
 * segment's body; `BufferPosition` counts prose characters across the whole
 * window; this counts prose characters within one segment. All three are
 * numbers, and for a body with no markers all three agree, which is exactly why
 * confusing them survives every test written against ordinary text.
 *
 * It went wrong the moment there was a marker: `RemoteWindow.toDocument`
 * subtracted a segment start from a buffer position and returned the result as
 * an `Offset`, so tagging a phrase wrote its markers twenty-seven bytes early —
 * one marker's width — and the second tag of a paragraph landed inside the
 * first. The cast is what let it compile.
 *
 * So the conversions are the only way across: `ProseMap.toRaw` will not accept
 * an `Offset`, and `inWindow` will not accept one either.
 */
export type ProseOffset = number & { readonly [ProseOffsetBrand]: void }

declare const BufferPositionBrand: unique symbol

/** A rendering convenience: an offset inside one loaded window. NEVER PERSISTED. */
export type BufferPosition = number & { readonly [BufferPositionBrand]: void }

/** INTERNAL ONLY — must never appear in a signature Z can reach. */
export interface StoragePosition {
  readonly file: string
  readonly offset: Offset
}

/** Half-open [begin, end). A zero-length span is a point. NEVER PERSISTED. */
export interface Span {
  readonly begin: DocumentPosition
  readonly end: DocumentPosition
}

// ─────────────────────────────────────────────────────────────
// Spans — inferred from the text, never stored beside it (D20)
// ─────────────────────────────────────────────────────────────

/**
 * The character standing for a marker a person can point at (D44).
 *
 * The buffer holds PROSE — marker syntax never reaches it — but a bookmark and
 * the start of a tagged range are things you step onto and delete, so each
 * occupies exactly one character. U+FFFC OBJECT REPLACEMENT CHARACTER is
 * Unicode's own name for a placeholder where something that is not text
 * belongs.
 *
 * It exists only in the buffer: it is never written to a file, and text
 * arriving from outside has it stripped, so its presence always means a marker
 * and never means itself.
 */
export const HANDLE = '\ufffc'

export type SpanKind = 'date' | 'heading' | 'anchor' | 'tag'

/** No id: inference leaves nothing for one to identify (D21). */
export type TypedSpan =
  | { readonly kind: 'date'; readonly name: DateKey; readonly span: Span }
  | { readonly kind: 'heading'; readonly name: string; readonly level: number; readonly span: Span }
  | { readonly kind: 'anchor'; readonly name: string; readonly span: Span } // zero-length
  | { readonly kind: 'tag'; readonly name: string; readonly span: Span } // may overlap freely

// ─────────────────────────────────────────────────────────────
// Changes
// ─────────────────────────────────────────────────────────────

/** Empty span ⇒ insert. Empty payload ⇒ delete. */
export interface Edit {
  readonly span: Span
  readonly payload: string
}

/**
 *  - 'user'      typing; groups with adjacent user edits
 *  - 'operation' tag, branch, paste; its own undo step
 *  - 'external'  sync pull or reload; not in history, but history maps through it
 */
export type EditOrigin = 'user' | 'operation' | 'external'

/** The journal record. Serialisable; this is what durability appends. */
export interface DocumentChange {
  readonly from: SessionGeneration
  readonly to: SessionGeneration
  readonly edits: readonly Edit[]
  readonly origin: EditOrigin
  readonly at: number // epoch ms, for the digest model
}

// ─────────────────────────────────────────────────────────────
// Document
// ─────────────────────────────────────────────────────────────

export type DocumentKind = 'stream' | 'markdown' | 'todo' | 'fileset'

export interface DocumentMeta {
  readonly kind: DocumentKind
  /**
   * No origin fields (D27). A branched document is not in the dated stream and
   * is not given a date to pretend otherwise; the link left behind in the
   * stream is the relationship that matters, and it points the useful way.
   */
}

export type Unsubscribe = () => void

/** Surfaced, never auto-resolved (D12). */
export interface Divergence {
  readonly ours: string
  readonly theirs: string
  readonly date: DateKey
}

export interface Document {
  readonly id: DocumentId
  readonly meta: DocumentMeta
  readonly generation: SessionGeneration
  readonly isDirty: boolean

  // ── reading: one operation, returning a window ─────────────
  /**
   * Load the region named by `span`, widening its boundaries to something
   * meaningful — fetch is markdown-aware and will not cut a heading, table
   * or equation in half. The returned DocumentWindow reports the span it
   * actually served, which is what makes read → edit → replace correct.
   *
   * `at` reads a historical generation. v1 may support only the current one
   * and throw StalePositionError otherwise; the parameter exists so that
   * diffing and the divergence picker need no API change.
   */
  read(span: Span, at?: SessionGeneration): Promise<DocumentWindow>

  /** Boundary widening without loading text — the widget layer needs this constantly. */
  snap(span: Span): Promise<Span>

  extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null>

  /** The unloaded counterparts of DocumentWindow.advance/distance. */
  advance(from: DocumentPosition, chars: number): Promise<DocumentPosition | null>
  distance(a: DocumentPosition, b: DocumentPosition): Promise<number | null>

  // ── spans ──────────────────────────────────────────────────
  spans(kind?: SpanKind): Promise<readonly TypedSpan[]>
  spansAt(at: DocumentPosition): Promise<readonly TypedSpan[]>
  resolveAnchor(name: string): Promise<DocumentPosition | null>
  /**
   * Synchronous, because the segment IS the date in the stream. Null for
   * documents that are not in the stream — date totality is a property of the
   * stream, not of every document (D27).
   */
  dateAt(at: DocumentPosition): DateKey | null

  // ── writing: document space only ───────────────────────────
  /**
   * The one mutation. A BATCH: spans relative to the pre-edit state, sorted,
   * non-overlapping, applied atomically. Resolves once durable.
   */
  replace(edits: readonly Edit[], origin?: EditOrigin): Promise<void>

  // ── history: document-scoped, window-independent (D23, D29) ─
  currentGeneration(): SessionGeneration

  /**
   * THE PRIMITIVE. Make the content equal what it was at `to`.
   *
   * NON-DESTRUCTIVE: a rewind is itself a new change, emitted forward, so
   * generations only ever increase and nothing is discarded. Rewinding and
   * then typing does not destroy the abandoned future — it merely stops being
   * reachable through the undo affordance. "Losing anything, ever" then holds
   * for history as well as for text.
   *
   * Bounded by the session: the undo stack is in memory only (D32), so a
   * generation from before this process started is unreachable, and the call
   * fails loudly rather than approximating. Older states are reached through
   * History.restore, at commit granularity rather than keystroke granularity.
   */
  rewindTo(to: SessionGeneration): Promise<DocumentChange | null>

  /**
   * Policy over rewindTo, not primitives beside it. `undo` rewinds to the
   * generation at the previous history-group boundary — grouping is by
   * EditOrigin and adjacency, so a typed sentence is one step and an applied
   * tag is its own. If the change lands outside the caller's window, the
   * returned record says where; the UI moves there, since an undo with no
   * visible effect is alarming.
   */
  undo(): Promise<DocumentChange | null>
  redo(): Promise<DocumentChange | null>

  /** What the retained journal can still reach. The basis of any recovery UI. */
  history(since?: SessionGeneration): Promise<readonly DocumentChange[]>

  // ── semantic sugar: all of these compile to replace() ──────
  tag(span: Span, subject: string): Promise<void>
  untag(span: Span, subject: string): Promise<void>
  setAnchor(at: DocumentPosition, name: string): Promise<void>
  removeAnchor(name: string): Promise<void>
  /** One operation, never composed by Z: create → update references → delete (D13). */
  branch(span: Span, name: string): Promise<DocumentId>

  // ── change feed ────────────────────────────────────────────
  onChanged(handler: (change: DocumentChange) => void): Unsubscribe
  onDiverged(handler: (d: Divergence) => void): Unsubscribe

  /** Carry a held position across a change. Null if the text it named is gone. */
  mapPosition(at: DocumentPosition, through: DocumentChange): DocumentPosition | null

  // ── lifecycle: the quiesce protocol, owned by X (D14 rule 3) ─
  flush(): Promise<void>
  reload(): Promise<void>
  release(): Promise<void>
}

/** An edit expressed in window coordinates — what an editor naturally produces. */
export interface BufferEdit {
  readonly from: BufferPosition
  readonly to: BufferPosition // from === to ⇒ insert
  readonly insert: string // '' ⇒ delete
}

/**
 * The complete editor-facing surface (D26), and the ONLY place that knows both
 * coordinate systems. An editor binds to a DocumentWindow and never touches
 * Document — with one deliberate exception: undo.
 *
 * A rendering affordance: it holds no history and owns nothing lost by closing.
 *
 * TWO-PART, because Document lives in the main process (D37): this is the
 * renderer-side facade, holding `text` and the span list so that the methods
 * declared synchronous below genuinely are. The authority is in main.
 */
export interface DocumentWindow {
  readonly document: Document
  readonly generation: SessionGeneration
  /** What was actually served, after boundary widening. */
  readonly span: Span
  readonly text: string

  // ── coordinates ────────────────────────────────────────────
  /**
   * Both units are UTF-16 code units, so these are addition — the whole point
   * of D24, since this is the boundary crossed on the hot path. The window is
   * one of only two places permitted to know that.
   */
  toDocument(at: BufferPosition): DocumentPosition
  toBuffer(at: DocumentPosition): BufferPosition | null // null if outside

  // ── editing, in window coordinates ─────────────────────────
  /**
   * Translates to document space and forwards to Document.replace.
   *
   * TIMING CONTRACT (as amended by D37): THIS WINDOW's in-memory buffer is
   * updated SYNCHRONOUSLY before this returns. The document's own state, which
   * lives in main, is updated in order — per-channel IPC ordering guarantees
   * any later call observes it. The promise resolves when the change is
   * DURABLE. An editor fires and does not await; a rejection is a real failure
   * (disk full, permissions) and must be surfaced, not swallowed.
   *
   * ECHO SUPPRESSION: onChanged does not fire on this window for changes this
   * window originated. The editor has already applied them; re-applying is how
   * text gets duplicated.
   */
  edit(edits: readonly BufferEdit[], origin?: EditOrigin): Promise<void>

  // ── queries, synchronous because the region is loaded ──────
  spansAt(at: BufferPosition): readonly TypedSpan[]
  spans(kind?: SpanKind): readonly TypedSpan[]
  snap(from: BufferPosition, to: BufferPosition): { from: BufferPosition; to: BufferPosition }
  advance(from: BufferPosition, chars: number): BufferPosition | null
  distance(a: BufferPosition, b: BufferPosition): number

  // ── changes originating elsewhere ──────────────────────────
  /**
   * The typed spans changed — a tag applied or removed, a heading edited.
   *
   * Separate from `onChanged` because the two do not coincide. An edit the
   * EDITOR made is echo-suppressed, so `onChanged` stays silent, and yet the
   * spans that come back with its acknowledgement may be completely different:
   * deleting a tag's handle removes the whole tag (D44). Without this, the
   * underline for a tag that no longer exists stays on screen until something
   * unrelated forces a redraw.
   */
  onSpansChanged(handler: () => void): Unsubscribe

  /** Fires for external edits, sync pulls and undos that land inside this window. */
  onChanged(handler: (edits: readonly BufferEdit[], origin: EditOrigin) => void): Unsubscribe
  /** The window's region moved or reloaded wholesale; rebind. */
  onReset(handler: () => void): Unsubscribe

  /**
   * Grow the loaded region. `chars` rather than days (D40): a day is between
   * ~100 KB and 1 MB, so a day-denominated extension loads an unpredictable
   * amount and can overshoot the measured-safe ceiling. The Pane converts its
   * screen-denominated policy into characters and passes the result here; the
   * boundary lands wherever `snap` puts it, which need not be a day edge.
   */
  extend(direction: 'earlier' | 'later', chars?: number): Promise<void>
  release(): void
}

/**
 * UNDO IS DELIBERATELY NOT ON DocumentWindow. It is document-scoped (D23) and
 * may land outside the current region, so the editor binds its undo key to
 * `window.document.undo()` and moves the window to wherever the returned change
 * happened. Reaching past the facade is the point: it keeps the scoping visible
 * in the code rather than implying that undo is a property of what is on screen.
 */
