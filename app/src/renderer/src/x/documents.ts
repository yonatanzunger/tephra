// The renderer's handles on documents — one per document, and who owns a push.
//
// **The renderer's half of the Corpus** (D54), and much smaller: no eviction,
// no borrowing, no dirtiness, because none of that is Z's. What it does is the
// two things that break the moment a second document exists —
//
//   1. ONE HANDLE PER DOCUMENT. Two handles on one document would each keep
//      their own generation, and a position built from the stale one is born
//      invalid (D33). The panel and the editor must be looking at the same
//      object, not at two objects with the same id.
//   2. ONE SUBSCRIPTION. Main pushes window changes to the process, not to a
//      document; a per-document listener would see every other document's
//      messages and adopt a generation that is not its own.

import { RemoteDocument } from './remote-document.ts'
import { forKind } from './kinds/registry.ts'
import type { RemoteStream } from './kinds/stream.ts'
import type { DocumentId } from '../../../shared/document-api.ts'

export class Documents {
  readonly #open = new Map<DocumentId, Promise<RemoteDocument>>()

  constructor() {
    // Dispatched by asking, not by a table: the documents open at once are
    // few, and a table of window → document is one more thing to keep true.
    window.tephra.doc.onWindowChanged(message => {
      for (const opening of this.#open.values()) {
        void opening.then(doc => {
          if (doc.holds(message.id)) doc.deliver(message)
        })
      }
    })
    window.tephra.doc.onWindowReset(message => {
      for (const opening of this.#open.values()) {
        void opening.then(doc => {
          if (doc.holds(message.id)) doc.reset(message.id)
        })
      }
    })
  }

  /**
   * The handle on a document, opening it if this is the first ask.
   *
   * **The OPENING is remembered, not the opened** — the same lesson as the
   * Corpus's (D54): two callers asking at once must get one document, and an
   * `await` between the check and the store is exactly where the second one
   * slips in.
   */
  open(id?: DocumentId): Promise<RemoteDocument> {
    const opening = id === undefined ? undefined : this.#open.get(id)
    if (opening !== undefined) return opening

    const made = (async () => {
      const info = await window.tephra.doc.open(id)
      const doc = forKind(info)
      // Under its real id, which is what main called it — `open()` with no id
      // means "the one the app opens with", and only main knows which that is.
      this.#open.set(doc.id, Promise.resolve(doc))
      return doc
    })()
    if (id !== undefined) this.#open.set(id, made)
    return made
  }

  /** The document the app opens with, as the stream it is. */
  async stream(): Promise<RemoteStream> {
    return (await this.open()) as RemoteStream
  }
}
