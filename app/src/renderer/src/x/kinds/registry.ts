// Which handle a kind gets, in one line each.
//
// Markdown is the default rather than an entry: a document nobody has taught
// the renderer about is still a markdown file, and refusing to open it would
// make an unknown kind worse than a known one (R26, D54).

import { RemoteDocument } from '../remote-document.ts'
import { RemoteStream } from './stream.ts'
import { ONLY_SEGMENT, isStream, type Span } from '../../../../shared/document-api.ts'
import type { DocumentInfo } from '../../../../shared/ipc.ts'

export function forKind(info: DocumentInfo): RemoteDocument {
  switch (info.meta.kind) {
    case 'stream':
      return new RemoteStream(info)
    default:
      return new RemoteDocument(info)
  }
}

/**
 * Where a document opens when the target did not say where.
 *
 * A stream opens at today, which is what continuing looks like; anything else
 * opens at the whole of itself, because it has one segment and there is nowhere
 * else to be (D27).
 */
export async function home(doc: RemoteDocument): Promise<Span> {
  if (isStream(doc)) {
    const at = doc.positionAt((await window.tephra.doc.today()) as never, 0)
    return { begin: at, end: at }
  }
  const at = doc.positionAt(ONLY_SEGMENT, 0)
  return { begin: at, end: at }
}
