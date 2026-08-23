// Where things live in a notebook directory. Pure path arithmetic — no fs, no
// Electron — so the layout can be reasoned about and tested on its own.
//
// The layout is from format-spec.md. Year/month nesting keeps any directory
// under ~31 entries; twenty years is roughly 5 000 day files.

import type { DateKey } from '../../shared/document-api.ts'
import { asDateKey } from '../../shared/dates.ts'

export const STREAM_DIR = 'stream'

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
export function dayFile(date: DateKey, part = 1): RelPath {
  const [year, month] = date.split('-') as [string, string, string]
  const suffix = part > 1 ? `.${part}` : ''
  return `${STREAM_DIR}/${year}/${month}/${date}${suffix}.md`
}

/** The directory holding a date's files. */
export function dayDir(date: DateKey): RelPath {
  const [year, month] = date.split('-') as [string, string, string]
  return `${STREAM_DIR}/${year}/${month}`
}

export interface DayFileRef {
  readonly date: DateKey
  readonly part: number
}

/**
 * Read a relative path back as a day file, or null if it is not one.
 *
 * Deliberately strict about position: a file named like a date but sitting in
 * `notes/` is a branched document that happens to be called that, not a day of
 * the stream. Type is declared by name *and* place, never inferred loosely (D3).
 */
export function parseDayFile(rel: RelPath): DayFileRef | null {
  const m = /^stream\/(\d{4})\/(\d{2})\/(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.md$/.exec(rel)
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
  return { date, part }
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
 * Filesystem-safe, readable, and stable. Not reversible, and not meant to be:
 * the file's own frontmatter is authoritative for its title (format-spec), so
 * the name only has to be a usable handle.
 */
export function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s === '' ? 'untitled' : s
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
export function walFile(docId: string): RelPath {
  return `${LOCAL_DIR}/wal/${slug(docId)}.jsonl`
}
