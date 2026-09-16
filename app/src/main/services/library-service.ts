// **Domain. Depends on `CorpusService` and `DurabilityService`.**
//
// Documents as *files*: making one, renaming it, copying it, deleting it,
// bringing one in from outside, and answering what a path names.
//
// **The distinction that makes this a service of its own.** A document has two
// lives — a buffer somebody is typing in, which is `TextService`'s, and a file
// with a name in a directory, which is this. Every verb here is about the
// second: it takes or returns an **id**, and an id is a path (D3). None of them
// touches the text.
//
// **Two ways to ask what a path names, and they are not the same question.**
// `documentAt` answers about a link found in a document's text, which is
// untrusted data — `../../../..` in a line of prose can reach anywhere on the
// machine, so it is refused. `documentForFile` answers about a file a person
// chose in a dialog, which is an intention, so it may say yes to a path outside
// the notebook (MC6). Collapsing them would mean choosing which of those two
// rules to get wrong.
//
// **And it says where a link points without opening it.** Opening is Electron's
// and belongs to the shell tier; what a link *means* is a question about the
// notebook (D83, and `shell/desktop-service.ts` is the other half).

import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import { serve, type Served, type Serves } from './serves.ts'
import { CHANNEL } from '../../shared/ipc.ts'
import { isOutside, ONLY_SEGMENT, type DocumentId, type DocumentText } from '../../shared/document-api.ts'
import { STREAM_ID } from '../x/documents/corpus.ts'
import {
  kindOf, noteFile, NOTES_DIR, relativePath, resolveInsideNotebook, DOCKETS_DIR, DRAFTS_DIR,
  isDraft, SECTIONS_DIR, slug, type RelPath,
} from '../w/layout.ts'
import { outsideExists, readOutside } from '../w/outside.ts'
import { nameOf } from '../../shared/slug.ts'
import { basename, isAbsolute, join } from 'node:path'

export class LibraryService implements Serves {
  readonly #store: CorpusService
  readonly #durable: DurabilityService

  constructor(store: CorpusService, durable: DurabilityService) {
    this.#store = store
    this.#durable = durable
  }

  serves(): readonly Served[] {
    return [
      serve(CHANNEL.newDocument, (label?: string, section?: string, kind?: 'markdown' | 'todo' | 'docket') =>
        this.newDocument(label, section, kind),
      ),
      serve(CHANNEL.renameDocument, (id: DocumentId, label: string) => this.renameDocument(id, label)),
      serve(CHANNEL.duplicateDocument, (id: DocumentId, label: string) =>
        this.duplicateDocument(id, label),
      ),
      serve(CHANNEL.deleteDocument, (id: DocumentId) => this.deleteDocument(id)),
    ]
  }

  /**
   * Where a link found in the text points, or null if it will not be followed.
   *
   * Containment is `resolveInsideNotebook`'s job and is tested there; a link
   * that leads out of the notebook, or names a file that is not there, resolves
   * to nothing.
   *
   * **This returns a path rather than opening it**, because opening is
   * Electron's and a service is deliberately free of Electron — three test
   * suites drive it under plain node, and an `import { shell }` at the top of
   * this file broke all three at module load. That is the same fault as reading
   * `app.isPackaged` at module scope (see `verify-mode.ts`), and it is the
   * layering telling the truth: what a link means is a question about the
   * notebook, and opening a file is a question about the desktop.
   */

