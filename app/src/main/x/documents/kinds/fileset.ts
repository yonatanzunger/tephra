// A fileset: a markdown document that is a list of links (D10, D53).
//
// **The verbs are edits, and that is the whole of this file.** `pin` is not
// "write a line into a file", it is "replace this span with that text" — which
// is what makes D53's claim true that a pin can be taken back by the ordinary
// undo, arrives in the journal, is committed by the version tier, and shows up
// immediately in a window that has the same fileset open. All four were claimed
// while pinning wrote files behind the document layer's back, and none of them
// were true (D54).
//
// Everything about *reading* a section file is `shared/fileset.ts`: the renderer
// meets a fileset in the editor like any other markdown, and one parse serves
// both sides.

import type { Notebook } from '../../../w/notebook.ts'
import { MarkdownDocument } from './markdown.ts'
import { entryLine, sameTarget, scanEntries, type ScannedEntry } from '../../../../shared/fileset.ts'
import type { Reference, SectionRow } from '../../../../shared/nav-api.ts'
import type { StoredDocument } from '../stored.ts'
import {
  ONLY_SEGMENT, type DocumentId, type DocumentText, type Edit, type EditOrigin,
} from '../../../../shared/document-api.ts'

export class FilesetDocument extends MarkdownDocument {
  constructor(notebook: Notebook, id: DocumentId) {
    super(notebook, id, 'fileset')
  }

  /** What is in this section, in the order the list has it. */
  async entries(): Promise<readonly SectionRow[]> {
    return (await this.#scan()).map(entry => entry.row)
  }

  /**
   * Put a reference in, and say whether it was already there.
   *
   * **Idempotent on purpose.** Someone who cannot see the section they are
   * pinning into will press the button twice, and two identical lines is a
   * worse answer than one. The comparison is between REFERENCES rather than
   * text: `tephra:tag/House%20Deal` and `<tephra:tag/House Deal>` are one pin
   * written by a program and by a person.
   */
  async pin(target: Reference, label: string, summary?: string): Promise<'pinned' | 'already'> {
    const body = await this.bodyOf(ONLY_SEGMENT)
    if ((await this.#scan()).some(entry => sameTarget(entry.row.target, target))) return 'already'

    // Appended at the end of what is written, not at the end of the FILE: a
    // section may end in blank lines, and pushing the entry past them would put
    // a gap in the middle of somebody's list.
    const written = body.replace(/\s*$/, '')
    const at = written.length
    const line = entryLine(label, target, summary)
    const payload = `${at === 0 ? '' : '\n'}${line}${body.slice(at).includes('\n') ? '' : '\n'}`

    await this.#edit([{ span: { begin: this.at(ONLY_SEGMENT, at), end: this.at(ONLY_SEGMENT, at) }, payload: payload as DocumentText }])
    return 'pinned'
  }

  /** Take a reference out. False when it was not in here to begin with. */
  async unpin(target: Reference): Promise<boolean> {
    const found = (await this.#scan()).find(entry => sameTarget(entry.row.target, target))
    if (found === undefined) return false
    await this.#edit([this.#cut(found)])
    return true
  }

  /** Take out whatever is at a position in the list. */
  async remove(index: number): Promise<boolean> {
    const found = (await this.#scan())[index]
    if (found === undefined) return false
    await this.#edit([this.#cut(found)])
    return true
  }

  /**
   * Move an entry to sit before the one currently at `to`.
   *
   * **Indices are read against the list as it is now**, not against the list
   * after the move — a caller holding a list it just read can say "this one
   * goes before that one" without simulating the edit first. `to` equal to the
   * length means the end.
   *
   * One batch, so it is one undo step: a move that came back as two would let
   * an undo leave the entry deleted and not reinserted, which is a lost pin.
   */
  async reorder(from: number, to: number): Promise<boolean> {
    const entries = await this.#scan()
    const moving = entries[from]
    if (moving === undefined || to < 0 || to > entries.length) return false
    if (to === from || to === from + 1) return false // already where it is going

    const anchor = to === entries.length ? (entries[entries.length - 1] as ScannedEntry).end : (entries[to] as ScannedEntry).from
    const text = `${(await this.bodyOf(ONLY_SEGMENT)).slice(moving.from, moving.to)}\n`

    await this.#edit([
      this.#cut(moving),
      {
        span: { begin: this.at(ONLY_SEGMENT, anchor), end: this.at(ONLY_SEGMENT, anchor) },
        payload: text as DocumentText,
      },
    ])
    return true
  }

  /** One entry's line, newline and all — what removing it means. */
  #cut(entry: ScannedEntry): Edit {
    return {
      span: { begin: this.at(ONLY_SEGMENT, entry.from), end: this.at(ONLY_SEGMENT, entry.end) },
      payload: '' as DocumentText,
    }
  }

  async #scan(): Promise<readonly ScannedEntry[]> {
    return scanEntries(await this.bodyOf(ONLY_SEGMENT))
  }

  /** Every verb here is this call. `operation` because none of them is typing. */
  async #edit(edits: readonly Edit[], origin: EditOrigin = 'operation'): Promise<void> {
    await this.replace(edits, origin)
  }
}

/**
 * The document at an id, as the fileset it claims to be.
 *
 * A borrow hands back a `StoredDocument`, because that is what every document
 * is; a caller wanting a KIND's verbs has to say which kind, and be told when it
 * was wrong rather than find out through a missing method. The check is real —
 * `.fileset.md` is what makes a fileset, and a caller reaching a note by mistake
 * is a bug in the caller, not a document to be coerced.
 */
export function asFileset(doc: StoredDocument): FilesetDocument {
  if (!(doc instanceof FilesetDocument)) {
    throw new Error(`${doc.id} is not a fileset`)
  }
  return doc
}
