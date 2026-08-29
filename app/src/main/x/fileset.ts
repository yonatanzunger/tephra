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

import type { Corpus } from './documents/corpus.ts'
import { SECTIONS_DIR, sectionFile, type RelPath } from '../w/layout.ts'
import { parseFile, type Frontmatter } from './frontmatter.ts'
import {
  INDEX_SECTION, MAX_DEPTH, PINNED_SECTION, entryLine, parseEntries, targetOf,
} from '../../shared/fileset.ts'
import type { Reference, SectionRow, SectionTree } from '../../shared/nav-api.ts'
import { ONLY_SEGMENT, type DocumentId, type DocumentText } from '../../shared/document-api.ts'

export { referenceOf } from '../../shared/fileset.ts'




/**
 * One section file: its entries from the body, its title from the document.
 *
 * Takes the title rather than digging it out, because the frontmatter is
 * storage and the document has already read it — see `titleOf` on the document
 * (D54). Falls back to the filename, which is the only other name it has.
 */
export function parseSection(body: string, path: RelPath, title: string | null): SectionTree {
  return { title: title ?? nameOf(path), path, entries: parseEntries(body) }
}

export class Filesets {
  readonly #corpus: Corpus

  constructor(corpus: Corpus) {
    this.#corpus = corpus
  }

  /**
   * One section file's text, or null if there is no such section.
   *
   * **Through the document, never off the disk** (D54). A fileset is a document
   * — it can be open in a window with edits nobody has written yet — so reading
   * the file would show what was saved while the editor showed what was typed.
   */
  async #read_(path: RelPath): Promise<{ body: string; title: string | null } | null> {
    if (!(await this.#corpus.exists(path as string as DocumentId))) return null
    return this.#corpus.use(
      path as string as DocumentId,
      async doc => ({
        body: (await doc.bodyOf(ONLY_SEGMENT)) as string,
        title: await doc.titleOf(ONLY_SEGMENT),
      }),
      { mode: 'read' },
    )
  }

  /** Just the text, for the paths that rewrite it. */
  async #text(path: RelPath): Promise<string | null> {
    return (await this.#read_(path))?.body ?? null
  }

