// Curated sections, as files (D10, D53).
//
// **A section is a markdown document that happens to be a list of links.** It
// renders as one in any other tool, it is hand-editable by design (R20–R22,
// R26), and its ORDER is the order of the list — which is the whole argument
// D10 made for membership in a fileset over a flag scattered through the
// corpus: one file to read, with the order written in it.
//
// The PARSE is in `shared/fileset.ts`, because a fileset is a document and the
// renderer will meet one in the editor. What is here is everything that needs a
// Notebook: reading, walking the tree, and writing an entry into it.

import type { Notebook } from '../w/notebook.ts'
import { SECTIONS_DIR, sectionFile, type RelPath } from '../w/layout.ts'
import { parseFile, type Frontmatter } from './frontmatter.ts'
import { INDEX_SECTION, MAX_DEPTH, parseEntries } from '../../shared/fileset.ts'
import type { Reference, SectionRow, SectionTree } from '../../shared/nav-api.ts'

export { referenceOf } from '../../shared/fileset.ts'




/** One section file: its title from the frontmatter, its entries from the body. */
export function parseSection(text: string, path: RelPath): SectionTree {
  const parsed = parseFile(text)
  return {
    title: titleOf(parsed.frontmatter) ?? nameOf(path),
    path,
    entries: parseEntries(parsed.body),
  }
}

export class Filesets {
  readonly #notebook: Notebook

  constructor(notebook: Notebook) {
    this.#notebook = notebook
  }

  /**
   * The nav's whole curated tree, resolved.
   *
   * Cycles and depth are handled HERE rather than in the panel: it is one walk
   * with one rule, and a renderer that had to guard itself would be a second
   * implementation of the same rule (D53).
   */
  async tree(): Promise<SectionTree> {
    return this.#read(INDEX_SECTION as RelPath, new Set(), 0)
  }

  /** Every section file, for a "pin to…" list. */
  async all(): Promise<readonly { name: string; title: string; path: RelPath }[]> {
    const out: { name: string; title: string; path: RelPath }[] = []
    for (const rel of await this.#notebook.list(SECTIONS_DIR as RelPath)) {
      if (!rel.endsWith('.fileset.md') || rel === (INDEX_SECTION as RelPath)) continue
      const text = await this.#notebook.read(rel)
      if (text === null) continue
      out.push({ name: nameOf(rel), title: parseSection(text, rel).title, path: rel })
    }
    return out
  }

  async #read(path: RelPath, seen: ReadonlySet<string>, depth: number): Promise<SectionTree> {
    const text = await this.#notebook.read(path)
    if (text === null) return { title: nameOf(path), path: null, entries: [] }

    const section = parseSection(text, path)
    const within = new Set([...seen, path])
    const entries: SectionRow[] = []

    for (const entry of section.entries) {
      if (entry.target.kind !== 'section') {
        entries.push({ ...entry, missing: await this.#absent(entry.target) })
        continue
      }
      const child = sectionFile(entry.target.name)
      // A section already open above renders as a plain entry rather than
      // expanding again — which is what makes a hand-written cycle finite.
      const expandable = depth + 1 < MAX_DEPTH && !within.has(child)
      entries.push({
        ...entry,
        children: expandable ? await this.#read(child, within, depth + 1) : null,
        missing: !(await this.#notebook.has(child)),
      })
    }
    return { ...section, entries }
  }

  /** Only the targets this layer can check. Names resolve through the index. */
  async #absent(target: Reference): Promise<boolean> {
    if (target.kind === 'file') return !(await this.#notebook.has(target.path as RelPath))
    return false
  }
}

const nameOf = (path: string): string =>
  (path.split('/').pop() ?? path).replace(/\.fileset\.md$/, '').replace(/\.md$/, '')

/**
 * The section's own name for itself.
 *
 * `title` is not one of the frontmatter's known keys, so it arrives in `extra`
 * — which is exactly where unknown keys are meant to live, preserved verbatim
 * and in order (format-spec). Reading it from there rather than teaching the
 * parser a new key keeps the frontmatter contract as small as it is.
 */
const titleOf = (frontmatter: Frontmatter | null): string | null => {
  const found = frontmatter?.extra.find(([key]) => key.toLowerCase() === 'title')?.[1]
  return found !== undefined && found.trim() !== '' ? found.trim() : null
}