  /**
   * A new document, named for what it is not yet.
   *
   * `untitled`, `untitled-2`: a name is the one thing deferred, because it is
   * the one thing you do not know before writing the thing. Everything else
   * about it is real from the first keystroke — versioned, journalled,
   * recoverable — which an unsaved buffer would not be.
   */
  /**
   * A new document, of whichever kind was asked for (MT7).
   *
   * **The same gesture makes both**, which is the whole of what "just like we
   * create new md files" asks for: a `.todo.md` is an overall task list, a
   * `.md` is a note, and the only difference between making them is the suffix.
   * A DAILY list is not made this way and could not be — a directory document
   * has no single file to create, and the day its first carry materialises is
   * what brings it into being (D59).
   */
  async newDocument(
    label?: string,
    section?: string,
    kind?: 'markdown' | 'todo' | 'docket',
  ): Promise<DocumentId> {
    const wanted = label?.trim() ?? ''
    // **One rule, read both ways: every docket lives in `dockets/`** (MH1).
    //
    // *Directory → kind*: a file made from the dockets listing is a docket, so
    // the sidebar's *New File* needs no separate gesture and getting a markdown
    // file out of that listing would be a surprise nobody asked for.
    //
    // *Kind → directory*: a docket asked for by name — File ▸ New Docket — goes
    // to `dockets/` even though no section was named, because there is nowhere
    // else it could go. Without this half the FIRST docket was impossible from
    // the UI: with no `dockets/` on disk the sidebar shows no section, so there
    // was no listing to make one from.
    const made = kind ?? (directoryFor(section) === DOCKETS_DIR ? 'docket' : 'markdown')
    // **A document made without a name is a draft** (D90), which is a place and
    // not a state: it is durable, versioned and indexed like anything else, and
    // the only thing it lacks is a name somebody chose. Naming it moves it out —
    // see `renameDocument`, which is the same act.
    //
    // A docket is never a draft: it belongs to one directory by decision (MH1).
    // Nor is anything made INTO a section, which is a place already chosen.
    const into =
      made === 'docket' && section === undefined
        ? DOCKETS_DIR
        : wanted === '' && section === undefined && made === 'markdown'
          ? DRAFTS_DIR
          : directoryFor(section)
    const id = await this.#freeNoteName(
      wanted === '' ? 'untitled' : slug(wanted),
      into,
      made === 'todo' ? '.todo.md' : made === 'docket' ? '.docket.md' : '.md',
    )
    await this.#store.corpus.create(id, wanted === '' ? undefined : wanted)

