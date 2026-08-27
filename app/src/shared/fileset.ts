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

/** How deep a section may nest before the panel stops following it (D53). */
export const MAX_DEPTH = 3

/**
 * One list item: `- [Label](target) — summary`.
 *
 * **Lenient, as the whole format is** (D31 carried): anything that is not a
 * link item is prose, and prose in a section file is allowed. A person may
 * write a paragraph explaining what the section is for, and it is not an error
 * that the parser has nothing to do with it.
 */
const ITEM = /^\s*[-*]\s+\[([^\]]*)\]\(([^)\s]+)\)\s*(?:[—–-]\s+(.*))?$/

/** The entries of one section file, given its body and a title from elsewhere. */
export function parseEntries(body: string): readonly SectionRow[] {
  const entries: SectionRow[] = []
  for (const line of body.split('\n')) {
    const item = ITEM.exec(line)
    if (item === null) continue
    const target = referenceOf(item[2] as string)
    if (target === null) continue
    entries.push({
      label: (item[1] as string).trim(),
      summary: item[3]?.trim() ?? null,
      target,
      children: null,
      missing: false,
    })
  }
  return entries
}

/** One entry, as it is written in the file. The inverse of `referenceOf`. */
export function entryLine(label: string, target: Reference, summary?: string): string {
  const tail = summary === undefined || summary.trim() === '' ? '' : ` — ${summary.trim()}`
  return `- [${label}](${targetOf(target)})${tail}`
}

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

