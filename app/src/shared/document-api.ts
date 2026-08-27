// The Document API — the contract, transcribed from solution/document-api.md.
//
// THIS FILE HAS NO RUNTIME CODE. It is types and interfaces only, so it can be
// imported from main, preload and renderer alike without dragging anything
// across a process boundary. It names no CodeMirror type and imports nothing
// from it: the alignment is a *compatibility* property (D22), so replacing the
// editor costs an adapter rather than a redesign.
//
// The pure position algebra that operates on these types lives in ./positions.ts,
// which is the only other module permitted to know what unit an offset is in.
//
// ─── THE LAYERS ──────────────────────────────────────────────
//
// Text makes four stops between the disk and the screen, and each stop needs
// its own kind of address. All of them are "a string and a number" at runtime,
// which is exactly why each gets its own branded pair: the compiler, not the
// reader's memory, is what keeps them apart, and every crossing is a named
// function that will not accept the layer next door.
//
//   ┌─ 1. THE FILES — the wire format ─────────────────────────────────────────┐
//   │   what      UTF-8 markdown, a file per day, long days split into         │
//   │             parts. Readable and editable without this program (R26).     │
//   │   class     `Notebook` (w/notebook.ts), built on a root directory.       │
//   │   text      a plain `string`: ONE file, frontmatter included.            │
//   │   address   `RelPath` + an offset into that file (w/layout.ts —          │
//   │             `dayFile`, `parseDayFile`).                                  │
//   └──────────────────────────────────────────────────────────────────────────┘
//         ↕  `parseFile` / `spliceBody`  (main/x/frontmatter.ts), and `Segment`
//            (main/x/segment.ts), which is where the crossing actually happens.
//            TWO THINGS AT ONCE: the parts of a long day are joined, and the
//            frontmatter is taken off — so one segment may be several files, and
//            an offset here is not an offset there.
//   ┌─ 2. THE DOCUMENT — the logical stream ───────────────────────────────────┐
//   │   what      one quasi-infinite stream of days (D8), carrying markers,    │
//   │             undo generations and everything durable. THE SOURCE OF       │
//   │             TRUTH; every layer above it is a rendering.                  │
//   │   class     `Document`, twice: `StreamDocument` (main, from a            │
//   │             `Notebook`) and `RemoteDocument` (renderer, from a           │
//   │             `DocumentInfo`, and it asks main to build the other one).    │
//   │   text      `DocumentText`, A SEGMENT AT A TIME — markers and all.       │
//   │             Not only prose that came back down: `importText` and the     │
//   │             comment writer produce it directly.                          │
//   │   address   `DocumentPosition` = SegmentKey + `DocumentOffset` +         │
//   │             generation. Carried across an edit by `mapPosition`, and     │
//   │             NEVER PERSISTED (D11) — saved cursors are (segment,          │
//   │             offset), which is why they survive a restart.                │
//   │   arithmetic  shared/positions.ts, which alone knows the unit.           │
//   └──────────────────────────────────────────────────────────────────────────┘
//         ↕  THE MARKER CROSSING, per segment: `proseText(text, map)` and
//            `documentText(prose)` for the text; `ProseMap.toProse` and
//            `ProseMap.toDocument` for the offsets that go with it
//            (shared/prose.ts).
//   ┌─ 2½. A SEGMENT'S PROSE — the halfway house ──────────────────────────────┐
//   │   text      `ProseText`, one segment's worth (`Segment.prose`).          │
//   │   address   SegmentKey + `ProseOffset`.                                  │
//   │   It has a name because the two crossings around it are INDEPENDENT:     │
//   │   markers are per segment, flattening is per window. Doing both in       │
//   │   one subtraction is how tagging once wrote its markers a marker's       │
//   │   width early, and how the underlines were drawn somewhere else again.   │
//   └──────────────────────────────────────────────────────────────────────────┘
//         ↕  THE FLATTENING, per window: `inWindow(start, local)` and
//            `inSegment(at, start)` (shared/prose.ts). Placement — where each
//            segment begins — is the parameter, and the window is what holds it.
//   ┌─ 3. THE WINDOW — what a reader is looking at ────────────────────────────┐
//   │   what      a loaded range of the document (D26), the text AS            │
//   │             PRESENTED: marker syntax gone, handles standing in for it    │
//   │             (D44). Rendering only; nothing here is saved, and it may     │
//   │             move under the reader as growth brings earlier days in.      │
//   │   class     `DocumentWindow`, twice again: `StreamWindow` (main) and     │
//   │             `RemoteWindow` (renderer). Made by `Document.read(span)`.    │
//   │   text      `ProseText`, the segments' prose joined.                     │
//   │   address   `WindowPosition`, an offset into that text.                  │
//   │   THREE THINGS TRAVEL, and only the first is text:                       │
//   │     · the text      `ProseText`                                          │
//   │     · the mapping   `ProseMap`, per segment, DELIBERATELY TEXTLESS —     │
//   │                     just a raw length and each marker's width, so        │
//   │                     both processes can build the same one                │
//   │     · the meaning   `TypedSpan[]` from `spans()`, which is where a       │
//   │                     tag's subject and a comment's id actually live       │
//   │   The two copies are a CONTRACT, not a duplicate: `WindowSnapshot`       │
//   │   and `WindowChangedMessage` are its wire format, the renderer edits     │
//   │   synchronously and reconciles against main's acknowledged length,       │
//   │   and a disagreement raises `DesyncError` rather than drifting.          │
//   └──────────────────────────────────────────────────────────────────────────┘
//         ↕  `bindEditor` (renderer/src/editor/bind.ts): `fromBuffer` on the way
//            in, `applyFromDocument` on the way out.
//   ┌─ 4. THE EDITOR — CodeMirror ─────────────────────────────────────────────┐
//   │   text      `EditorState.doc` — the window's `ProseText`, verbatim.      │
//   │   address   a plain number, EQUAL TO the `WindowPosition`. Not by        │
//   │             definition: a compatibility property the adapter keeps       │
//   │             (D22), so replacing the editor costs an adapter and not a    │
//   │             redesign.                                                    │
//   │   and its own, which no layer below shares:                              │
//   │     · pixels, through `coordsAtPos` (measures the DOM) and               │
//   │       `posAtCoords` (consults the height map) — two answers to one       │
//   │       question, and where the last three selection bugs lived            │
//   │     · things with no address at all below this line: the day seam,       │
//   │       the comment cards, every block widget                              │
//   │   The round trip through pixels is the identity only away from an        │
//   │   atomic range, where every point inside a widget means one position.    │
//   └──────────────────────────────────────────────────────────────────────────┘
//
// AND SIDEWAYS, off layer 2: HISTORY. A `VersionId` and a `RelPath` read
// `DocumentText` straight out of git (main/x/history.ts) — no window, no
// prose, no positions. The two version axes never meet (D33): a
// SessionGeneration dies with the process, a VersionId outlives the program.
//
// ─── AND SO THE NAMES ────────────────────────────────────────
//
// A text type says which CONTENT it is. An offset type says which content it
// indexes and at what SCOPE:
//
//                      document — markers present    prose — handles instead
//    in one segment     `DocumentOffset`              `ProseOffset`
//                         → `DocumentText`              → `ProseText`
//    across a window    — never exists —              `WindowPosition`
//                                                      → `ProseText`
//
// The empty cell is a design property rather than an omission: a window never
// holds document text, because markers are not text (D44).
//
// `Position` versus `Offset` is the other half of it. A Position is a COMPLETE
// address at its layer; an Offset is one component of one. The document's text
// is a segment at a time, so its position carries a segment key beside its
// offset — and a generation, because the document it addresses is changing.
// The window is one flat text, so its position is a number and nothing else.

