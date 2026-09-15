// Turning a person's name for something into a filename.
//
// **Shared because both processes need the SAME answer.** A theme's filename is
// its identity (D41), so the panel that creates one has to predict the name
// main will write it under; a rule living in main only would leave the renderer
// guessing at it, and a guess that is usually right is the worst kind.

/**
 * Filesystem-safe, readable, and stable. Not reversible, and not meant to be:
 * the file's own frontmatter is authoritative for its title (format-spec), so
 * the name only has to be a usable handle.
 */
export function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s === '' ? 'untitled' : s
}

/**
 * What a document is NAMED, from its path — the other name it has.
 *
 * **Shared because four places wanted it and had three answers.** `App.tsx`,
 * `notebook-service.ts` and `x/fileset.ts` each carried a copy of this rule, and
 * MH1 found them apart the way such things are always found: a docket appeared
 * in the sidebar as `house.docket` while the titlebar called it *The house*,
 * because only two of the three copies had learned the new suffix.
 *
 * **Every suffix this app puts on a document comes off**, including the ones a
 * multi-file kind wears on its directory (D59). What is left is the person's
 * words, slugged — which is why this is the *fallback* for a title and never the
 * title itself: `titleOf` is what they actually wrote.
 */
export function nameOf(path: string): string {
  return (path.split('/').pop() ?? path)
    .replace(/\.fileset\.md$/, '')
    .replace(/\.docket\.md$/, '')
    .replace(/\.todo\.md$/, '')
    .replace(/\.md$/, '')
    // A directory document wears its kind on the directory (D59).
    .replace(/\.(stream|todo)$/, '')
}
