// What a document is, on the side that has the files (D54).
//
// **`Document` is the shared contract — what both processes can do with one.**
// The renderer holds documents too (D37), and journalling and writing are not
// things it can do or should know about: they are how a document survives a
// crash, which is a fact about the machine it lives on.
//
// So this is the main-side contract, and it is what the `Corpus` deals in.
// Everything here is durability; everything a person can do to a document is
// already in `Document`.

import type {
  Document, DocumentText, SegmentKey, Unsubscribe,
} from '../../../shared/document-api.ts'
import type { RelPath } from '../../w/layout.ts'

/** One edit as the journal sees it: a span in a segment, and what replaced it. */
export interface JournalEdit {
  readonly from: number
  readonly to: number
  readonly insert: DocumentText
}

export interface StoredDocument extends Document {
  /**
   * Told about each batch of edits as it is applied, with the segment's length
   * BEFORE it — what the write-ahead log needs, and nothing else does (D32).
   *
   * On every stored document rather than on the stream alone: **durability is
   * not a property of one kind.** A fileset edited by a pin is as much at risk
   * between the keystroke and the file write as a day is.
   */
  onJournal(
    handler: (segment: SegmentKey, baseLen: number, edits: readonly JournalEdit[]) => void,
  ): Unsubscribe

  /** Write whatever is dirty. Returns the files written, for the version tier. */
  writeDirty(): Promise<readonly RelPath[]>
}