  /**
   * Rewrite a section, as an ordinary edit.
   *
   * Which makes a pin undoable, versioned and journalled for free — D53 claimed
   * all three and none were true while this wrote files behind the document
   * layer's back (D54).
   */
  async #write(path: RelPath, text: string): Promise<void> {
    const id = path as string as DocumentId
    await this.#corpus.use(id, async doc => doc.setBodyOf(ONLY_SEGMENT, text as DocumentText))
  }

  /**
   * The nav's whole curated tree, resolved.
   *
   * Cycles and depth are handled HERE rather than in the panel: it is one walk
   * with one rule, and a renderer that had to guard itself would be a second
   * implementation of the same rule (D53).
   */
  async tree(): Promise<SectionTree> {
    const ordered =
      (await this.#corpus.exists(INDEX_SECTION as unknown as DocumentId))
        ? await this.#read(INDEX_SECTION as RelPath, new Set(), 0)
        : { title: 'Sections', path: null, entries: [] as readonly SectionRow[] }

    // **THE ORDER ORDERS; IT DOES NOT GATE.** A section file that nobody has
    // named in the list is still a section, and hiding it is how a pin came to
    // look like it did nothing: the entry was written, the file was right, and
    // the panel showed nothing because the order was empty. The same would
    // happen to a section made by hand, or one that arrived from sync ahead of
    // the index.
    //
    // So: what is named comes first, in the order it is named, and everything
    // else follows — pinned first among them, then by title.
    const named = new Set(
      ordered.entries.flatMap(entry => (entry.target.kind === 'section' ? [entry.target.name] : [])),
    )
    const rest = [...(await this.all())]
      .filter(section => !named.has(section.name))
      .sort((a, b) =>
        a.name === PINNED_SECTION ? -1 : b.name === PINNED_SECTION ? 1 : a.title.localeCompare(b.title),
      )

    return {
      ...ordered,
      entries: [
        ...ordered.entries,
        ...(await Promise.all(
          rest.map(async section => ({
            label: section.title,
            summary: null,
            target: { kind: 'section', name: section.name } as Reference,
            children: await this.#read(section.path, new Set(), 1),
            missing: false,
          })),
        )),
      ],
    }
  }

  /** Every section file, for a "pin to…" list. */
  async all(): Promise<readonly { name: string; title: string; path: RelPath }[]> {
    const out: { name: string; title: string; path: RelPath }[] = []
    for (const id of await this.#corpus.list('fileset')) {
      const rel = id as string as RelPath
      if (rel === (INDEX_SECTION as RelPath)) continue
      const found = await this.#read_(rel)
      if (found === null) continue
      out.push({ name: nameOf(rel), title: found.title ?? nameOf(rel), path: rel })
    }
    return out
  }

  /**
   * Put a reference into a section (D53).
   *
   * **An append to a markdown file, and deliberately nothing more.** The entry
   * is a line someone could have typed; the file is committed by the ordinary
   * version tier; the label is editable afterwards by editing the file. What
   * this is NOT is a second store of pinned things, which is what "pinning is a
   * property" would have needed (D10).
   *
   * Pinning the same thing twice is a no-op rather than a duplicate: the
   * gesture is idempotent because a person who cannot see the section they are
   * pinning into will press it twice.
   *
   * **Takes a PATH, not a section's name.** A name goes through `slug()` on the
   * way to a filename, and `slug` is lossy on purpose — it exists to turn a
   * person's title into something a filesystem accepts. `_index` came back as
   * `index`, so unpinning from the top-level list wrote to a file that did not
   * exist and reported nothing: the button did nothing, silently, and every
   * test passed because they all used a name that survives slugging.
   */
  async pin(
    reference: Reference,
    label: string,
    into: string = sectionFile(PINNED_SECTION),
  ): Promise<'pinned' | 'already'> {
    const path = into as RelPath
    const body = (await this.#text(path)) ?? ''

    // Compared as REFERENCES rather than as text: `tephra:tag/House%20Deal` and
    // `tephra:tag/House Deal` are the same pin written two ways, and a person
    // hand-editing the file will write the readable one.
    const already = parseEntries(body).some(
      entry => targetOf(entry.target) === targetOf(reference),
    )
    if (already) return 'already'

    const line = entryLine(label, reference)
    const text = body.trim() === '' ? `${line}\n` : `${body.replace(/\n*$/, '')}\n${line}\n`
    await this.#write(path, text)
    await this.#name(path)
    await this.#ensureOrdered(path)
    return 'pinned'
  }

  /**
   * Give a section a name if it has none.
   *
   * A title is the document's, not the file's (D54) — so this asks the document
   * rather than composing frontmatter, which is how a fileset written by hand
   * keeps the title its author chose. Only ever fills a blank.
   */
  async #name(path: RelPath): Promise<void> {
    await this.#corpus.use(
      path as string as DocumentId,
      async doc => {
        if ((await doc.titleOf(ONLY_SEGMENT)) === null) {
          await doc.setTitleOf(ONLY_SEGMENT, defaultTitle(path))
        }
      },
      { mode: 'write' },
    )
  }

  /**
   * A section the sidebar can actually reach.
   *
   * **A pin nobody can see is not a pin.** Writing the file is not enough once a
   * top-level order exists: the panel shows the order, and a section written
   * before it was named there is invisible. The first pin in a notebook with an
   * order therefore does two things — the entry, and the section's place in the
   * list — which is the same edit twice, one level up.
   *
   * Only when the order exists. Without one the panel lists whatever filesets
   * are there, and writing an order nobody asked for would freeze an
   * arrangement the person has not chosen yet.
   */
  async #ensureOrdered(section: RelPath): Promise<void> {
    const index = INDEX_SECTION as RelPath
    const text = await this.#text(index)
    if (text === null) return

    const name = nameOf(section)
    const target: Reference = { kind: 'section', name }
    const listed = parseEntries(text).some(
      entry => targetOf(entry.target) === targetOf(target),
    )
    if (listed) return

    const title = (await this.#read_(section))?.title ?? humanise(name)
    await this.#write(index, `${text.replace(/\n*$/, '')}\n${entryLine(title, target)}\n`)
  }

  /**
   * Take a reference out of a section (D53).
   *
   * The inverse of `pin`, and the same kind of act: **one line removed from a
   * markdown file.** Everything else about the entry — a label someone chose, a
   * summary they wrote — goes with it, which is why the gesture is worth
   * confirming in the UI and worth being a single line here.
   */
  async unpin(reference: Reference, from: string = sectionFile(PINNED_SECTION)): Promise<boolean> {
    const path = from as RelPath
    const text = await this.#text(path)
    if (text === null) return false

    const wanted = targetOf(reference)
    const lines = text.split('\n')
    const kept = lines.filter(line => {
      const [entry] = parseEntries(line)
      return entry === undefined || targetOf(entry.target) !== wanted
    })
    if (kept.length === lines.length) return false
    await this.#write(path, kept.join('\n'))
    return true
  }

  async #read(path: RelPath, seen: ReadonlySet<string>, depth: number): Promise<SectionTree> {
    const found = await this.#read_(path)
    if (found === null) return { title: nameOf(path), path: null, entries: [] }

    const section = parseSection(found.body, path, found.title)
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
        missing: !(await this.#corpus.exists(child as string as DocumentId)),
      })
    }
    return { ...section, entries }
  }

  /** Only the targets this layer can check. Names resolve through the index. */
  async #absent(target: Reference): Promise<boolean> {
    if (target.kind === 'file') return !(await this.#corpus.exists(target.path as unknown as DocumentId))
    return false
  }
}

/** What a section is called before anyone has renamed it. */
function defaultTitle(path: RelPath): string {
  const name = nameOf(path)
  return name === '_index' ? 'Sections' : humanise(name)
}

const humanise = (name: string): string =>
  name.replace(/[-_]+/g, ' ').replace(/^./, first => first.toUpperCase())

const nameOf = (path: string): string =>
  (path.split('/').pop() ?? path).replace(/\.fileset\.md$/, '').replace(/\.md$/, '')

