// The position algebra — one of only two places permitted to know that an
// DocumentOffset is counted in UTF-16 code units (D24). The other is the window adapter.
//
// Everything here is pure and synchronous. `advance` and `distance` are
// deliberately absent: crossing a segment boundary needs content, so they live
// on DocumentWindow (synchronous, within the loaded region) and on Document
// (asynchronous). They are not free functions and should not become them.

import type {
  DocumentPosition,
  DocumentOffset,
  SegmentKey,
  SessionGeneration,
  Span,
  WindowPosition,
} from './document-api.ts'

/**
 * Thrown when a position or span from a superseded generation is used, and
 * the caller did not ask to read at that generation. Failing loudly is what
 * turns T1 — an operation computed against text that has since moved — from
 * silent corruption into a visible error.
 */
export class StalePositionError extends Error {
  // Written out rather than as constructor parameter properties: those emit
  // runtime code, so Node's type-stripping rejects them and the shared types
  // would stop being importable from a plain test.
  readonly expected: SessionGeneration
  readonly got: SessionGeneration

  constructor(expected: SessionGeneration, got: SessionGeneration) {
    super(`position is from generation ${got}, expected ${expected}`)
    this.name = 'StalePositionError'
    this.expected = expected
    this.got = got
  }
}

// ─────────────────────────────────────────────────────────────
// Constructors — the only places a brand is applied
// ─────────────────────────────────────────────────────────────

/** True when `n` would land between the halves of a surrogate pair. */
function splitsSurrogatePair(text: string, n: number): boolean {
  if (n <= 0 || n >= text.length) return false
  const hi = text.charCodeAt(n - 1)
  const lo = text.charCodeAt(n)
  return hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff
}

/**
 * Implementation-only constructor. Validates the surrogate invariant.
 *
 * Asserted at construction rather than discovered at a render: an offset
 * between the halves of a pair produces a lone surrogate, which is not a
 * character, and the symptom appears far from the cause.
 */
export function offsetOf(n: number, inText: string): DocumentOffset {
  if (!Number.isInteger(n)) throw new RangeError(`offset must be an integer, got ${n}`)
  if (n < 0 || n > inText.length) {
    throw new RangeError(`offset ${n} is outside text of length ${inText.length}`)
  }
  if (splitsSurrogatePair(inText, n)) {
    throw new RangeError(`offset ${n} falls between the halves of a surrogate pair`)
  }
  return n as DocumentOffset
}

/** The same invariant, for the window's own coordinate. */
export function windowPositionOf(n: number, inText: string): WindowPosition {
  offsetOf(n, inText) // identical validation; throws on the same conditions
  return n as WindowPosition
}

export function positionOf(
  segment: SegmentKey,
  offset: DocumentOffset,
  generation: SessionGeneration,
): DocumentPosition {
  return { segment, offset, generation }
}

export function compareGenerations(a: SessionGeneration, b: SessionGeneration): number {
  return a - b
}

// ─────────────────────────────────────────────────────────────
// The algebra
// ─────────────────────────────────────────────────────────────

/**
 * Lexicographic: segment, then offset.
 *
 * REQUIRES BOTH POSITIONS AT THE SAME GENERATION, and throws otherwise. Two
 * positions from different generations index different texts, so any ordering
 * between them is meaningless — and silently returning one is exactly the
 * T1 shape this design keeps converting into loud failures. Map one forward
 * first if you genuinely mean to compare across a change.
 */
export function comparePositions(a: DocumentPosition, b: DocumentPosition): number {
  if (a.generation !== b.generation) throw new StalePositionError(a.generation, b.generation)
  if (a.segment !== b.segment) return a.segment < b.segment ? -1 : 1
  return a.offset - b.offset
}

/** Half-open [begin, end). Throws if the ends disagree about generation. */
export function spanOf(begin: DocumentPosition, end: DocumentPosition): Span {
  if (begin.generation !== end.generation) {
    throw new StalePositionError(begin.generation, end.generation)
  }
  return { begin, end }
}

/** A zero-length span, which is how a point is expressed. */
export function pointAt(at: DocumentPosition): Span {
  return { begin: at, end: at }
}

export function isEmpty(span: Span): boolean {
  return comparePositions(span.begin, span.end) === 0
}

/** Half-open, so the end position is not contained. */
export function contains(span: Span, at: DocumentPosition): boolean {
  return comparePositions(span.begin, at) <= 0 && comparePositions(at, span.end) < 0
}

/**
 * Half-open, so spans that merely touch do not intersect. Two empty spans at
 * the same point do not intersect either — there is no extent to share.
 */
export function intersects(a: Span, b: Span): boolean {
  return comparePositions(a.begin, b.end) < 0 && comparePositions(b.begin, a.end) < 0
}
