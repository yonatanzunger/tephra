// Reading a section file (D53).
//
// **Shared, and for the reason `prose.ts` is shared.** Main reads section files
// off disk and the renderer will parse the one open in the editor — a fileset is
// an ordinary markdown document, so it can be edited like one, and the panel
// beside it must agree with the parser about what its entries are. Two
// implementations of one parse is the failure this codebase keeps meeting.
//
// Nothing here touches a file. What reads and walks them is `main/x/fileset.ts`,
// which is where the Notebook lives.

import type { DateKey } from './document-api.ts'
import type { Reference, SectionRow, SectionTree } from './nav-api.ts'

/** The nav's top level: a fileset of filesets. The underscore guards a collision. */
export const INDEX_SECTION = 'sections/_index.fileset.md'

/**
 * Where a pin goes when nobody says where.
 *
 * **Named for what it holds, not for what it is.** An earlier draft dropped
 * pins straight into the top-level list, which meant the one section a new
 * notebook had was called "Sections" — a container named after the category of
 * containers, which tells a reader nothing. The top level orders the groups;
 * this is a group.
 */
export const PINNED_SECTION = 'pinned'

/** How deep a section may nest before the panel stops following it (D53). */
export const MAX_DEPTH = 3

/**
 * One list item: `- [Label](target) — summary`.
 *
 * **Lenient, as the whole format is** (D31 carried): anything that is not a
 * link item is prose, and prose in a section file is allowed. A person may
 * write a paragraph explaining what the section is for, and it is not an error
 * that the parser has nothing to do with it.
 *
 * **Both legal spellings of a destination.** A target containing a space is not
 * a markdown link unless it is wrapped in angle brackets — `<tephra:tag/House
 * Deal>` — which is exactly what a person hand-editing a section will reach
 * for, since escaping to `%20` is what a program does. Accepting only the bare
 * form silently dropped their entry, and dropping an entry is the one thing
 * this file may not do (D53).
 */
const ITEM = /^\s*[-*]\s+\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^)\s]+))\s*\)\s*(?:[—–-]\s+(.*))?$/

/**
 * One entry, and the line it is written on.
 *
 * The offsets are what makes a fileset EDITABLE rather than rewritable: pinning
 * and unpinning are a replacement of one line's span, so they are ordinary
 * document edits — undoable, journalled, and visible to a window that has the
 * same file open (D53, D54). `to` excludes the newline; `end` includes it,
 * because removing a line means removing the line break with it.
 */
export interface ScannedEntry {
  readonly row: SectionRow
  readonly from: number
  readonly to: number
  readonly end: number
}

/** The entries of one section file, with where each one sits in the body. */
export function scanEntries(body: string): readonly ScannedEntry[] {
  const entries: ScannedEntry[] = []
  let at = 0
  for (const line of body.split('\n')) {
    const from = at
    at += line.length + 1 // the split ate the newline; the next line starts past it
    const item = ITEM.exec(line)
    if (item === null) continue
    const target = referenceOf((item[2] ?? item[3] ?? '') as string)
    if (target === null) continue
    entries.push({
      row: {
        label: (item[1] as string).trim(),
        summary: item[4]?.trim() ?? null,
        target,
        // The parser reads a LINE; whether that line points at a document is a
        // question about the corpus, which this file cannot see. `Filesets`
        // fills it in while it walks (D53).
        document: null,
        // Read from a line, so by construction: this parser only ever sees the
        // written ones.
        pinned: true,
        children: null,
        missing: false,
      },
      from,
      to: from + line.length,
      end: Math.min(from + line.length + 1, body.length),
    })
  }
  return entries
}

/** The entries of one section file, given its body and a title from elsewhere. */
export function parseEntries(body: string): readonly SectionRow[] {
  return scanEntries(body).map(entry => entry.row)
}

/** One entry, as it is written in the file. The inverse of `referenceOf`. */
export function entryLine(label: string, target: Reference, summary?: string): string {
  const tail = summary === undefined || summary.trim() === '' ? '' : ` — ${summary.trim()}`
  return `- [${label}](${targetOf(target)})${tail}`
}

/** The same reference, however it was spelled. Escaping is a program's habit. */
export const sameTarget = (a: Reference, b: Reference): boolean => targetOf(a) === targetOf(b)

/** How a reference is written down (D53). */
export function targetOf(target: Reference): string {
  switch (target.kind) {
    case 'anchor':
      return `tephra:mark/${encodeURIComponent(target.name)}`
    case 'tag':
      return `tephra:tag/${encodeURIComponent(target.subject)}`
    case 'date':
      return `tephra:day/${target.date}`
    case 'section':
      return `tephra:section/${encodeURIComponent(target.name)}`
    case 'todo':
      return `tephra:todo/${target.id}`
    case 'heading':
      return `tephra:heading/${encodeURIComponent(target.text)}`
    case 'file':
      return target.path
    case 'url':
      return target.href
  }
}

/**
 * What a link target means (D53).
 *
 * **The two that are paths stay paths.** Only what resolves by identity (D11)
 * takes the scheme, which is what keeps a section file useful in a tool that
 * has never heard of Tephra: most entries are ordinary links.
 *
 * **Decoding happens here**, because a markdown link escapes its spaces and a
 * subject called `House Deal` must come back with the space in it — the name is
 * the identity, and `House%20Deal` is not a subject anybody applied.
 */
export function referenceOf(target: string): Reference | null {
  if (/^https?:/i.test(target)) return { kind: 'url', href: target } // the browser's to decode

  const scheme = /^tephra:(?:\/\/)?([a-z]+)\/(.+)$/i.exec(target)
  if (scheme !== null) {
    const [, host, escaped] = scheme as unknown as [string, string, string]
    const rest = decoded(escaped)
    switch (host.toLowerCase()) {
      case 'mark':
        return { kind: 'anchor', name: rest }
      case 'tag':
        return { kind: 'tag', subject: rest }
      case 'day':
        return { kind: 'date', date: rest as DateKey }
      case 'section':
        return { kind: 'section', name: rest }
      case 'todo':
        return { kind: 'todo', id: rest }
      default:
        return null // an unknown host is not a guess worth making
    }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null // some other scheme entirely
  return { kind: 'file', path: decoded(target) }
}

/** A malformed escape is text, not an exception — the file is hand-edited. */
function decoded(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