// ─────────────────────────────────────────────────────────────
// Identity and coordinates
// ─────────────────────────────────────────────────────────────

declare const SegmentKeyBrand: unique symbol

/**
 * The segment of a document that has only one (D27, D54).
 *
 * A note, a fileset, a branched passage: their content is not divided, so the
 * first component of a position carries no information and is this constant
 * rather than a different arbitrary string per kind. Said once here instead of
 * in every implementation that would otherwise choose its own.
 */
export const ONLY_SEGMENT = 'content' as SegmentKey

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
// These are as distinct as DocumentPosition and WindowPosition, and for the
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

declare const DocumentOffsetBrand: unique symbol

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
export type DocumentOffset = number & { readonly [DocumentOffsetBrand]: void }

/** The true position. NEVER PERSISTED (D11). */
export interface DocumentPosition {
  readonly segment: SegmentKey // a DateKey in the stream; a constant elsewhere
  readonly offset: DocumentOffset // within that segment's content
  readonly generation: SessionGeneration
}

declare const DocumentTextBrand: unique symbol
declare const ProseTextBrand: unique symbol

/**
 * A segment's content as the file holds it — markers and all.
 *
 * "As the file holds it" means the LOGICAL file, one layer up from the wire
 * format: the characters between the frontmatter and the end, with the parts of
 * a split day already joined and the encoding already undone. The notebook
 * reads and writes UTF-8 and nothing above `w/` sees a byte; like every other
 * string here this is UTF-16 in memory, so a length is a count of code units.
 *
 * **Branded for the same reason the offsets are.** A string does not say which
 * layer it belongs to, and document text and prose are the same characters in
 * every document that happens to contain no markers — which is most of them
 * while a feature is being written. Two bugs came from exactly that: growth
 * handed the editor a segment's BODY where prose was owed, and a change
 * announcement handed it the document's payload. Both compiled, both looked
 * right, and both put `<!--tephra:…-->` on screen.
 *
 * It reaches prose only through `proseText`, which needs the map; prose comes
 * back only through `documentText`, which strips the handles that exist in the
 * editor alone. There is no other way across, and that is the point.
 */
