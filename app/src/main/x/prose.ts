// The prose view of one body: the shared mapping (D44) plus the text itself.
//
// Only main has bodies, so only main can produce prose text; the arithmetic
// lives in `shared/prose.ts` because the renderer needs exactly the same
// answers about exactly the same positions.

import { proseText, ProseMap, stripHandles, HANDLE, type Marker, type ProseWidth } from '../../shared/prose.ts'
import type { Offset, ProseOffset } from '../../shared/document-api.ts'

export { HANDLE, ProseMap, stripHandles }
export type { Marker, ProseWidth }

export class Prose {
  readonly text: string
  readonly map: ProseMap

  private constructor(text: string, map: ProseMap) {
    this.text = text
    this.map = map
  }

  static of(raw: string, markers: readonly Marker[]): Prose {
    const map = ProseMap.of(raw.length, markers)
    return new Prose(proseText(raw, map), map)
  }

  get markers(): readonly Marker[] {
    return this.map.markers
  }

  toProse(raw: Offset): ProseOffset {
    return this.map.toProse(raw)
  }
  toRaw(prose: ProseOffset): Offset {
    return this.map.toRaw(prose)
  }
  toRawAfter(prose: ProseOffset): Offset {
    return this.map.toRawAfter(prose)
  }
  handleAt(prose: ProseOffset): Marker | null {
    return this.map.handleAt(prose)
  }
  within(from: Offset, to: Offset): readonly Marker[] {
    return this.map.within(from, to)
  }
  carve(from: Offset, to: Offset): readonly { from: Offset; to: Offset }[] {
    return this.map.carve(from, to)
  }
}