    // **Made where you asked for it, which for a list means IN the list.** A
    // file made from a directory's listing is in that directory and shows up
    // because it is there; a file made from a curated section is in `notes/`
    // and shows up because a line was written for it. The gesture is the same
    // one and the answer to "where did it go" is the same: the section you were
    // looking at. Only a section with a file has a line to write (D53).
    if (section !== undefined && (await this.#store.corpus.exists(section as DocumentId))) {
      await this.#store.filesets.pin({ kind: 'file', path: relativePath(section as RelPath, id as string as RelPath) },
        wanted === '' ? nameOf(id) : wanted, section)
    }
    this.#durable.touched()
    // **A new document announces itself**, which it did not: `#touched` marks
    // the corpus dirty for the write tiers and tells no surface anything. Any
    // view holding a list of documents — the row menu's *put down in…*, a
    // sidebar — could not know a docket had just been made, so the first thing
    // somebody did with a new docket was find it missing from the one place
    // they would look for it.
    this.#store.changed(id)
    return id
  }

  /**
   * Rename a document, and fix what pointed at it.
   *
   * **The references are the point.** A fileset links by relative path, so a
   * rename without this leaves every section that names the document pointing
   * at nothing — and D7 says such an entry dangles visibly, which is right for
   * a file somebody deleted and wrong for one they merely renamed.
   *
   * Returns the new id. The caller moves whatever was looking at the old one: a
   * document's identity is its path, so the old id is genuinely gone.
   */
  async renameDocument(id: DocumentId, label: string): Promise<DocumentId> {
    const wanted = label.trim()
    if (wanted === '') throw new Error('a document needs a name')
    if (isOutside(id)) throw new Error('a file outside the notebook is not ours to rename')

    const to = await this.#freeName(id, wanted)
    if (to === id) return id
    await this.#store.corpus.rename(id, to)
    // **A titled document is renamed too, not only moved.** The filename is the
    // identity and the frontmatter title is what it is CALLED; leaving the old
    // title behind would make Rename appear to do nothing, since the panel
    // shows the title when there is one.
    await this.#store.corpus.use(to, async doc => {
      // **A draft leaving gets a title whether or not it had one** (D90): the
      // name it is being given is what it is called, and the frontmatter is
      // where *what it is called* lives (D59). For an ordinary rename the old
      // rule holds — a document with no title never had one, and inventing one
      // would put a heading on somebody's file because they renamed it.
      if (isDraft(id as string as RelPath) || (await doc.titleOf(ONLY_SEGMENT)) !== null) {
        await doc.setTitleOf(ONLY_SEGMENT, wanted)
      }
    })
    await this.#store.filesets.retarget(id as string as RelPath, to as string as RelPath)
    this.#durable.touched()
    return to
  }

  /** The same content under a new name; the original is left alone. */
  async duplicateDocument(id: DocumentId, label: string): Promise<DocumentId> {
    const wanted = label.trim()
    if (wanted === '') throw new Error('a copy needs a name')
    const to = await this.#freeName(id, wanted)
    await this.#store.corpus.duplicate(id, to)
    this.#durable.touched()
    return to
  }

  /**
   * Delete a document. Entries that named it are left to dangle, VISIBLY (D7).
   *
   * Deliberately not the same as rename: an entry pointing at a document
   * somebody deleted is a true statement about the notebook, and quietly
   * removing it would edit a list they curated on the strength of a guess about
   * what they meant.
   */
  async deleteDocument(id: DocumentId): Promise<void> {
    if (id === STREAM_ID) throw new Error('the notebook itself cannot be deleted')
    if (isOutside(id)) throw new Error('a file outside the notebook is not ours to delete')
    await this.#store.corpus.remove(id)
    this.#durable.touched()
  }

  /**
   * A name nobody is using, in the directory the document already lives in —
   * **except a draft, which is leaving** (D90).
   *
   * Naming a draft is what makes it an ordinary document, so the name decides
   * both what it is called and where it goes. *Save…* on a draft and *Rename…*
   * on anything else are the same verb, which is why there is no second one.
   */
  async #freeName(id: DocumentId, label: string): Promise<DocumentId> {
    const rel = id as string as RelPath
    const cut = rel.lastIndexOf('/')
    const dir = isDraft(rel) ? NOTES_DIR : cut < 0 ? '' : rel.slice(0, cut)
    // **A rename must not change what the document IS.**
    //
    // This read `.fileset.md` or else `.md`, so renaming an overall task list
    // turned it into a plain markdown file — silently, since the content is
    // markdown either way and nothing errors. A docket renamed the same way
    // stopped being a docket, which is how it was found (reported from use,
    // MH1): *"selecting rename on a docket does nothing"*, because what it
    // actually did was take the kind off.
    //
    // Type is declared by the name (D3), so the name is the one thing a rename
    // may not invent. Asked as a list rather than a chain of tests, because the
    // next kind to arrive is the one that would have been forgotten.
    const suffix = KIND_SUFFIXES.find(end => rel.endsWith(end)) ?? '.md'

    for (let n = 1; ; n++) {
      const name = n === 1 ? slug(label) : `${slug(label)}-${n}`
      const candidate = (dir === '' ? `${name}${suffix}` : `${dir}/${name}${suffix}`) as string as DocumentId
      if (candidate === id || !(await this.#store.corpus.exists(candidate))) return candidate
    }
  }



  /**
   * What DOCUMENT a link names, if it names one.
   *
   * The other half of `linkTarget`, and the half that had no answer until there
   * were documents other than the stream: a `.md` file inside the notebook is
   * not a file for the OS to open in some other editor, it is a document this
   * app opens (D54). Anything the corpus does not recognise as a document — an
   * attachment, a PDF — is not one, and falls through to the desktop.
   */
  async documentAt(target: string, from?: RelPath): Promise<DocumentId | null> {
    const rel = resolveInsideNotebook(this.#store.notebook.root, target, from)
    if (rel === null || kindOf(rel) === null) return null
    const id = rel as string as DocumentId
    return (await this.#store.corpus.exists(id)) ? id : null
  }

  /**
   * What document a FILE PICKER's answer names — inside the notebook or not.
   *
   * **Deliberately not `documentAt`.** That one answers about a link found in a
   * document's text, which is untrusted data: `../../../..` in a line of prose
   * can reach anywhere on the machine, and it is refused for exactly that
   * reason. A person choosing a file in a dialog is an intention, not data, so
   * this one may say yes to a path outside the notebook — and what comes back
   * is an outside document, which is read-only and says so (MC6).
   */
  async documentForFile(path: string): Promise<DocumentId | null> {
    const inside = await this.documentAt(path)
    if (inside !== null) return inside
    if (!isAbsolute(path) || kindOf(path as RelPath) === null) return null
    return (await outsideExists(path)) ? (path as string as DocumentId) : null
  }

  /**
   * Bring an outside file in: a COPY, and the original left alone.
   *
   * D47's rule, applied one level up. The import gesture keeps the file it came
   * from untouched and puts a copy where this app can keep its promises — from
   * the moment it lands it is versioned, indexed, watched and undoable, none of
   * which is true of a file Tephra merely opened.
   *
   * The provenance goes in the frontmatter rather than in the text: it is a
   * fact about the document, not a sentence somebody wrote, and `source:` is
   * preserved verbatim on every rewrite like any other unknown key.
   */
  async importFile(id: DocumentId): Promise<DocumentId> {
    if (!isOutside(id)) return id // already ours; importing it would be a second copy

    const from = id as string
    const text = await readOutside(from)
    if (text === null) throw new Error(`${from} could not be read`)

    const rel = await this.#freeNoteName(basename(from).replace(/\.md$/i, ''))
    await this.#store.corpus.use(rel, async doc => {
      await doc.setBodyOf(ONLY_SEGMENT, text as DocumentText)
      await doc.setTitleOf(ONLY_SEGMENT, basename(from).replace(/\.md$/i, ''))
      await doc.setSourceOf(ONLY_SEGMENT, from)
    })
    this.#durable.touched()
    return rel
  }

  /** A name nobody is using. Importing twice makes two notes, not one overwrite. */
  async #freeNoteName(name: string, directory = NOTES_DIR, suffix = '.md'): Promise<DocumentId> {
    for (let n = 1; ; n++) {
      const wanted = n === 1 ? name : `${name} ${n}`
      const rel = (
        directory === NOTES_DIR && suffix === '.md'
          ? noteFile(wanted)
          : `${directory}/${slug(wanted)}${suffix}`
      ) as DocumentId
      if (!(await this.#store.corpus.exists(rel))) return rel
    }
  }

  async linkTarget(target: string, from?: RelPath): Promise<string | null> {
    const rel = resolveInsideNotebook(this.#store.notebook.root, target, from)
    if (rel === null) return null
    if (!(await this.#store.notebook.has(rel))) return null
    return join(this.#store.notebook.root, rel)
  }
}

/**
 * Which directory a section's new files go in.
 *
 * A directory's listing is the directory, so a file made there belongs in it. A
 * curated section is a LIST rather than a place — `sections/` holds the lists
 * themselves, and a note dropped in beside them would read as another section —
 * so its files go where notes go, and the section names one.
 */
function directoryFor(section?: string): string {
  if (section === undefined) return NOTES_DIR
  const cut = section.lastIndexOf('/')
  const dir = cut < 0 ? '' : section.slice(0, cut)
  return dir === '' || dir === SECTIONS_DIR ? NOTES_DIR : dir
}



/**
 * Every suffix that declares a kind, longest first.
 *
 * **Longest first matters**: `.todo.md` ends with `.md`, so a shorter match
 * would win and take the kind off. One list, and `nameOf` in `shared/slug.ts`
 * is the other half of the same fact — what comes off a name, and what must
 * stay on it.
 */
const KIND_SUFFIXES: readonly string[] = ['.fileset.md', '.docket.md', '.todo.md', '.md']
