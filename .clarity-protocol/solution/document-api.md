# The Document API

> **Locked as the v1 draft, 2026-08-12.** Changes from here need a decision record, not an edit. Build-time obligations live in `implementation-notes.md`.

v1's first artifact, ahead of the format spec. Written against D8, D13, D14, D16, D18–D24, D26, D27, D29, D32, D33.

**This declaration is the contract.** It names no CodeMirror type and imports nothing from it; the alignment is a *compatibility* property (D22), so replacing the editor costs an adapter rather than a redesign.

## Scale, which drives everything below

Era 3 produced 40–50 thousand lines a month. At 40–80 characters a line that is **roughly 2–3.5 MB a month, 20–45 MB a year, and 0.4–0.9 GB over twenty years** — and Spike A's 1.05 MB corpus, which had felt like a generous test, represents **about a fortnight of writing.**

Three consequences, all of which invalidate an earlier estimate:

- **Windowing is required in v1**, not eventually. The document does not fit in a buffer and never did; a month is already 2.4× the spike.
- **The index arrives sooner than D7 assumed.** Scanning is instant at 10 MB and is not at 50 MB, which is year two. "Index is a v3 concern" was optimistic.
- **The editing surface has been validated at a fortnight's worth of text, not a year's.** The spike's flatness claim stands, but its range was smaller than the language around it implied.

## The model, and why undo has nothing to do with windows

The clarifying picture is **journal plus digest**: a document is a sequence of `DocumentChange` records, with periodic realised snapshots. The state at time *t* is the last snapshot before *t* plus every change since. In that picture:

- **Undo is scrolling backwards through change history.** It is defined entirely in document space and has no relationship to what is on screen.
- **A read is `(span, generation)`** — a slice of a particular session generation.
- **A window is a UX affordance**: load this region, adjust its boundaries to something meaningful, make it fast to render and edit. Nothing more.

**`DocumentPosition` is the true position; everything else derives from it.** `BufferPosition` is a rendering convenience, `StoragePosition` is an implementation detail.

**The model is adopted; the storage architecture is not** (D23). Making the journal authoritative would demote the plain text files to a derived snapshot — which is precisely the fork Q2 closed in the other direction, arriving through a different door. The journal is a write-ahead log over authoritative text, folded in and discarded at quiescence.

---

## Three coordinate systems

| Type | Shape | Who uses it |
|---|---|---|
| `DocumentPosition` | `(segment, offset)` | The public API. The only true position |
| `BufferPosition` | offset into a `DocumentWindow`'s buffer | The editor, inside one window |
| `StoragePosition` | `(file, offset)` | **Internal only.** Never crosses the Document boundary |

`(segment, offset)` — the segment being a date in the stream, a constant elsewhere (D27) — rather than an absolute stream offset (D21): an absolute form needs a global index of every file's *character* length, which `stat` cannot supply, and every offset in the corpus would shift on any edit anywhere. Here an edit changes offsets only within its own date, so `mapPosition` is O(1) and a no-op outside the edited date. It also makes `dateAt` a field access, and makes a within-day split invisible.

**`SessionGeneration` is document-wide and volatile.** Any change advances it, so a position from an earlier generation must be mapped forward before use — cheap, and for positions outside the edited segment it only restamps the generation. It is one of **two version axes that must never be confused** (D33): the other, `VersionId`, is durable and belongs to History.

**Offsets are opaque, and their unit is UTF-16 code units** (D24, analysis in `offset-units.md`). UTF-16 because it is native to the editor and to both target platforms, so the one boundary crossed on the hot path is addition rather than translation. Opaque because nothing durable records an offset — D11 already guarantees that — so the choice is not written into the corpus and should stay reversible. Bytes appear only in file I/O, which takes no offsets at all.

---

## The declaration

