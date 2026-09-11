// Where things live in a notebook directory. Pure path arithmetic — no fs, no
// Electron — so the layout can be reasoned about and tested on its own.
//
// The layout is from format-spec.md. Year/month nesting keeps any directory
// under ~31 entries; twenty years is roughly 5 000 day files.

import type { DateKey, DocumentKind } from '../../shared/document-api.ts'
import { asDateKey } from '../../shared/dates.ts'
import { slug } from '../../shared/slug.ts'
export { slug }

import { dirname, join, posix, relative, resolve, sep } from 'node:path'

/**
 * The kinds that are a DIRECTORY of dated files rather than one file (D59).
 *
 * A stream and a todo list are both `SegmentedDocument`s: many files, one
 * document, days for segments. A markdown note and a fileset are one file each.
 * That split is the whole of why a directory can carry a kind at all, and this
 * is the list of the ones that do.
 */
export const DIRECTORY_KINDS = ['stream', 'todo'] as const

/**
 * The kind a DIRECTORY name declares, or null if it declares none.
 *
 * `notebook.stream` → `stream`; `main.todo` → `todo`; `notes` → null. The same
 * rule a filename follows, which is the point of D59: a name says what a thing
 * is, whether the thing is a file or a directory, and nothing is inferred from
 * context (D3).
 */
export function directoryKind(name: string): DocumentKind | null {
  const cut = name.lastIndexOf('.')
  if (cut <= 0) return null
  const found = name.slice(cut + 1)
  return (DIRECTORY_KINDS as readonly string[]).includes(found) ? (found as DocumentKind) : null
}

/**
 * The multi-file document a path belongs to, or null if it stands alone.
 *
 * **This is what replaced the hardcoded `stream/` prefix test.** Every file
 * under `notebook.stream/` is the stream's rather than a document of its own,
 * and every file under `main.todo/` will be that list's — one rule, applied by
 * walking up until a name declares a kind.
 *
 * A path that IS a root answers with itself, which is what makes a directory
 * document's id resolvable by the same call that resolves its files.
 */
export function documentRoot(rel: RelPath): RelPath | null {
  const parts = rel.split('/')
  for (let n = parts.length; n > 0; n--) {
    if (directoryKind(parts[n - 1] as string) !== null) return parts.slice(0, n).join('/')
  }
  return null
}

/** Is this path a multi-file document's root, rather than something inside one? */
export const isDirectoryDocument = (rel: RelPath): boolean => documentRoot(rel) === rel

/**
 * The stream's directory, and therefore the stream's id (D59).
 *
 * **`notebook.stream`, because the stream IS the notebook** — one stream per
 * notebook, the way one `.todo` at the root is *the* todo list. It was plain
 * `stream` until 2026-09-01; see `solution/link-roadmap.md`'s sibling
 * `todo-roadmap.md`, MT1, and the migration in `scripts/migrate-layout.mjs`.
 */
export const STREAM_DIR = 'notebook.stream'

/**
 * Authored configuration, inside the notebook rather than in `.tephra/` (D41).
 * `.tephra/` is machine-local and disposable; a theme somebody crafted is work,
 * and losing it on a new machine would be a real loss.
 *
 * This is not a fourth content type and does not breach D3: a directory named
 * `config` infers nothing from context, which is the test D3 actually protects.
 */
export const CONFIG_DIR = 'config'
export const THEMES_DIR = `${CONFIG_DIR}/themes`
/**
 * The notebook's own settings, which travel with it (D63).
 *
 * **Beside the themes and not in `.tephra/`**, for the reason themes are: this
 * is a choice somebody made about the notebook, not state this machine happens
 * to hold. The zone in particular decides which date a passage is filed under,
 * and two devices with different answers would file one evening under two
 * dates.
 */
export const SETTINGS_FILE = `${CONFIG_DIR}/notebook.json`
export const NOTES_DIR = 'notes'
export const SECTIONS_DIR = 'sections'
export const ATTACHMENTS_DIR = 'attachments'