export type DocumentText = string & { readonly [DocumentTextBrand]: void }

/** What a window holds, and the editor after it: marker syntax gone (D44). */
export type ProseText = string & { readonly [ProseTextBrand]: void }

declare const ProseOffsetBrand: unique symbol

/**
 * An offset into ONE segment's prose — the text with marker syntax taken out
 * and handles standing in for it (D44).
 *
 * **A third coordinate space, and it needed a name.** `DocumentOffset` counts
 * code units in one segment's document text; `WindowPosition` counts prose
 * characters across a whole window; this counts prose characters within one
 * segment. All three are numbers, and for a segment with no markers all three
 * agree — which is exactly why confusing them survives every test written
 * against ordinary text.
 *
 * It went wrong the moment there was a marker: `RemoteWindow.toDocument`
 * subtracted a segment start from a window position and returned the result as
 * a `DocumentOffset`, so tagging a phrase wrote its markers twenty-seven
 * characters early — one marker's width — and the second tag of a paragraph
 * landed inside the first. The cast is what let it compile.
 *
 * So the conversions are the only way across: `ProseMap.toDocument` will not
 * accept a `DocumentOffset`, and `inWindow` will not accept one either.
 */
export type ProseOffset = number & { readonly [ProseOffsetBrand]: void }

declare const WindowPositionBrand: unique symbol

/** A rendering convenience: an offset inside one loaded window. NEVER PERSISTED. */
export type WindowPosition = number & { readonly [WindowPositionBrand]: void }

/** INTERNAL ONLY — must never appear in a signature Z can reach. */
export interface StoragePosition {
  readonly file: string
  readonly offset: DocumentOffset
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

import type { CommentId, CommentThread } from './comments.ts'
import type { Prose } from './prose.ts'

export type SpanKind = 'date' | 'heading' | 'anchor' | 'tag' | 'comment'

/** No id: inference leaves nothing for one to identify (D21). */
export type TypedSpan =
  | { readonly kind: 'date'; readonly name: DateKey; readonly span: Span }
  | { readonly kind: 'heading'; readonly name: string; readonly level: number; readonly span: Span }
  | { readonly kind: 'anchor'; readonly name: string; readonly span: Span } // zero-length
  | { readonly kind: 'tag'; readonly name: string; readonly span: Span } // may overlap freely
  /**
   * A commented range (D47). `name` is the thread's id; the thread's CONTENTS
   * come from `comments()`, because a decoration does not want a message list
   * and the margin does not want to re-derive spans.
   */
  | {
      readonly kind: 'comment'
      readonly name: string
      readonly resolved: boolean
      readonly span: Span
    }

// ─────────────────────────────────────────────────────────────
// Changes
// ─────────────────────────────────────────────────────────────

/** Empty span ⇒ insert. Empty payload ⇒ delete. */
export interface Edit {
  readonly span: Span
  /** RAW: this is going into the file, markers and all. */
  readonly payload: DocumentText
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

/**
 * What a STREAM can answer, beyond what every document can (D54).
 *
 * **These were on `Document` and are day-shaped.** A fileset has no extent in
 * dates and no date at a position; implementing them meant returning null
 * forever, which is a type saying "not applicable" in the one vocabulary that
 * cannot say it. A caller that wants them is asking a stream a stream question
 * and can say so — `isStream()` is how.
 */
export interface StreamDocumentApi extends Document {
  readonly meta: DocumentMeta & { readonly kind: 'stream' }

