// Applying, inverting and mapping through a batch of edits.
//
// Pure string arithmetic on numeric offsets — no documents, no segments, no
// generations. Everything above this reduces to it, which is why it is worth
// having on its own where it can be tested exhaustively.
//
// A BATCH is the unit, not a single edit (D20). Every span is relative to the
// PRE-EDIT state, the batch is sorted and non-overlapping, and it applies
// atomically. Sequential application would need each edit to be expressed
// against the result of the previous one, which is a coordinate system nobody
// can hold in their head.

/**
 * An edit within ONE string, in that string's own coordinates.
 *
 * Generic over the kind of text, so an edit to a segment's document text and an edit
 * to the editor's prose cannot be handed to each other by accident (D44). The
 * default keeps the many call sites that genuinely do not care unchanged.
 */
export interface TextEdit<T extends string = string> {
  readonly from: number
  readonly to: number // from === to ⇒ insert
  readonly insert: T // '' ⇒ delete
}

export class OverlappingEditsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OverlappingEditsError'
  }
}

/** Sorted ascending, non-overlapping, within bounds. Throws rather than guessing. */
export function checkBatch(text: string, edits: readonly TextEdit[]): void {
  let previousEnd = -1
  for (const e of edits) {
    if (e.from > e.to) throw new OverlappingEditsError(`inverted span ${e.from}..${e.to}`)
    if (e.from < 0 || e.to > text.length) {
      throw new OverlappingEditsError(`span ${e.from}..${e.to} outside text of ${text.length}`)
    }
    if (e.from < previousEnd) {
      throw new OverlappingEditsError(`edit at ${e.from} overlaps one ending at ${previousEnd}`)
    }
    previousEnd = e.to
  }
}

export function applyEdits<T extends string>(text: T, edits: readonly TextEdit<T>[]): T {
  checkBatch(text, edits)
  if (edits.length === 0) return text
  const out: string[] = []
  let cursor = 0
  for (const e of edits) {
    out.push(text.slice(cursor, e.from), e.insert)
    cursor = e.to
  }
  out.push(text.slice(cursor))
  return out.join('') as T
}

/**
 * The batch that undoes `edits`, expressed against the POST-edit text.
 *
 * This is what makes undo possible at all: an Edit says what to put in, never
 * what was taken out, so the replaced text has to be captured at the moment it
 * is replaced. There is nowhere later to recover it from.
 */
export function invertEdits<T extends string>(text: T, edits: readonly TextEdit<T>[]): TextEdit<T>[] {
  checkBatch(text, edits)
  const out: TextEdit<T>[] = []
  let drift = 0
  for (const e of edits) {
    const from = e.from + drift
    out.push({ from, to: from + e.insert.length, insert: text.slice(e.from, e.to) as T })
    drift += e.insert.length - (e.to - e.from)
  }
  return out
}

/**
 * Where an offset ends up after a batch, or null if the text it named is gone.
 *
 * `assoc` decides what happens to a position sitting exactly at an insertion
 * point: 'before' keeps it ahead of the inserted text, 'after' moves it along.
 * A cursor wants 'after' — you type, the cursor follows what you typed — while
 * the start of a range wants 'before' so the range grows rather than being
 * pushed aside.
 */
export function mapOffset(
  offset: number,
  edits: readonly TextEdit[],
  assoc: 'before' | 'after' = 'after',
): number | null {
  let drift = 0
  for (const e of edits) {
    if (e.from > offset) break // entirely after: nothing more can affect it

    if (e.to <= offset) {
      // An insertion sitting exactly at the position must be tested BEFORE the
      // "entirely before" case, or its zero-length span satisfies `to <= offset`
      // and the association is never consulted at all.
      if (e.from === e.to && e.from === offset) {
        if (assoc === 'before') return offset + drift
        drift += e.insert.length // 'after': follow it, and keep going — a second
        continue //                 insertion at the same point must also count
      }
      // Entirely before the position: it slides by the size difference.
      drift += e.insert.length - (e.to - e.from)
      continue
    }

    if (offset === e.from) return offset + drift
    // The named text was replaced or deleted. Saying "it moved to the edge"
    // would be inventing a location for something that no longer exists.
    return null
  }
  return offset + drift
}

/** Compose two batches into one, expressed against the original text. */
export function composeEdits<T extends string>(
  text: T,
  first: readonly TextEdit<T>[],
  second: readonly TextEdit<T>[],
): TextEdit<T>[] {
  // Deliberately not clever: apply, diff the ends, and emit one replacement.
  // A general composition is subtle enough to get wrong quietly, and this is
  // only ever used to fold a rewind into a single change record.
  const middle = applyEdits(text, first)
  const final = applyEdits(middle, second)
  return [minimalReplacement(text, final)].filter(e => e !== null)
}

/**
 * One replacement covering everything that differs, trimmed at both ends.
 *
 * Generic so the brand survives: given two prose strings it produces an edit to
 * prose, and given two document bodies an edit to document text. Flattening both
 * to `string` here is how a document's payload once reached the editor.
 */
export function minimalReplacement<T extends string>(before: T, after: T): TextEdit<T> | null {
  if (before === after) return null
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before[start] === after[start]) start++

  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--
    endAfter--
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) as T }
}