```ts
// ─────────────────────────────────────────────────────────────
// Identity and coordinates
// ─────────────────────────────────────────────────────────────

/**
 * The first component of a position: which segment of the document it is in.
 * The stream's segments are dates; every other document has exactly one (D27).
 */
export type SegmentKey = string & { readonly __brand: 'SegmentKey' }

/** A SegmentKey of the stream, "YYYY-MM-DD". The stream's ordering axis (D9). */
export type DateKey = SegmentKey

export type DocumentId = string & { readonly __brand: 'DocumentId' }

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
export declare function compareGenerations(a: SessionGeneration, b: SessionGeneration): number

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
 * unit-dependence is a type error. Use the position algebra below.
 *
 * Only two places may know the unit: the window adapter, and the algebra.
 *
 * INVARIANT: no offset ever falls between the halves of a surrogate pair.
 * Asserted at construction, not discovered at a render.
 */
export type Offset = number & { readonly [OffsetBrand]: void }

/** Implementation-only constructor. Validates the surrogate invariant. */
export declare function offsetOf(n: number, inText: string): Offset

/** The true position. NEVER PERSISTED (D11). */
export interface DocumentPosition {
  readonly segment: SegmentKey     // a DateKey in the stream; a constant elsewhere
  readonly offset: Offset          // within that segment's content
  readonly generation: SessionGeneration
}

/** A rendering convenience: an offset inside one loaded window. NEVER PERSISTED. */
export type BufferPosition = number & { readonly __brand: 'BufferPosition' }

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
// Position algebra — the only unit-aware code besides the window adapter
// ─────────────────────────────────────────────────────────────

/** Pure, synchronous, no document state. Lexicographic: date, then offset. */
export declare function comparePositions(a: DocumentPosition, b: DocumentPosition): number
export declare function spanOf(begin: DocumentPosition, end: DocumentPosition): Span
export declare function pointAt(at: DocumentPosition): Span          // zero-length
export declare function isEmpty(span: Span): boolean
export declare function contains(span: Span, at: DocumentPosition): boolean
export declare function intersects(a: Span, b: Span): boolean

/**
 * advance() and distance() are NOT pure: crossing a date boundary needs
 * content, so they live on DocumentWindow (synchronous, within the loaded region)
 * and on Document (asynchronous). They are deliberately not free functions.
 */

/**
 * Thrown when a position or span from a superseded generation is used, and
 * the caller did not ask to read at that generation. Failing loudly is what
 * turns T1 — an operation computed against text that has since moved — from
 * silent corruption into a visible error.
 */
export class StalePositionError extends Error {
  constructor(readonly expected: SessionGeneration, readonly got: SessionGeneration) { super() }
}

// ─────────────────────────────────────────────────────────────
// Spans — inferred from the text, never stored beside it (D20)
// ─────────────────────────────────────────────────────────────

export type SpanKind = 'date' | 'heading' | 'anchor' | 'tag'

/** No id: inference leaves nothing for one to identify (D21). */
export type TypedSpan =
  | { readonly kind: 'date';    readonly name: DateKey; readonly span: Span }
  | { readonly kind: 'heading'; readonly name: string; readonly level: number; readonly span: Span }
  | { readonly kind: 'anchor';  readonly name: string; readonly span: Span }   // zero-length
  | { readonly kind: 'tag';     readonly name: string; readonly span: Span }   // may overlap freely

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
  readonly at: number              // epoch ms, for the digest model
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
   * or equation in half. The returned DocumentWindow reports the span it actually
   * served, which is what makes read → edit → replace correct.
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
   * Fails if `to` predates journal retention (D28): the generation is known
   * but the records needed to reach it are gone. Fail loudly, as ever.
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
  readonly to: BufferPosition        // from === to ⇒ insert
  readonly insert: string            // '' ⇒ delete
}

/**
 * The complete editor-facing surface (D26), and the ONLY place that knows both
 * coordinate systems. An editor binds to a DocumentWindow and never touches Document —
 * with one deliberate exception, below.
 *
 * A rendering affordance: it holds no history and owns nothing lost by closing.
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
  toBuffer(at: DocumentPosition): BufferPosition | null   // null if outside

  // ── editing, in window coordinates ─────────────────────────
  /**
   * Translates to document space and forwards to Document.replace.
   *
   * TIMING CONTRACT: in-memory state — both this window's and the document's —
   * is updated SYNCHRONOUSLY before this returns. The promise resolves when the
   * change is DURABLE. An editor fires and does not await; a rejection is a real
   * failure (disk full, permissions) and must be surfaced, not swallowed.
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
  /** Fires for external edits, sync pulls and undos that land inside this window. */
  onChanged(handler: (edits: readonly BufferEdit[], origin: EditOrigin) => void): Unsubscribe
  /** The window's region moved or reloaded wholesale; rebind. */
  onReset(handler: () => void): Unsubscribe

  extend(direction: 'earlier' | 'later', days?: number): Promise<void>
  release(): void
}

/**
 * UNDO IS DELIBERATELY NOT ON DocumentWindow. It is document-scoped (D23) and may land
 * outside the current region, so the editor binds its undo key to
 * `window.document.undo()` and moves the window to wherever the returned change
 * happened. Reaching past the facade is the point: it keeps the scoping visible
 * in the code rather than implying that undo is a property of what is on screen.
 */
```