  /** The first and last days that exist, or null for a notebook with none. */
  extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null>

  /**
   * Synchronous, because the segment IS the date in the stream (D27).
   *
   * There is no null case any more: a position in a stream is in a day, and a
   * position in something else never reaches here.
   */
  dateAt(at: DocumentPosition): DateKey
}

/** The narrowing, in one place rather than as a cast at each call site. */
export const isStream = (doc: Document): doc is StreamDocumentApi => doc.meta.kind === 'stream'

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

  /** The unloaded counterparts of DocumentWindow.advance/distance. */
  advance(from: DocumentPosition, chars: number): Promise<DocumentPosition | null>
  distance(a: DocumentPosition, b: DocumentPosition): Promise<number | null>

  // ── spans ──────────────────────────────────────────────────
  spans(kind?: SpanKind): Promise<readonly TypedSpan[]>
  spansAt(at: DocumentPosition): Promise<readonly TypedSpan[]>
  resolveAnchor(name: string): Promise<DocumentPosition | null>

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
  /**
   * Change what ONE span is tagged as. Renaming a subject everywhere is a
   * different and much larger operation, and not this one.
   */
  renameTag(span: Span, from: string, to: string): Promise<void>
  /** One operation, never composed by Z: create → update references → delete (D13). */
  branch(span: Span, name: string): Promise<DocumentId>

  /**
   * Bring outside text in, keeping the original untouched (R28, D47).
   *
   * Returns where the original was stored. The clipboard is read by the layer
   * that has one; this is given what it found.
   */
  importText(
    at: DocumentPosition,
    text: string,
    original: { readonly content: string; readonly ext: string },
  ): Promise<string>

  // ── comments: a thread anchored to a range (D47) ───────────
  //
  // Thread-aware, and it includes editing, because a comment's body is not in
  // the buffer — it is rendered in the margin and edited there, so changing it
  // is an operation rather than ordinary typing.
  comments(): Promise<readonly CommentThread[]>
  commentsAt(at: DocumentPosition): Promise<readonly CommentThread[]>
  startComment(span: Span, body: string): Promise<CommentId>
  addComment(id: CommentId, body: string): Promise<void>
  editComment(id: CommentId, index: number, body: string): Promise<void>
  /** Removing the last message removes the thread, anchors included. */
  deleteComment(id: CommentId, index: number): Promise<void>
  setCommentResolved(id: CommentId, resolved: boolean): Promise<void>
  setCommentAssignee(id: CommentId, to: string | null): Promise<void>
  /** Toggles the CURRENT user's reaction. */
  reactToComment(id: CommentId, index: number, emoji: string, on: boolean): Promise<void>

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
export interface WindowEdit {
  readonly from: WindowPosition
  readonly to: WindowPosition // from === to ⇒ insert
  /** PROSE: this is going into the editor's buffer. '' ⇒ delete. */
  readonly insert: ProseText // '' ⇒ delete
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
  readonly text: ProseText
  /**
   * The same text, with everything anchored into it (D50).
   *
   * **What a renderer should read.** `spans()` answers in DOCUMENT positions,
   * which is right for a command that edits and wrong for a decoration that
   * draws: every drawing path used to convert each span back to a window
   * position itself, four times over, and every one of those conversions was a
   * chance to add a segment start to the wrong kind of offset. Here the ranges
   * are already the buffer's own.
   */
  readonly prose: Prose<WindowPosition>

  // ── coordinates ────────────────────────────────────────────
  /**
   * Both units are UTF-16 code units, so these are addition — the whole point
   * of D24, since this is the boundary crossed on the hot path. The window is
   * one of only two places permitted to know that.
   */
  toDocument(at: WindowPosition): DocumentPosition
  toWindow(at: DocumentPosition): WindowPosition | null // null if outside

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
  edit(edits: readonly WindowEdit[], origin?: EditOrigin): Promise<void>

  // ── queries, synchronous because the region is loaded ──────
  spansAt(at: WindowPosition): readonly TypedSpan[]
  spans(kind?: SpanKind): readonly TypedSpan[]
  snap(from: WindowPosition, to: WindowPosition): { from: WindowPosition; to: WindowPosition }
  advance(from: WindowPosition, chars: number): WindowPosition | null
  distance(a: WindowPosition, b: WindowPosition): number

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
  onChanged(handler: (edits: readonly WindowEdit[], origin: EditOrigin) => void): Unsubscribe
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
