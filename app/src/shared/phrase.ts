// Finding a phrase in a line (MS1, MS3).
//
// **One matcher, because there are two readers.** The engine in main scans files
// with it; the renderer marks the loaded buffer with it so you can see where the
// other matches are. Two copies would be two ideas of what *adjacent* means, and
// the marks would sit where the walk does not go — which is the failure
// `links.ts` already had once and `tags.ts` was moved to prevent (D61, T16).

import type { QueryNode } from './search-api.ts'

/** Everything the app wrote into a line, which nobody searched for. */
const MARKERS = /<!--tephra:[^>]*-->/g

/**
 * The phrase as something to run over text. Null when there is nothing to find.
 *
 * **Terms separated by whitespace, not by a literal space**, because a line may
 * wrap its words differently from the query — and this is the one place the
 * meaning of *adjacent* is decided.
 */
export function phraseRegex(find: QueryNode, fold: boolean): RegExp | null {
  if (find.of.length === 0) return null
  const source = find.of.map(term => escape(term.text)).join('\\s+')
  return new RegExp(source, fold ? 'giu' : 'gu')
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface Match {
  readonly from: number
  readonly to: number
}

/**
 * Every match in a piece of text, with the machinery excluded.
 *
 * **A match inside a marker is not a match.** `<!--tephra:tag-start house
 * deal-->` is the filing system, and finding *house deal* in it would report the
 * app's own writing as though it were somebody's (`plain.ts` makes the same
 * point for display).
 */
export function matchesIn(text: string, match: RegExp): readonly Match[] {
  const machinery: Match[] = []
  MARKERS.lastIndex = 0
  for (let m = MARKERS.exec(text); m !== null; m = MARKERS.exec(text)) {
    machinery.push({ from: m.index, to: m.index + m[0].length })
  }
  const out: Match[] = []
  match.lastIndex = 0
  for (let m = match.exec(text); m !== null; m = match.exec(text)) {
    const at = { from: m.index, to: m.index + m[0].length }
    if (!machinery.some(span => at.from < span.to && span.from < at.to)) out.push(at)
    // A zero-width match cannot happen with a non-empty phrase, but a regex that
    // never advances hangs the caller, and the guard costs one comparison.
    if (match.lastIndex <= m.index) match.lastIndex = m.index + 1
  }
  return out
}