## How the editor attaches

**DocumentWindow is the whole editor-facing API** (D26). It is the only code that knows both coordinate systems and the only code besides the position algebra that knows the offset unit, so the D24 boundary and the D19 tier boundary land in the same object. An editor binds to a DocumentWindow and, apart from undo, never touches Document.

**The editor's own history is disabled.** D21 claimed the undo conflict was "deleted" because Document's buffer *was* an `EditorState`. At measured corpus size that premise is false, so the conflict is **relocated** rather than deleted: one history, in Document, in document space, and the editor keeps none.

**Undo may land outside the current window**, in which case the returned `DocumentChange` says where and the UI moves there. An undo with no visible effect is worse than no undo — which is also why undo is reached through `window.document` rather than through the facade.

**Two contracts that prevent specific bugs.** `edit()` updates in-memory state synchronously and resolves on durability, so the editor never awaits on the typing path but a real write failure still surfaces. And `onChanged` does not fire on the window that originated a change — the editor has already applied it, and re-applying is exactly how text gets duplicated.

## The compatibility contract

Nothing above imports CodeMirror. Five properties keep the adapter thin, and they are the checklist any replacement must satisfy (D22):

1. Edits are a sorted, non-overlapping batch relative to the pre-edit state.
2. DocumentWindow positions are integer offsets in the same unit the editor uses.
3. Changes are serialisable — which is what makes the durability journal a log of change records.
4. Changes can map a held position through them.
5. Edits carry an origin controlling history grouping and membership.

## Durability

`replace` resolves once the change is durable, which is affordable because **the keystroke path does not call `replace` per keystroke**: the editor renders from its window buffer, and `replace` serves operations.

Typed text is covered by the journal — append a `DocumentChange`, replay after a crash, fold into the text files and discard at quiescence. **The realistic loss event is a renderer crash, not power failure**, since the live buffer lives in the renderer; that is why the journal must be an append crossing to the main process.

**Retaining the journal past quiescence is a small, separate choice**: it buys undo that survives an app restart, at the cost of a second representation of the same data. Worth taking deliberately rather than by default.

The contract: **durable when `flush()` resolves, and durable within N ms otherwise.**

## Two leaks the implementation must close

**Adjacent same-date spans must coalesce**, or a within-day split makes storage segmentation visible above the API.

**`StoragePosition` must never appear in a signature Z can reach.**

## What this leaves for the format spec

Frontmatter keys, including the per-file date and the branched-file origin; anchor marker syntax; the tag protocol, constrained by overlap — paired point markers interleave where nested delimiters cannot, making a bookmark an unpaired anchor and a tag a named pair; the split rule and its coordination requirement (D19); and how each degrades under hand-editing.

**One constraint to notice.** Carrying the date in per-file frontmatter has the same limitation as carrying it in the filename: one file, one date, so days can be split but never coalesced. At 2–3.5 MB a month that is comfortable — days will want splitting long before they want merging.
