// Files the corpus holds that are not documents (R7).
//
// **An attachment is not a document, and that is why this exists.** Nothing
// opens a PNG as a document, nothing edits it, nothing merges it — so the rule
// that every document write goes through its document has nothing to say about
// it. But the rule underneath that one still applies: writing files is the
// floor's job, and a service above the floor asking the Notebook to write bytes
// is the reach the layering test exists to stop (MC7).
//
// So this is the floor's answer for the one kind of corpus content that has no
// document: written here, named here, and deduplicated here.

import { attachmentFile } from '../../w/layout.ts'
import { hashContent } from '../../w/atomic.ts'
import type { Notebook } from '../../w/notebook.ts'
import type { RelPath } from '../../w/layout.ts'
import type { DateKey } from '../../../shared/document-api.ts'

/**
 * Put bytes in `attachments/`, and say where they landed.
 *
 * **The hash is the deduplication and also the collision guard.** The same
 * screenshot pasted twice writes the same path with the same bytes, which is a
 * no-op rather than a second copy; and two different pictures cannot land on one
 * name unless they are the same picture.
 *
 * **Filed under the day it ARRIVED**, whatever it was pasted into. A picture in
 * a note has no date of its own, and the day it turned up is the only honest
 * one — which is also what keeps `attachments/YYYY/MM/` browsable in a file
 * manager.
 */
export async function attach(
  notebook: Notebook,
  day: DateKey,
  name: string,
  ext: string,
  bytes: Uint8Array,
): Promise<RelPath> {
  const rel = attachmentFile(day, name, hashContent(bytes), ext)
  await notebook.write(rel, bytes)
  return rel
}
