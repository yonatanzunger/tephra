// Where a day's file splits (format-spec.md, "The split rule").
//
// A day splits when it exceeds 1 MB, at the last paragraph boundary at or
// before the threshold. Parts share a date and are ordered by `part`, and they
// coalesce into one date span above the storage layer (D20) — so a split is
// invisible to everything except the code that writes files.
//
// **The requirement is PREFIX-STABILITY, which is stronger than determinism and
// is the property that actually matters.** The boundary of part *k* must depend
// only on the content before it, so that appending never moves an existing
// split. A rule keyed to the total size, or to when a save happened, would be
// deterministic and still wrong: appending to a day would reshuffle its files
// and manufacture divergence out of nothing — a sync conflict conjured from a
// change nobody made.
//
// Scanning left to right and closing each part as soon as it can be closed is
// what buys that. No part's boundary is ever chosen with knowledge of what
// comes after it.

/**
 * 1 MB, measured rather than guessed: Spike A ran a 1.05 MB document at flat
 * cost. Note this is a different knob from the window extent — the window may
 * hold many days, and it is the extent, not the file size, that R1.1 depends on.
 */
export const SPLIT_THRESHOLD = 1_000_000

/** A run of two or more newlines ends a paragraph. */
const PARAGRAPH_BREAK = /\n{2,}/g

/**
 * Split a day's body into parts. A body at or under the threshold is one part,
 * which is the answer essentially always.
 *
 * Returns the parts in order; concatenating them reproduces the body exactly.
 * That is the invariant everything else rests on, and it is what lets the parts
 * be joined back into one day without remembering how they were divided.
 */
export function splitBody(body: string, threshold = SPLIT_THRESHOLD): readonly string[] {
  if (body.length <= threshold) return [body]

  const boundaries = paragraphBoundaries(body)
  const parts: string[] = []
  let start = 0

  while (body.length - start > threshold) {
    const limit = start + threshold

    // The last boundary at or before the limit — the rule as written.
    let cut = -1
    for (const b of boundaries) {
      if (b <= start) continue
      if (b <= limit) cut = b
      else break
    }

    if (cut === -1) {
      // A single paragraph larger than the threshold. Splitting inside it would
      // cut a sentence in half in a file a person may open in another editor,
      // so the paragraph is kept whole and the part is allowed to be oversized.
      // The alternative — cutting at exactly the threshold — trades a visible,
      // rare, harmless overflow for silent damage to the text.
      cut = boundaries.find(b => b > limit) ?? body.length
    }

    parts.push(body.slice(start, cut))
    start = cut
  }

  // Whatever is left, including nothing at all if the body ended on a boundary.
  if (start < body.length) parts.push(body.slice(start))
  return parts.length === 0 ? [body] : parts
}

/**
 * The offsets at which a paragraph ends — immediately after the run of blank
 * lines, so a part begins at the first character of a paragraph rather than at
 * the whitespace before it.
 */
function paragraphBoundaries(body: string): readonly number[] {
  const out: number[] = []
  PARAGRAPH_BREAK.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PARAGRAPH_BREAK.exec(body)) !== null) out.push(m.index + m[0].length)
  return out
}