/** Machine-local, never synced, disposable (D7). Excluded from git by .gitignore. */
export const LOCAL_DIR = '.tephra'

export const LOCAL = {
  version: `${LOCAL_DIR}/version`,
  lock: `${LOCAL_DIR}/lock`,
  /**
   * The log's HOME, a directory — which is why it appears in `REQUIRED_DIRS`.
   * Keeping it a directory leaves room to segment or rotate the log later
   * without moving anything, and costs one path constant now.
   */
  wal: `${LOCAL_DIR}/wal`,

  index: `${LOCAL_DIR}/index`,
  issues: `${LOCAL_DIR}/issues.json`,
  attachmentsManifest: `${LOCAL_DIR}/attachments.manifest`,
  uiState: `${LOCAL_DIR}/ui-state.json`,
  /** The last thing sent to paper, kept so the viewer has a file to show. */
  print: `${LOCAL_DIR}/print.pdf`,
  /**
   * The HTML it was rendered from. A real file rather than a data: URL, whose
   * opaque origin cannot resolve the relative image links in a passage.
   */
  printSource: `${LOCAL_DIR}/print.html`,
} as const

/** The on-disk state version for a directory, so a future format can migrate. */
export const STATE_VERSION = 1

/** Relative paths always use forward slashes, on every platform. */
export type RelPath = string

/**
 * The day file for a date, or a later part of it.
 *
 * Parts share a date and are ordered by `part` (format-spec). Part 1 has no
 * suffix, so the common case reads as an ordinary dated file — which matters
 * because a human browsing the directory is a supported way to use this.
 */
export function dayFile(date: DateKey, part = 1, root: RelPath = STREAM_DIR): RelPath {
  const [year, month] = date.split('-') as [string, string, string]
  const suffix = part > 1 ? `.${part}` : ''
  return `${root}/${year}/${month}/${date}${suffix}.md`
}

/** The directory holding a date's files, in whichever document is asking. */
export function dayDir(date: DateKey, root: RelPath = STREAM_DIR): RelPath {
  const [year, month] = date.split('-') as [string, string, string]
  return `${root}/${year}/${month}`
}

export interface DayFileRef {
  readonly date: DateKey
  readonly part: number
  /**
   * Which directory document it belongs to.
   *
   * **A caller that means "a day of the STREAM" must check this**, because the
   * grammar is shared: a todo list's days are laid out identically, under a
   * different root. Before D59 there was only one root and the question could
   * not be asked, which is exactly the kind of thing that becomes a silent bug
   * the day a second one exists.
   */
  readonly root: RelPath
}

/**
 * Read a relative path back as a day file, or null if it is not one.
 *
 * Deliberately strict about position: a file named like a date but sitting in
 * `notes/` is a branched document that happens to be called that, not a day of
 * the stream. Type is declared by name *and* place, never inferred loosely (D3).
 */
