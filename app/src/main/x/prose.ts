// Building the prose of one body: text, mapping and annotations (D44, D50).
//
// Only main has bodies, so only main can produce prose text; the arithmetic
// lives in `shared/prose.ts` because the renderer needs exactly the same
// answers about exactly the same positions.

import {
  proseText, ProseMap, stripHandles, HANDLE,
  type Annotation, type Marker, type Prose, type ProseWidth, type SegmentProse,
} from '../../shared/prose.ts'
import type { DocumentOffset, ProseOffset, ProseText, DocumentText } from '../../shared/document-api.ts'
import { scanMarkers, type ScannedSpan } from './markers.ts'
import { scanThreadBlocks } from './comments.ts'
import type { CommentThread } from '../../shared/comments.ts'

export { HANDLE, ProseMap, stripHandles }
export type { Marker, Prose, ProseWidth, SegmentProse }

/**
 * A body's prose, ready to be displayed (D50).
 *
 * **A function returning plain data, not a class.** `Prose` is one value with
 * three parts and no behaviour of its own — the arithmetic belongs to `map`,
 * which both processes build for themselves. A class here would have added a
 * second `Prose` beside the shared one, and would have made the value
 * unsendable: structured clone keeps an object's fields and drops its
 * prototype, so a cloned wrapper arrives looking right and failing at the
 * first method call.
 *
 * **It takes the caller's scan, not a second one.** A segment already walks its
 * body once to find its spans; walking it again here would be two
 * implementations of one answer, which is the failure this codebase keeps
 * meeting.
 *
 * **And the translation is in here, where the map is.** A scan reports document
 * offsets and an annotation is a display-layer value — so the halfway state,
 * an annotation that has not been converted yet, exists for the length of this
 * function and cannot be named outside it. That is what keeps `Annotation`
 * meaning one thing: in the document's own offsets this same fact is a
 * `TypedSpan`, and two representations of one layer's facts is what D48 is for.
 */
export function proseOf(
  body: DocumentText,
  markers: readonly Marker[],
  spans: readonly ScannedSpan[] = [],
  threads: readonly CommentThread[] = [],
): SegmentProse {
  const map = ProseMap.of(body.length, markers)
  const byId = new Map(threads.map(t => [t.id as string, t]))
  const annotations: Annotation<ProseOffset>[] = []

  for (const span of spans) {
    const at = { from: map.toProse(span.from as DocumentOffset), to: map.toProse(span.to as DocumentOffset) }
    if (span.kind === 'date') annotations.push({ kind: 'date', at, date: span.name })
    else if (span.kind === 'heading') {
      annotations.push({ kind: 'heading', at, text: span.name, level: span.level })
    } else if (span.kind === 'anchor') annotations.push({ kind: 'anchor', at, name: span.name })
    else if (span.kind === 'tag') annotations.push({ kind: 'tag', at, subject: span.name })
    else if (span.kind === 'comment') {
      // A thread whose body was hand-deleted leaves its anchors behind. The
      // anchors are still a fact about the text, but there is nothing to draw,
      // so it is left out rather than drawn empty.
      const thread = byId.get(span.name)
      if (thread !== undefined) annotations.push({ kind: 'comment', at, thread })
    }
  }

  return { text: proseText(body, map), map, annotations }
}

/**
 * What a body hides from the editor, and how wide each hidden thing is (D44).
 *
 * Widths are assigned by ROLE, not by kind. A bookmark and the start of a range
 * are **handles** and take one character of prose, because they are what a
 * person points at and deletes. The end of a range is a **boundary** and takes
 * none: the underline already shows where it stops, and a second glyph would be
 * redundant twice over.
 *
 * **A comment's body is elided whole** (D47). It is content — durable,
 * printable, readable by anything — and it is still not part of the passage it
 * glosses, so the passage's buffer does not hold it. That is what lets the
 * margin be the only place it appears, and what stops it reflowing the text it
 * is anchored beside.
 *
 * Headings are not markers: they are ordinary text that happens to be a span.
 *
 * This lives here rather than in `markers.ts` because deciding what a body
 * hides now needs both scanners, and the alternative was an import cycle.
 */
export function proseMarkers(body: DocumentText): readonly Marker[] {
  const out: Marker[] = []
  for (const m of scanMarkers(body)) {
    if (m.kind === 'heading') continue
    // The identifier inside a thread block is covered by the block itself;
    // adding both would be two overlapping markers, and the map keeps one.
    if (m.kind === 'comment') continue
    const width = m.kind === 'tag-end' || m.kind === 'comment-end' ? 0 : 1
    out.push({ from: m.from as DocumentOffset, to: m.to as DocumentOffset, width })
  }
  for (const block of scanThreadBlocks(body)) {
    out.push({ from: block.from as DocumentOffset, to: block.to as DocumentOffset, width: 0 })
  }
  return out.sort((a, b) => a.from - b.from)
}
