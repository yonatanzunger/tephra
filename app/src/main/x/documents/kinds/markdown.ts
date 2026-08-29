// A markdown file: one document, one segment (D27, D54).
//
// **Almost nothing, which is the point.** Everything a document does — edits,
// undo, spans, tags, comments, the journal, windows — is `SegmentedDocument`,
// and a kind supplies only what makes it that kind. For a file that is what it
// says it is, that means two answers: *there is one segment*, and *it is this
// file*.
//
// The fileset is the same document with more verbs (MC4); it opens through here
// until it has them.

import type { Notebook } from '../../../w/notebook.ts'
import type { RelPath } from '../../../w/layout.ts'
import { SegmentedDocument } from '../segmented.ts'
import { Segment } from '../../segment.ts'
import { frontmatterFor, renderFrontmatter } from '../../frontmatter.ts'
import {
  ONLY_SEGMENT, type DocumentId, type DocumentKind, type DocumentMeta,
  type DocumentPosition, type SegmentKey, type Span,
} from '../../../../shared/document-api.ts'

export class MarkdownDocument extends SegmentedDocument {
  readonly id: DocumentId
  readonly meta: DocumentMeta

  readonly #rel: RelPath

  constructor(notebook: Notebook, id: DocumentId, kind: DocumentKind = 'markdown') {
    super(notebook)
    this.id = id
    this.meta = { kind }
    this.#rel = id as string as RelPath
  }

  /**
   * One segment, whatever is asked for.
   *
   * **A key that is not the one is a caller error, not an empty document.** A
   * position naming some other segment came from somewhere that thinks this is
   * a stream, and answering it with an empty segment would let that go on being
   * believed.
   */
  protected async load(key: SegmentKey): Promise<Segment> {
    if (key !== ONLY_SEGMENT) {
      throw new Error(`${this.id} has one segment, and it is not ${key as string}`)
    }
    const text = await this.notebook.read(this.#rel)
    return text === null
      ? Segment.forFile(key, this.#rel, renderFrontmatter(frontmatterFor(null, this.meta.kind)))
      : Segment.forFile(key, this.#rel, text)
  }

  async keys(): Promise<readonly SegmentKey[]> {
    return [ONLY_SEGMENT]
  }

  /** The one position a caller can start from without asking anything first. */
  start(): DocumentPosition {
    return this.at(ONLY_SEGMENT, 0)
  }

  // ── the two that make new documents, which this kind does not yet ──

  async branch(_span: Span, _name: string): Promise<DocumentId> {
    // Branching writes a note and leaves a link behind; both halves are about
    // where a KIND's files live, which is the Corpus's business once a second
    // kind wants it (D54). The stream is the only caller today.
    throw new Error('branching out of a note is not built yet')
  }

  async importText(): Promise<string> {
    throw new Error('importing into a note is not built yet')
  }
}
