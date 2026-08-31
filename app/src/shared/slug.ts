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
