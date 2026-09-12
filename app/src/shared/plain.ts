// A line of the corpus, as a reader would read it.
//
// **The file is what it appears to be** (R26, D20), which is the whole premise
// of the storage — and it means a line pulled out of a file for display carries
// everything a person wrote *and* everything the app wrote beside it. Shown
// raw, a task's context line reads
// `- [ ] Review Steve's bio draft #career DUE 2026-09-07 <!--tephra:item oqacmjoh 1788311075 1788397350-->`,
// which is the truth and is not the sentence.
//
// So: for the places that show a LINE rather than a document — the link
// directory's context, a menu's label, a rail's summary — this is what it says.

/** Everything the app wrote into the line, which a reader did not. */
const MARKERS = /<!--tephra:[^>]*-->/g

/**
 * The words, without the machinery.
 *
 * Markers go, and a task's bullet and checkbox go with them — a row that says
 * `- [ ]` in a list of links is showing its filing system. What stays is tags
 * and due dates, because a person typed those and meant them (T16).
 *
 * **Link markup stays too**, and that is the point: a caller that can draw
 * links draws them live, in the sentence, exactly where they were written. Only
 * a caller that cannot — a `<button>`'s label, a menu item — flattens as well,
 * with `flattenLinks`, and the two compose in that order.
 *
 * **And there is a third rung, which is not here**: a surface that has already
 * put the date in its own column and has no room for a chip wants the tags and
 * the due date off as well. That is `shortLine` in `kinds/todo.ts`, where the
 * grammar it has to cut is defined — it works from the item's own spans rather
 * than re-matching, which is why it cannot live in a module that only has a
 * string.
 */
export function plainLine(text: string): string {
  return text
    .replace(MARKERS, '')
    .replace(/^\s*[-*+]\s+(\[.\]\s*)?/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
