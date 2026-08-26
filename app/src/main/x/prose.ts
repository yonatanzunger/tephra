// The prose view of one body: the shared mapping (D44) plus the text itself.
//
// Only main has bodies, so only main can produce prose text; the arithmetic
// lives in `shared/prose.ts` because the renderer needs exactly the same
// answers about exactly the same positions.

import { proseText, ProseMap, stripHandles, HANDLE, type Marker, type ProseWidth } from '../../shared/prose.ts'
import type { DocumentOffset, ProseOffset, ProseText, DocumentText } from '../../shared/document-api.ts'
import { scanMarkers } from './markers.ts'
import { scanThreadBlocks } from './comments.ts'

export { HANDLE, ProseMap, stripHandles }
export type { Marker, ProseWidth }

export class Prose {
  readonly text: ProseText
  readonly map: ProseMap

  private constructor(text: ProseText, map: ProseMap) {
    this.text = text
    this.map = map
  }

  static of(raw: DocumentText, markers: readonly Marker[]): Prose {
    const map = ProseMap.of(raw.length, markers)
    return new Prose(proseText(raw, map), map)
  }

  get markers(): readonly Marker[] {
    return this.map.markers
  }

  toProse(raw: DocumentOffset): ProseOffset {
    return this.map.toProse(raw)
  }
  toDocument(prose: ProseOffset): DocumentOffset {
    return this.map.toDocument(prose)
  }
  toDocumentAfter(prose: ProseOffset): DocumentOffset {
    return this.map.toDocumentAfter(prose)
  }
  handleAt(prose: ProseOffset): Marker | null {
    return this.map.handleAt(prose)
  }
  within(from: DocumentOffset, to: DocumentOffset): readonly Marker[] {
    return this.map.within(from, to)
  }
  carve(from: DocumentOffset, to: DocumentOffset): readonly { from: DocumentOffset; to: DocumentOffset }[] {
    return this.map.carve(from, to)
  }
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