export function parseDayFile(rel: RelPath): DayFileRef | null {
  const root = documentRoot(rel)
  if (root === null || root === rel) return null
  const within = rel.slice(root.length + 1)
  const m = /^(\d{4})\/(\d{2})\/(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.md$/.exec(within)
  if (!m) return null
  const [, year, month, dateText, partText] = m as unknown as [string, string, string, string, string | undefined]
  const date = asDateKey(dateText)
  if (date === null) return null
  // The nesting must agree with the name, or the file is misfiled rather than
  // merely oddly named — and guessing which one is right would be a data loss.
  if (!date.startsWith(`${year}-${month}-`)) return null
  const part = partText === undefined ? 1 : Number(partText)
  if (!Number.isInteger(part) || part < 1) return null
  if (part === 1 && partText !== undefined) return null // ".1.md" is not how part 1 is spelled
  return { date, part, root }
}

/** A branched document or pinned list. */
export function noteFile(name: string): RelPath {
  return `${NOTES_DIR}/${slug(name)}.md`
}

/** A nav section (D10). Type is declared by the suffix. */
export function sectionFile(name: string): RelPath {
  return `${SECTIONS_DIR}/${slug(name)}.fileset.md`
}

/**
 * An attachment, dated and content-hashed. The hash prevents collisions and
 * makes duplicate detection possible later; the date keeps directories small.
 */
export function attachmentFile(date: DateKey, name: string, hash: string, ext: string): RelPath {
  const [year, month] = date.split('-') as [string, string, string]
  const clean = ext.replace(/^\./, '')
  return `${ATTACHMENTS_DIR}/${year}/${month}/${date}-${slug(name)}-${hash.slice(0, 6)}.${clean}`
}

/** Directories that must exist before anything can be written. */
export const REQUIRED_DIRS: readonly RelPath[] = [
  STREAM_DIR,
  NOTES_DIR,
  SECTIONS_DIR,
  ATTACHMENTS_DIR,
  LOCAL_DIR,
  LOCAL.wal,
]

/** True for paths under `.tephra/`, which is machine-local and never synced. */
export function isLocal(rel: RelPath): boolean {
  return rel === LOCAL_DIR || rel.startsWith(`${LOCAL_DIR}/`)
}

/** Git's own directory. Machinery, not notebook content, and never ours to touch. */
export const GIT_DIR = '.git'

/**
 * Paths the app must never treat as notebook content: its own machine-local
 * state, and git's internals.
 *
 * **`.git/` is the one that bites.** It lives inside the notebook directory, so
 * the watcher sees it; and every commit rewrites `.git/index` and
 * `.git/refs/heads/main`, which the watcher then reports as an external change,
 * which schedules another commit, which rewrites them again. Measured: a
 * notebook that had been touched once was committing `.git/objects/...` into
 * itself and could never reach a clean tree.
 */
export function isMachinery(rel: RelPath): boolean {
  return isLocal(rel) || rel === GIT_DIR || rel.startsWith(`${GIT_DIR}/`)
}


/**
 * What kind of document a path holds (D3, D54).
 *
 * **The name declares the type**, mirrored in frontmatter but not decided by
 * it: a name is what you have before you have opened anything, which is what
 * enumeration needs. That is true of directories too (D59) — anything under
 * `notebook.stream/` belongs to the one stream document rather than being a
 * document of its own, and the directory's own name is what says so.
 *
 * Null means **not a document at all** — an attachment, a theme, machinery —
 * which is a different answer from "a document of some kind I do not know", and
 * the reason this returns a nullable rather than a fallback kind.
 */
export function kindOf(rel: RelPath): DocumentKind | null {
  const root = documentRoot(rel)
  if (root !== null) return directoryKind(root.slice(root.lastIndexOf('/') + 1))
  if (rel.endsWith('.fileset.md')) return 'fileset'
  // **A docket is one file, so its kind is in its suffix** (MH1, D68) — the
  // same arrangement `.todo.md` and `.fileset.md` use. It has no day
  // segmentation to need a directory for: a docket is complete rather than
  // paged, which is the property that distinguishes it (H2).
  if (rel.endsWith('.docket.md')) return 'docket'
  // **Two shapes of one kind** (D55 as amended, MT7). A `.todo` DIRECTORY is a
  // daily list — carried, walked, with a working set that turns over. A single
  // `.todo.md` is an OVERALL list: the blog posts you mean to write, which does
  // not turn over daily, so the carry has nothing to carry and *today's working
  // set* is a meaningful idea for one and meaningless for the other.
  //
  // `.todo` names the kind and `.md` says this particular thing is a markdown
  // file — which is already how `tasks.todo/2026/09/2026-09-08.md` reads, so
  // this is one convention applied twice rather than two.
  if (rel.endsWith('.todo.md')) return 'todo'
  if (rel.endsWith('.md')) return 'markdown'
  return null // not a document at all: an attachment, a theme, machinery
}

/** Where a theme lives. The filename is the theme's identity (D41). */
export function themeFile(name: string): RelPath {
  return `${THEMES_DIR}/${slug(name)}.json`
}

/**
 * One write-ahead log per document — `.tephra/wal/<doc-id>.jsonl`, exactly as
 * `format-spec.md` lays it out. v1 has a single document, the stream, but the
 * shape is the spec's and costs nothing to honour now.
 */
/**
 * Where a directory's index lives, mirroring the corpus's own tree (D52).
 *
 * `stream/2026/08` becomes `.tephra/index/stream/2026/08.json`, which is per
 * month because that is how the corpus is laid out (D9) — the granularity falls
 * out of the tree rather than being a rule of its own. The root's own files, if
 * a corpus ever has any, go in `_root.json`, since `.json` alone is not a name.
 */
export function indexFile(dir: RelPath): RelPath {
  return `${LOCAL_DIR}/index/${dir === '' ? '_root' : dir}.json`
}

export function walFile(docId: string): RelPath {
  return `${LOCAL_DIR}/wal/${slug(docId)}.jsonl`
}

/**
 * A link from one notebook file to another, as markdown wants it.
 *
 * Relative, not absolute: the notebook is a directory a person may move, sync,
 * or open in another editor, and every other link in the format is already
 * relative (an attachment reads `../../../attachments/…`). The link left behind
 * by a branch is v1's ONLY path back to the branched material (D13), so it has
 * to keep working outside Tephra as well as inside it.
 */
export function relativePath(from: RelPath, to: RelPath): string {
  const fromParts = from.split('/').slice(0, -1)
  const toParts = to.split('/')
  let shared = 0
  while (shared < fromParts.length && shared < toParts.length - 1 && fromParts[shared] === toParts[shared]) {
    shared++
  }
  const up = fromParts.length - shared
  return [...Array<string>(up).fill('..'), ...toParts.slice(shared)].join('/')
}


/**
 * A link resolved against the document it was written in — paths only, no disk.
 *
 * The same rule as `resolveInsideNotebook` and none of the filesystem: this is
 * for deciding what an entry POINTS AT, which the panel asks about every entry
 * it draws and must answer without a stat per link.
 */
export function relativeTo(from: RelPath, target: string): RelPath | null {
  if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  const at = posix.resolve(posix.join('/', posix.dirname(from)), target)
  return at === '/' ? null : (at.slice(1) as RelPath)
}

/**
 * Resolve a link found in a document's text to a path inside the notebook, or
 * null if it leads out.
 *
 * **A document's text is data, not configuration.** It can be typed, pasted, or
 * arrive with an imported file (R28), so `../../../..` repeated enough times
 * reaches anywhere on the machine — and anything that opens what a link says
 * without this check has handed that reach to a line of prose.
 *
 * **Relative to the document the link was written in**, which is what a relative
 * link means everywhere else and what a person hand-editing a file will assume.
 * `from` is that document; without one the base is a day file's directory,
 * since every day sits at the same depth (`stream/YYYY/MM/`) and that is where
 * links came from when the stream was the only document there was.
 *
 * Getting this wrong is invisible rather than loud: `../notes/offer.md` in a
 * section file resolved from the stream's depth lands outside the notebook,
 * fails containment, and the entry reports itself as missing — a correct link,
 * a real file, and a row that says "not found" (D53, D54).
 */
export function resolveInsideNotebook(root: string, target: string, from?: RelPath): RelPath | null {
  if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null // a URI scheme is not a file
  const base = resolve(root)
  const within = from === undefined ? join(STREAM_DIR, '0000', '00') : dirname(from)
  const at = resolve(join(base, within), target)
  if (at === base || !at.startsWith(base + sep)) return null
  return relative(base, at).split(sep).join('/') as RelPath
}
