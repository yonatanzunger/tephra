// Curated sections, as files (D10, D53).
//
// **A section is a markdown document that happens to be a list of links.** It
// renders as one in any other tool, it is hand-editable by design (R20–R22,
// R26), and its ORDER is the order of the list — which is the whole argument
// D10 made for membership in a fileset over a flag scattered through the
// corpus: one file to read, with the order written in it.
//
// The PARSE is in `shared/fileset.ts`, because a fileset is a document and the
// renderer will meet one in the editor. The VERBS are in the fileset kind
// (`x/documents/kinds/fileset.ts`), because a change to a fileset is an edit to
// a document. What is left here is the part that is about no single section:
// walking the tree, resolving what the entries point at, and deciding what the
// panel sees when the order and the directory disagree.

import type { Corpus } from './documents/corpus.ts'
import { nameOf } from '../../shared/slug.ts'
import { asFileset, type FilesetDocument } from './documents/kinds/fileset.ts'
import {
  documentRoot,
  SECTIONS_DIR, STREAM_DIR, relativePath, relativeTo, sectionFile, type RelPath,
} from '../w/layout.ts'
import {
  INDEX_SECTION, MAX_DEPTH, PINNED_SECTION, parseEntries, sameTarget,
} from '../../shared/fileset.ts'
import type { Reference, SectionRow, SectionTree } from '../../shared/nav-api.ts'
import { ONLY_SEGMENT, type DocumentId } from '../../shared/document-api.ts'

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
   * Borrow one section, as the fileset it is.
   *
   * **Through the document, never off the disk** (D54). A fileset can be open
   * in a window with edits nobody has written yet, so reading the file would
   * show what was saved while the editor showed what was typed — and writing it
   * would throw the second away.
   */
  async #use<T>(path: RelPath, work: (doc: FilesetDocument) => Promise<T>): Promise<T> {
    return this.#corpus.use(path as string as DocumentId, doc => work(asFileset(doc)))
  }

  /** The same, for a section that may not be there. Null means there is none. */
  async #peek<T>(path: RelPath, work: (doc: FilesetDocument) => Promise<T>): Promise<T | null> {
    if (!(await this.#corpus.exists(path as string as DocumentId))) return null
    return this.#corpus.use(path as string as DocumentId, doc => work(asFileset(doc)), { mode: 'read' })
  }

  /** What one section holds and what it is called — the pair every walk needs. */
  async #contents(path: RelPath): Promise<{ title: string | null; entries: readonly SectionRow[] } | null> {
    return this.#peek(path, async doc => ({
      title: await doc.titleOf(ONLY_SEGMENT),
      entries: await doc.entries(),
    }))
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
            document: section.path as string as DocumentId,
            pinned: false, // a section the order does not name — present, not listed
            children: await this.#read(section.path, new Set(), 1),
            missing: false,
          })),
        )),
        // And a section per directory, after what someone curated: those are
        // chosen, these are simply what is in the notebook (D10).
        ...(await this.#directorySections()).map(section => ({
          label: section.title,
          summary: null,
          target: { kind: 'section', name: section.title } as Reference,
          // **A directory is not a document.** Its listing is derived from what
          // is on disk rather than written anywhere, so there is nothing to
          // rename or delete — which is exactly what a null says, and why the
          // panel offers those verbs on a curated section and not on this.
          document: null,
          pinned: false,
          children: section,
          missing: false,
        })),
      ],
    }
  }

  /**
   * A section per DIRECTORY, so a file that arrives can be found (D10, D53).
   *
   * **The problem this solves is invisibility.** A note imported, branched or
   * dropped into `notes/` by hand is a document in the corpus that nothing in
   * the panel names — the curated sections list what someone chose to pin, and
   * a file nobody has pinned yet is a file nobody can see.
   *
   * **Derived, not written.** The obvious alternative is to put an
   * `_index.fileset.md` in every directory and append to it whenever a file
   * appears. That costs a file in every directory of somebody's notebook that
   * they did not ask for, a write on every arrival, and a watcher that has to
   * not miss one — and it can be wrong, because a file can arrive while the app
   * is closed. Reading the directory cannot be wrong: a file is listed because
   * it is THERE.
   *
   * **The order orders; it does not gate** — the same rule as the top level,
   * for the same reason (D53). If `<dir>/_index.fileset.md` exists it decides
   * the order and the labels; everything else in the directory follows it, by
   * name. So curating a directory is exactly as it is anywhere else, and until
   * someone does, the listing is simply what is on disk.
   */
  async #directorySections(): Promise<readonly SectionTree[]> {
    const byDirectory = new Map<string, RelPath[]>()
    for (const id of await this.#corpus.list()) {
      const rel = id as string as RelPath
      const cut = rel.indexOf('/')
      if (cut <= 0) continue // a document at the root belongs to no directory

      const dir = rel.slice(0, cut)
      // **A file inside a directory document belongs to that document** (D59),
      // so it is not a document of its own and has no business in a listing —
      // the stream's five thousand days least of all. Asked generically rather
      // than by name, because the next such kind is a todo list and the answer
      // is the same one.
      if (documentRoot(rel) !== null) continue
      // `sections/` holds the sections themselves; a section listing the
      // sections is the list twice.
      if (dir === SECTIONS_DIR) continue
      if (nameOf(rel) === '_index') continue // the listing is not in its own list

      const held = byDirectory.get(dir)
      if (held === undefined) byDirectory.set(dir, [rel])
      else held.push(rel)
    }

    const out: SectionTree[] = []
    for (const [dir, documents] of [...byDirectory].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(await this.#directory(dir, documents))
    }
    return out
  }

  /** One directory's section: its own order first, then whatever else is there. */
  async #directory(dir: string, documents: readonly RelPath[]): Promise<SectionTree> {
    const index = `${dir}/${nameOf(INDEX_SECTION)}.fileset.md` as RelPath
    const curated = await this.#contents(index)

    // Matched by what an entry POINTS AT, so a curated line keeps its label and
    // its place: the same document reached two ways is one entry.
    const listed = new Set(
      (curated?.entries ?? []).flatMap(entry =>
        entry.target.kind === 'file' ? [relativeTo(index, entry.target.path) ?? ''] : [],
      ),
    )
    const rest = [...documents]
      .filter(rel => !listed.has(rel))
      .sort((a, b) => a.localeCompare(b))
      .map(rel => ({
        // The FILENAME, not the document's title. Reading a title means opening
        // every document in the directory every time the panel draws, and the
        // name on disk is the one the person chose anyway — a nicer label is
        // what curating the directory is for.
        label: nameOf(rel),
        summary: null,
        target: { kind: 'file', path: relativePath(index, rel) } as Reference,
        document: rel as string as DocumentId,
        // The derived half of the listing: here because the document is in the
        // directory, not because a line names it.
        pinned: false,
        children: null,
        missing: false,
      }))

    return {
      title: curated?.title ?? humanise(dir),
      // Null until the file exists: a derived listing has no line to unpin,
      // and offering the gesture would be offering to edit nothing. `base` is
      // the other half — where the entries resolve FROM, which is that file
      // whether or not it has been written yet.
      path: curated === null ? null : index,
      base: index,
      entries: [...(curated?.entries ?? []), ...rest],
    }
  }

  /**
   * Every SECTION file, for a "pin to…" list.
   *
   * **A section is a fileset in `sections/`, not any fileset anywhere.** The
   * two were the same thing until directories got their own listings: a
   * `notes/_index.fileset.md` is a fileset, and it was being picked up here as
   * a top-level section — so the directory appeared twice, once as itself and
   * once as a curated section with only its curated entries in it. A fileset
   * kept somewhere else is a document, and shows up as one.
   */
  async all(): Promise<readonly { name: string; title: string; path: RelPath }[]> {
    const out: { name: string; title: string; path: RelPath }[] = []
    for (const id of await this.#corpus.list('fileset')) {
      const rel = id as string as RelPath
      if (rel === (INDEX_SECTION as RelPath)) continue
      if (!rel.startsWith(`${SECTIONS_DIR}/`)) continue
      const title = await this.#peek(rel, doc => doc.titleOf(ONLY_SEGMENT))
      out.push({ name: nameOf(rel), title: title ?? nameOf(rel), path: rel })
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
    const outcome = await this.#use(path, doc => doc.pin(reference, label))
    if (outcome === 'already') return outcome

    await this.#name(path)
    await this.#ensureOrdered(path)
    return outcome
  }

  /**
   * Give a section a name if it has none.
   *
   * A title is the document's, not the file's (D54) — so this asks the document
   * rather than composing frontmatter, which is how a fileset written by hand
   * keeps the title its author chose. Only ever fills a blank.
   */
  async #name(path: RelPath): Promise<void> {
    await this.#use(path, async doc => {
      if ((await doc.titleOf(ONLY_SEGMENT)) === null) {
        await doc.setTitleOf(ONLY_SEGMENT, defaultTitle(path))
      }
    })
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
    const listed = await this.#peek(index, doc => doc.entries())
    if (listed === null) return // no order yet, and inventing one freezes an arrangement nobody chose

    const name = nameOf(section)
    const target: Reference = { kind: 'section', name }
    if (listed.some(entry => sameTarget(entry.target, target))) return

    const title = (await this.#peek(section, doc => doc.titleOf(ONLY_SEGMENT))) ?? humanise(name)
    await this.#use(index, doc => doc.pin(target, title))
  }

  /**
   * Point every entry that named `from` at `to` instead.
   *
   * **This is D13's "update references" step**, which has been present and
   * empty since `branch` was built, with a note saying sections are the finite
   * set that must be rewritten and that they arrive in M3. They have.
   *
   * Finite is what makes it possible: a fileset is the only kind of document
   * that names another ON PURPOSE, as data rather than as prose. A link typed
   * into a day is a sentence, and rewriting somebody's sentences because a file
   * moved is a larger and more frightening act than renaming was.
   *
   * Each entry is compared by what it RESOLVES to, not by its text: the same
   * document is `../notes/x.md` from one section and `x.md` from another, and
   * the new link is written relative to the file it is going into.
   */
  async retarget(from: RelPath, to: RelPath): Promise<number> {
    // **A section is named, not linked**, so the same rename has two shapes to
    // rewrite. `_index` says `tephra:section/house`; a note is `../notes/x.md`.
    // Handling only the second was enough until sections could be renamed, and
    // would then have left the top-level order naming a file that had moved —
    // the exact dangle this whole method exists to prevent.
    const renamedSection = isSectionFile(from) && isSectionFile(to) ? nameOf(from) : null

    let changed = 0
    for (const id of await this.#corpus.list('fileset')) {
      const path = id as string as RelPath
      const entries = await this.#peek(path, doc => doc.entries())
      if (entries === null) continue

      for (const entry of entries) {
        if (entry.target.kind === 'section') {
          if (renamedSection === null || entry.target.name !== renamedSection) continue
          await this.#use(path, doc =>
            doc.rewrite(entry.target, { target: { kind: 'section', name: nameOf(to) } }),
          )
          changed++
          continue
        }
        if (entry.target.kind !== 'file') continue
        if (relativeTo(path, entry.target.path) !== from) continue
        // Through the document, so the rewrite is an ordinary edit: undoable,
        // journalled, and visible to a window with that section open (D54).
        //
        // **Where it stands.** Removing the line and appending a new one is the
        // same set in a different order, and a curated list's order is the part
        // somebody chose — a rename would have moved the renamed document to
        // the bottom of every section naming it.
        await this.#use(path, doc =>
          doc.rewrite(entry.target, { target: { kind: 'file', path: relativePath(path, to) } }),
        )
        changed++
      }
    }
    return changed
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
    if (!(await this.#corpus.exists(path as string as DocumentId))) return false
    return this.#use(path, doc => doc.unpin(reference))
  }

  /**
   * Change what an entry is CALLED, leaving what it points at alone (D53).
   *
   * The label is the one part of a row that is nobody's business but the
   * person who wrote it: the target is a fact about the notebook, the summary
   * is prose, and the label is what they decided to call this thing HERE. The
   * same document is "The offer" in one section and "Counter" in another, and
   * that is a feature of a curated list rather than an inconsistency to fix.
   */
  async relabel(reference: Reference, label: string, from: string): Promise<boolean> {
    const path = from as RelPath
    const wanted = label.trim()
    if (wanted === '') return false
    if (!(await this.#corpus.exists(path as string as DocumentId))) return false
    return this.#use(path, doc => doc.rewrite(reference, { label: wanted }))
  }

  async #read(path: RelPath, seen: ReadonlySet<string>, depth: number): Promise<SectionTree> {
    const found = await this.#contents(path)
    if (found === null) return { title: nameOf(path), path: null, entries: [] }

    const section: SectionTree = { title: found.title ?? nameOf(path), path, entries: found.entries }
    const within = new Set([...seen, path])
    const entries: SectionRow[] = []

    for (const entry of section.entries) {
      if (entry.target.kind !== 'section') {
        const document = await this.#resolve(entry.target, path)
        entries.push({ ...entry, document, missing: entry.target.kind === 'file' && document === null })
        continue
      }
      const child = sectionFile(entry.target.name)
      // A section already open above renders as a plain entry rather than
      // expanding again — which is what makes a hand-written cycle finite.
      const expandable = depth + 1 < MAX_DEPTH && !within.has(child)
      entries.push({
        ...entry,
        // A section IS a document — a fileset in `sections/` — and naming it
        // here is what lets a section be renamed and deleted like anything
        // else. What that does to the entries inside it is the caller's
        // problem, and D7's answer: they dangle, visibly.
        document: (await this.#corpus.exists(child as string as DocumentId))
          ? (child as string as DocumentId)
          : null,
        children: expandable ? await this.#read(child, within, depth + 1) : null,
        missing: !(await this.#corpus.exists(child as string as DocumentId)),
      })
    }
    return { ...section, entries }
  }

  /**
   * What document an entry names, if any. Names resolve through the index.
   *
   * **A file entry is relative to the SECTION it is written in**, the way a
   * markdown link is relative to its own file. Resolving it against the
   * notebook root instead made every correct `../notes/x.md` report itself as
   * missing — a real file, a good link, and a row that said "not found".
   *
   * Null covers both "not a file" and "not there", which the caller separates:
   * only a file target that resolves to nothing is MISSING. A tag or an anchor
   * is not a document and is not missing either.
   */
  async #resolve(target: Reference, from: RelPath): Promise<DocumentId | null> {
    if (target.kind !== 'file') return null
    const at = relativeTo(from, target.path)
    if (at === null || !(await this.#corpus.exists(at as string as DocumentId))) return null
    return at as string as DocumentId
  }
}

/** What a section is called before anyone has renamed it. */
function defaultTitle(path: RelPath): string {
  const name = nameOf(path)
  return name === '_index' ? 'Sections' : humanise(name)
}

const humanise = (name: string): string =>
  name.replace(/[-_]+/g, ' ').replace(/^./, first => first.toUpperCase())

/** A section is a fileset in `sections/` — not any fileset anywhere (see `all`). */
const isSectionFile = (path: string): boolean =>
  path.startsWith(`${SECTIONS_DIR}/`) && path.endsWith('.fileset.md')



