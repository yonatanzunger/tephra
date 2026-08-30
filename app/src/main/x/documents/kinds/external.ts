// A document from outside the notebook: read, never written (MC6).
//
// **Everything a markdown document is, minus the one thing being inside gives
// you.** It has a window, spans, a generation and an undo stack, because those
// are the document layer's and cost nothing here; what it does not have is a
// way back to disk. Nor does it have history, versions, an index entry or
// external-change detection — all of which are the notebook's, not a file's.
//
// That asymmetry is why the surface says so in the window rather than letting a
// person find out at the first keystroke, and why the import gesture sits on
// that same indicator: the way to get the rest is to bring the file in.
//
// **This is one class for every kind, and that is a claim, not a shortcut.**
// The kind still comes from the filename, exactly as it does inside — a
// downloaded `.todo.md` reports `todo` and gets the todo surface (D54). What it
// does not get is any kind's VERBS, and it cannot want them: `pin`, `branch`,
// `importText`, every one of them writes, and this document refuses to write.
// The axes really are separate — WHAT it is chooses the surface, WHERE it is
// decides whether it can be changed.
//
// The day that stops being true is the day a kind has a READ verb its surface
// needs — a todo listing its tasks, say. Then the fix is not a second class per
// kind but moving the loader out of the kind: `load()` is already the only
// abstract member, so it is one parameter away from being where the bytes come
// from rather than which subclass you are.

import type { Notebook } from '../../../w/notebook.ts'
import type { RelPath } from '../../../w/layout.ts'
import { readOutside } from '../../../w/outside.ts'
import { SegmentedDocument } from '../segmented.ts'
import { Segment } from '../../segment.ts'
import {
  ONLY_SEGMENT, type DocumentId, type DocumentKind, type DocumentMeta,
  type DocumentPosition, type SegmentKey, type Span,
} from '../../../../shared/document-api.ts'

export class ExternalDocument extends SegmentedDocument {
  readonly id: DocumentId
  readonly meta: DocumentMeta

  readonly #path: string

  constructor(notebook: Notebook, id: DocumentId, kind: DocumentKind) {
    // The notebook is still handed over — the base class holds one — and is
    // never asked for this document's file. Nothing here writes.
    super(notebook)
    this.id = id
    this.meta = { kind, readOnly: true }
    this.#path = id as string
  }

  protected async load(key: SegmentKey): Promise<Segment> {
    if (key !== ONLY_SEGMENT) {
      throw new Error(`${this.id} has one segment, and it is not ${key as string}`)
    }
    const text = await readOutside(this.#path)
    if (text === null) throw new Error(`${this.#path} could not be read`)
    return Segment.outside(key, this.#path as RelPath, text)
  }

  async keys(): Promise<readonly SegmentKey[]> {
    return [ONLY_SEGMENT]
  }

  start(): DocumentPosition {
    return this.at(ONLY_SEGMENT, 0)
  }

  async branch(_span: Span, _name: string): Promise<DocumentId> {
    throw new Error('a file outside the notebook cannot be branched; import it first')
  }

  async importText(): Promise<string> {
    throw new Error('a file outside the notebook cannot be written to; import it first')
  }
}
