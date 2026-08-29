// The stream, as the renderer holds it.
//
// **What is left here is what is day-shaped**: today, the extent in dates, and
// the date at a position. They were on the base handle and had to be, because
// there was only ever one document; a fileset answering them would be answering
// null forever (D54).

import { RemoteDocument } from '../remote-document.ts'
import type { DocumentInfo } from '../../../../shared/ipc.ts'
import type {
  DateKey, DocumentMeta, DocumentPosition, DocumentWindow, SegmentKey, StreamDocumentApi,
} from '../../../../shared/document-api.ts'

export class RemoteStream extends RemoteDocument implements StreamDocumentApi {
  declare readonly meta: DocumentMeta & { readonly kind: 'stream' }
  #today: DateKey

  constructor(info: DocumentInfo) {
    super(info)
    this.#today = info.today
  }

  get today(): DateKey {
    return this.#today
  }

  /** Sugar for the highest-frequency action: open at the end of today. */
  async readToday(): Promise<DocumentWindow> {
    // Asked again rather than remembered: the app may have been left open
    // across midnight, and main is the one holding the clock.
    this.#today = await window.tephra.doc.today()
    const at = this.positionAt(this.#today as SegmentKey, 0)
    return this.read({ begin: at, end: at })
  }

  async extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null> {
    return window.tephra.doc.extent()
  }

  dateAt(at: DocumentPosition): DateKey {
    return at.segment as DateKey
  }
}
